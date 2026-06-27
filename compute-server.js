#!/usr/bin/env node
// compute-server.js — Long-running computation server for World Cup Predictor
// Pre-loads all model files once, serves computation requests via HTTP on port 9091

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9091;
const dir = __dirname;

// ── Load all model files (same pattern as mc-server.js) ──────────────
console.log('[Compute] Loading model files...');
globalThis.WC26 = {};
eval(fs.readFileSync(path.join(dir, 'data/teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'data/matches.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/stats.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/elo.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/dixon-coles.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/gbdt.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/monte-carlo.js'), 'utf8'));

const TEAMS = globalThis.TEAMS || WC26.TEAMS;
const MATCHES = globalThis.MATCHES || WC26.MATCHES;
const GROUPS = WC26.GROUPS;
const GROUP_TEAMS = WC26.GROUP_TEAMS;
console.log('[Compute] Model loaded:', Object.keys(TEAMS).length, 'teams,', MATCHES.length, 'matches');

// ── Cached state ─────────────────────────────────────────────────────
let cachedActualResults = [];
let cachedMarketOdds = {};
let cachedCustomOdds = {};
let mcResults = null;  // {champ, finalist, semi, quarter, r16, N}
let simulationHistory = null;

// ── Helper: calculate dynamic form (copied from index.html logic) ────
function calculateDynamicForm(actualResults) {
  if (!actualResults || actualResults.length === 0) return {};
  const now = new Date();
  const teamMatches = {};
  for (const r of actualResults) {
    if (r.score1 == null || r.score2 == null) continue;
    for (const t of [r.team1, r.team2]) {
      if (!teamMatches[t]) teamMatches[t] = [];
      teamMatches[t].push(r);
    }
  }
  const formMap = {};
  for (const [team, matches] of Object.entries(teamMatches)) {
    let weightedSum = 0, weightTotal = 0;
    for (const m of matches) {
      const daysAgo = (now - new Date(m.date)) / (1000 * 60 * 60 * 24);
      const w = Math.exp(-0.15 * Math.max(0, daysAgo));
      const won = m.team1 === team ? m.score1 > m.score2 : m.score2 > m.score1;
      const draw = m.score1 === m.score2;
      const pts = won ? 1 : (draw ? 0.33 : 0);
      const gd = m.team1 === team ? m.score1 - m.score2 : m.score2 - m.score1;
      const gdBonus = Math.max(-0.2, Math.min(0.2, gd * 0.1));
      const opp = m.team1 === team ? m.team2 : m.team1;
      const oppElo = TEAMS[opp] ? TEAMS[opp].elo : 1500;
      const oppBonus = Math.max(0, Math.min(0.15, (oppElo - 1500) / 2000));
      weightedSum += w * (pts + gdBonus + oppBonus);
      weightTotal += w;
    }
    const wcForm = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
    const preForm = TEAMS[team] ? TEAMS[team].form : 0.5;
    const matchCount = matches.length;
    const wcWeight = 1 - Math.pow(0.7, matchCount);
    formMap[team] = wcWeight * wcForm + (1 - wcWeight) * preForm;
  }
  return formMap;
}

// ── Action: simulation ───────────────────────────────────────────────
function runSimulation(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const marketOdds = params.marketOdds || cachedMarketOdds;
  const customOdds = params.customOdds || {};

  // Apply custom odds
  for (const [team, odds] of Object.entries(customOdds)) {
    if (TEAMS[team]) TEAMS[team].odds = odds;
  }

  cachedActualResults = actualResults;
  cachedMarketOdds = marketOdds;

  return WC26.withPreTournamentElo(() => {
    WC26.rebuildDynamicElo(actualResults);
    const formMap = calculateDynamicForm(actualResults);
    const actualMap = WC26.buildActualResultsMap(actualResults);
    const marketOddsMap = marketOdds;
    WC26._allMarketVolumes = Object.values(marketOddsMap).map(v => v.volume || 0).filter(v => v > 0);

    const standings = {}, matchResults = [];
    GROUPS.forEach(g => {
      standings[g] = {};
      GROUP_TEAMS[g].forEach(t => {
        standings[g][t] = { P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0, ExpPts: 0 };
      });
    });

    let rankings = {}, bestThirds = [], ko = {};
    const preFormMap = {};
    for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;

    MATCHES.forEach(([utcDate, bjTime, ta, tb, grp]) => {
      let actual = actualMap[`${ta}|${tb}|`] || actualMap[`${ta}|${tb}|${utcDate}`];
      const a = standings[grp][ta], b = standings[grp][tb];

      if (actual) {
        const sa = actual.score1, sb = actual.score2;
        a.P++; b.P++; a.GF += sa; a.GA += sb; b.GF += sb; b.GA += sa;
        if (sa > sb) { a.W++; a.Pts += 3; b.L++; }
        else if (sa < sb) { b.W++; b.Pts += 3; a.L++; }
        else { a.D++; a.Pts++; b.D++; b.Pts++; }
        a.GD = a.GF - a.GA; b.GD = b.GF - b.GA;
        a.ExpPts = a.Pts; b.ExpPts = b.Pts;
        matchResults.push({ date: utcDate, ta, sa, sb, tb, grp, actual: true, probs: null });
      } else {
        const mktProbs = WC26.getStoredMarketOdds(marketOddsMap, ta, tb, utcDate);
        const probs = WC26.getBlendedProbs(ta, tb, preFormMap, utcDate, mktProbs);
        const expH = probs.win * 3 + probs.draw, expA = probs.loss * 3 + probs.draw;
        const [lh, la] = WC26.getFormAdjustedLambdas(ta, tb, preFormMap, utcDate, mktProbs);
        const predOutcome = probs.draw >= probs.win && probs.draw >= probs.loss ? 'D' : (probs.win >= probs.loss ? 'W' : 'L');
        let bp = 0, lh2 = 1, la2 = 0;
        for (let x = 0; x <= 5; x++) for (let y = 0; y <= 5; y++) {
          const outcome = x > y ? 'W' : (x < y ? 'L' : 'D');
          if (outcome !== predOutcome) continue;
          const rho = utcDate ? WC26.getRho(utcDate) : WC26.RHO_GROUP;
          const p = WC26.poissonPMF(x, lh) * WC26.poissonPMF(y, la) * WC26.dixonColesTau(x, y, lh, la, rho);
          if (p > bp) { bp = p; lh2 = x; la2 = y; }
        }
        a.W += probs.win; a.D += probs.draw; a.L += probs.loss; a.Pts += probs.win * 3 + probs.draw;
        b.W += probs.loss; b.D += probs.draw; b.L += probs.win; b.Pts += probs.loss * 3 + probs.draw;
        a.P++; b.P++; a.GF += lh2; a.GA += la2; b.GF += la2; b.GA += lh2;
        a.GD = a.GF - a.GA; b.GD = b.GF - b.GA;
        a.ExpPts += expH; b.ExpPts += expA;
        matchResults.push({ date: utcDate, ta, sa: lh2, sb: la2, tb, grp, actual: false, probs, homeExpPts: expH, awayExpPts: expA });
      }
    });

    GROUPS.forEach(g => {
      rankings[g] = GROUP_TEAMS[g].slice().sort((a, b) => {
        const sa = standings[g][a], sb = standings[g][b];
        return sb.Pts - sa.Pts || sb.GD - sa.GD || sb.GF - sa.GF || sb.ExpPts - sa.ExpPts;
      });
    });

    const thirds = [];
    GROUPS.forEach(g => thirds.push({ team: rankings[g][2], group: g, ...standings[g][rankings[g][2]] }));
    thirds.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF);
    bestThirds = thirds.slice(0, 8).map(t => t.team);
    const thirdPlaceGroups = thirds.slice(0, 8).map(t => t.group).sort();

    ko = {};
    try {
      const koBracket = WC26.buildKOBracket(rankings, bestThirds, thirdPlaceGroups);
      function runKORound(teams, kodate) {
        const res = [], winners = [];
        for (let i = 0; i < teams.length; i += 2) {
          const home = teams[i], away = teams[i + 1];
          const actual = actualMap[`${home}|${away}|`] || actualMap[`${away}|${home}|`];
          if (actual) {
            let ga = actual.score1, gb = actual.score2;
            const method = ga !== gb ? "90'" : 'PSO';
            if (ga === gb && actual.winner) { if (actual.winner === home) ga++; else gb++; }
            winners.push(ga > gb ? home : away);
            res.push({ a: home, ga, gb, b: away, method });
          } else {
            const [ga, gb, method] = WC26.simKO(home, away, preFormMap, kodate, marketOddsMap);
            winners.push(ga > gb ? home : away);
            res.push({ a: home, ga, gb, b: away, method });
          }
        }
        return [winners, res];
      }
      let [w1, r32r] = runKORound(koBracket, '2026-06-28');
      let [w2, r16r] = runKORound(w1, '2026-07-02');
      let [w3, qfr] = runKORound(w2, '2026-07-05');
      let [w4, sfr] = runKORound(w3, '2026-07-09');
      const sfLosers = sfr.map(m => m.ga > m.gb ? m.b : m.a);
      const [tga, tgb, tm] = WC26.simKO(sfLosers[0], sfLosers[1], preFormMap, '2026-07-14', marketOddsMap);
      const [fa, fb, fm] = WC26.simKO(w4[0], w4[1], preFormMap, '2026-07-19', marketOddsMap);
      ko.R32 = r32r; ko.R16 = r16r; ko.QF = qfr; ko.SF = sfr;
      ko.Third = { a: sfLosers[0], ga: tga, gb: tgb, b: sfLosers[1], method: tm };
      ko.Final = { a: w4[0], ga: fa, gb: fb, b: w4[1], method: fm };
      ko.Champion = fa > fb ? w4[0] : w4[1];
    } catch (e) {
      console.error('[Compute] Bracket error:', e.message);
      ko.R32 = []; ko.R16 = []; ko.QF = []; ko.SF = [];
      ko.Third = { a: '?', ga: 0, gb: 0, b: '?', method: '' };
      ko.Final = { a: '?', ga: 0, gb: 0, b: '?', method: '' };
      ko.Champion = '?';
    }

    const isoParams = WC26.fitIsotonicCalibration(actualResults);

    return { standings, matchResults, rankings, bestThirds, ko, formMap, isoParams };
  });
}

// ── Action: reevaluate ───────────────────────────────────────────────
function runReevaluate(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const marketOdds = params.marketOdds || cachedMarketOdds;
  cachedActualResults = actualResults;
  cachedMarketOdds = marketOdds;

  return WC26.withPreTournamentElo(() => {
    const preFormMap = {};
    for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;
    WC26.fitAndCacheCalibration(actualResults);
    WC26.trainAndBlendGBDT(actualResults);

    let changed = 0;
    const marketOddsMap = marketOdds;
    for (const r of actualResults) {
      const mktOdds = r.preMatchOdds || WC26.getStoredMarketOdds(marketOddsMap, r.team1, r.team2, r.date);
      const probs = WC26.getBlendedProbs(r.team1, r.team2, preFormMap, r.date, mktOdds);
      const pred = WC26.predictOutcome(probs, r.team1, r.team2);
      const [lh, la] = WC26.getFormAdjustedLambdas(r.team1, r.team2, preFormMap, r.date, mktOdds);
      if (r.predicted !== pred || r.correct !== (pred === r.actual)) changed++;
      r.predicted = pred;
      r.correct = (pred === r.actual);
      r.probs = { win: probs.win, draw: probs.draw, loss: probs.loss };
      r.predGoals = [lh.toFixed(2), la.toFixed(2)];
    }
    return { changed, actualResults };
  });
}

// ── Action: calibration ──────────────────────────────────────────────
function runCalibration(params) {
  const actualResults = params.actualResults || cachedActualResults;
  if (!actualResults || actualResults.length < 3) return null;

  return WC26.withPreTournamentElo(() => {
    let correct = 0, total = actualResults.length;
    let rpsSum = 0, brierSum = 0, logLossSum = 0;
    const predictions = [], outcomes = [];
    const preFormMap = {};
    for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;

    for (const r of actualResults) {
      if (r.score1 == null || r.score2 == null) continue;
      let predArr;
      if (r.probs && typeof r.probs.win === 'number' && typeof r.probs.draw === 'number' && typeof r.probs.loss === 'number'
          && !isNaN(r.probs.win) && !isNaN(r.probs.draw) && !isNaN(r.probs.loss)) {
        predArr = [r.probs.win, r.probs.draw, r.probs.loss];
      } else {
        const probs = WC26.getBlendedProbs(r.team1, r.team2, preFormMap);
        predArr = [probs.win, probs.draw, probs.loss];
      }
      let outcome;
      if (r.score1 > r.score2) outcome = 0;
      else if (r.score1 === r.score2) outcome = 1;
      else outcome = 2;
      predictions.push(predArr);
      outcomes.push(outcome);
      const predWinner = predArr[0] >= predArr[1] && predArr[0] >= predArr[2] ? r.team1 : (predArr[2] >= predArr[1] && predArr[2] >= predArr[0] ? r.team2 : 'draw');
      const actWinner = r.score1 > r.score2 ? r.team1 : (r.score2 > r.score1 ? r.team2 : 'draw');
      if (predWinner === actWinner) correct++;
      rpsSum += WC26.rankedProbabilityScore(predArr, outcome);
      brierSum += WC26.brierScore(predArr, outcome);
      logLossSum += WC26.logLoss(predArr, outcome);
    }

    const isoParams = WC26.fitIsotonicCalibration(actualResults);
    const nBins = 10;
    const bins = Array.from({ length: nBins }, () => ({ count: 0, sumProb: 0, sumOutcome: 0 }));
    for (let i = 0; i < predictions.length; i++) {
      const pred = predictions[i];
      const predictedClass = pred[0] >= pred[1] && pred[0] >= pred[2] ? 0 : pred[1] >= pred[2] ? 1 : 2;
      const confidence = pred[predictedClass];
      const binIdx = Math.min(nBins - 1, Math.floor(confidence * nBins));
      if (isNaN(binIdx) || binIdx < 0) continue;
      bins[binIdx].count++;
      bins[binIdx].sumProb += confidence;
      bins[binIdx].sumOutcome += (predictedClass === outcomes[i]) ? 1 : 0;
    }

    const validTotal = predictions.length;
    return {
      total: validTotal, correct,
      accuracy: validTotal > 0 ? correct / validTotal : 0,
      rps: validTotal > 0 ? rpsSum / validTotal : 0,
      brier: validTotal > 0 ? brierSum / validTotal : 0,
      logLoss: validTotal > 0 ? logLossSum / validTotal : 0,
      ece: WC26.expectedCalibrationError(predictions, outcomes),
      bins, isoParams
    };
  });
}

// ── Action: ev ───────────────────────────────────────────────────────
function runEV(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const marketOdds = params.marketOdds || cachedMarketOdds;
  const actualMap = WC26.buildActualResultsMap(actualResults);

  return WC26.withPreTournamentElo(() => {
    const preFormMap = {};
    for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;
    const results = [];

    for (const m of MATCHES) {
      const [date, , ta, tb] = m;
      const mktOdds = WC26.getStoredMarketOdds(marketOdds, ta, tb, date);
      if (!mktOdds) continue;
      const resultKey = `${ta}|${tb}`;
      if (actualMap[resultKey]) continue;

      const probs = WC26.getBlendedProbs(ta, tb, preFormMap, date, mktOdds);
      const modelProbs = [probs.win, probs.draw, probs.loss];
      const marketProbs = [mktOdds.win, mktOdds.draw, mktOdds.loss];
      const labels = ['W', 'D', 'L'];

      for (let i = 0; i < 3; i++) {
        const payout = 1 / Math.max(marketProbs[i], 0.01);
        const ev = modelProbs[i] * payout - 1;
        const edge = modelProbs[i] - marketProbs[i];
        if (Math.abs(edge) > 0.03) {
          const kelly = WC26.kellyFraction ? WC26.kellyFraction(modelProbs[i], payout) : 0;
          results.push({
            team1: ta, team2: tb, date, outcome: labels[i],
            modelProb: modelProbs[i], marketProb: marketProbs[i],
            edge, ev, kelly, payout,
            confidence: Math.abs(edge) / Math.max(marketProbs[i], 0.01),
            volume: mktOdds.volume || 0
          });
        }
      }
    }
    results.sort((a, b) => b.ev - a.ev);
    return results;
  });
}

// ── Action: brier ────────────────────────────────────────────────────
function runBrier(params) {
  const log = params.predictionLog || [];
  if (log.length < 3) return null;
  let modelBrier = 0, marketBrier = 0, count = 0, marketCount = 0;
  for (const entry of log) {
    const mPred = [entry.model.w, entry.model.d, entry.model.l];
    const o = entry.outcome;
    modelBrier += (mPred[0] - (o === 0 ? 1 : 0)) ** 2 + (mPred[1] - (o === 1 ? 1 : 0)) ** 2 + (mPred[2] - (o === 2 ? 1 : 0)) ** 2;
    count++;
    if (entry.market) {
      const mkPred = [entry.market.w, entry.market.d, entry.market.l];
      marketBrier += (mkPred[0] - (o === 0 ? 1 : 0)) ** 2 + (mkPred[1] - (o === 1 ? 1 : 0)) ** 2 + (mkPred[2] - (o === 2 ? 1 : 0)) ** 2;
      marketCount++;
    }
  }
  return {
    model: count > 0 ? modelBrier / (count * 3) : null,
    market: marketCount > 0 ? marketBrier / (marketCount * 3) : null,
    count, marketCount
  };
}

// ── Action: backtest ─────────────────────────────────────────────────
function runBacktest() {
  return WC26.withPreTournamentElo(() => {
    const predictions = [], outcomes = [];
    let correct = 0;
    for (const m of WC26.WC2022_RESULTS) {
      const tmpAdded = [];
      for (const tm of [m.t1, m.t2]) {
        if (!TEAMS[tm] && WC26.WC2022_TEAMS[tm]) { TEAMS[tm] = WC26.WC2022_TEAMS[tm]; tmpAdded.push(tm); }
      }
      if (!TEAMS[m.t1] || !TEAMS[m.t2]) { tmpAdded.forEach(t => delete TEAMS[t]); continue; }
      const tmpFormMap = {};
      tmpAdded.forEach(t => { tmpFormMap[t] = TEAMS[t].form; });
      let probs;
      try { probs = WC26.getBlendedProbs(m.t1, m.t2, tmpFormMap); }
      finally { tmpAdded.forEach(t => { delete TEAMS[t]; delete tmpFormMap[t]; }); }
      const predArr = [probs.win, probs.draw, probs.loss];
      const outcome = m.s1 > m.s2 ? 0 : (m.s1 === m.s2 ? 1 : 2);
      predictions.push(predArr);
      outcomes.push(outcome);
      const predWinner = predArr[0] >= predArr[1] && predArr[0] >= predArr[2] ? 0 : predArr[1] >= predArr[2] ? 1 : 2;
      if (predWinner === outcome) correct++;
    }
    if (predictions.length === 0) return null;
    let rpsSum = 0, brierSum = 0, logLossSum = 0;
    for (let i = 0; i < predictions.length; i++) {
      rpsSum += WC26.rankedProbabilityScore(predictions[i], outcomes[i]);
      brierSum += WC26.brierScore(predictions[i], outcomes[i]);
      logLossSum += WC26.logLoss(predictions[i], outcomes[i]);
    }
    return {
      total: predictions.length, correct,
      accuracy: correct / predictions.length,
      rps: rpsSum / predictions.length,
      brier: brierSum / predictions.length,
      logLoss: logLossSum / predictions.length,
      ece: WC26.expectedCalibrationError(predictions, outcomes)
    };
  });
}

// ── Action: montecarlo ───────────────────────────────────────────────
function runMonteCarlo(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const N = params.N || 50000;
  const marketOdds = params.marketOdds || cachedMarketOdds;

  WC26.rebuildDynamicElo(actualResults);
  WC26.trainAndBlendGBDT(actualResults);
  const savedElo = { ...WC26.dynamicElo };
  const actualMap = WC26.buildActualResultsMap(actualResults);
  const preFormMap = {};
  for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;

  const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
  let successCount = 0;
  const history = [];

  for (let i = 0; i < N; i++) {
    Object.assign(WC26.dynamicElo, savedElo);
    try {
      const result = WC26.simulateOneTournament(actualMap, preFormMap, marketOdds);
      if (!result || !result.champion) continue;
      champ[result.champion] = (champ[result.champion] || 0) + 1;
      if (result.rounds && result.rounds.length >= 4) for (const m of result.rounds[3]) { finalist[m.a] = (finalist[m.a] || 0) + 1; finalist[m.b] = (finalist[m.b] || 0) + 1; }
      if (result.rounds && result.rounds.length >= 3) for (const m of result.rounds[2]) { semi[m.a] = (semi[m.a] || 0) + 1; semi[m.b] = (semi[m.b] || 0) + 1; }
      if (result.rounds && result.rounds.length >= 2) for (const m of result.rounds[1]) { quarter[m.a] = (quarter[m.a] || 0) + 1; quarter[m.b] = (quarter[m.b] || 0) + 1; }
      if (result.rounds && result.rounds.length >= 1) for (const m of result.rounds[0]) { r16[m.a] = (r16[m.a] || 0) + 1; r16[m.b] = (r16[m.b] || 0) + 1; }
      // Store history for what-if queries
      const mr = {};
      result.rounds.slice(0, 4).forEach((round, ri) => {
        for (const m of round) mr[`${m.a}|${m.b}`] = { ga: m.ga, gb: m.gb, round: ri + 1 };
      });
      history.push({ champion: result.champion, matchResults: mr });
      successCount++;
    } catch (e) { /* skip failed */ }
  }

  Object.assign(WC26.dynamicElo, savedElo);
  mcResults = { champ, finalist, semi, quarter, r16, N: successCount };
  simulationHistory = history;

  return mcResults;
}

// ── Action: full (simulation + calibration + ev + brier + backtest) ──
function runFull(params) {
  const simResult = runSimulation(params);
  const calResult = runCalibration(params);
  const evResult = runEV(params);
  const brierResult = runBrier(params);
  const btResult = runBacktest();

  return {
    currentResults: simResult,
    calibration: calResult,
    ev: evResult,
    brierScores: brierResult,
    backtest: btResult
  };
}

// ── HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/compute') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const action = input.action;
        const params = input.params || {};
        const t0 = Date.now();
        let result;

        switch (action) {
          case 'simulation': result = runSimulation(params); break;
          case 'reevaluate': result = runReevaluate(params); break;
          case 'calibration': result = runCalibration(params); break;
          case 'ev': result = runEV(params); break;
          case 'brier': result = runBrier(params); break;
          case 'backtest': result = runBacktest(); break;
          case 'montecarlo': result = runMonteCarlo(params); break;
          case 'full': result = runFull(params); break;
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
            return;
        }

        const elapsed = Date.now() - t0;
        console.log(`[Compute] ${action} completed in ${elapsed}ms`);
        const output = JSON.stringify(result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(output);
      } catch (e) {
        console.error('[Compute] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', teams: Object.keys(TEAMS).length, matches: MATCHES.length }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Compute] Server running on http://127.0.0.1:${PORT}`);
  console.log(`[Compute] POST /compute {action, params}`);
  console.log(`[Compute] GET /health`);
});
