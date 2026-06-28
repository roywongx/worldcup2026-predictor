#!/usr/bin/env node
// compute-server.js — Long-running computation server for World Cup Predictor
// Pre-loads all model files once, serves computation requests via HTTP on port 9091

const http = require('http');
const { Worker } = require('worker_threads');
const os = require('os');
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
    // Compute optimal temperature from calibration data (cached)
    // Recompute optimal T when result count changes by 3+
    const resultCount = actualResults.length;
    if (resultCount >= 30 && (!WC26._optimalT || Math.abs(resultCount - (WC26._optimalTCount || 0)) >= 3)) {
      WC26._optimalT = WC26.findOptimalTemperature(actualResults);
      WC26._optimalTCount = resultCount;
      console.log(`[Model] Optimal T: ${WC26._optimalT} (from ${resultCount} results)`);
    }
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
      let actual = actualMap[`${ta}|${tb}|${utcDate}`] || actualMap[`${ta}|${tb}|`];
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
      // Seeded PRNG for deterministic Poisson sampling (same as MC, but seeded)
      // Uses FNV-1a 32-bit hash — better distribution than DJB2
      function seedHash(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = (h * 0x01000193) >>> 0;
        }
        return h;
      }
      function seededRandom(seed) {
        let s = seed % 2147483647; if (s <= 0) s += 2147483646;
        return function() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
      }
      function seededPoisson(lambda, rng) {
        if (lambda <= 0) return 0;
        const L = Math.exp(-lambda);
        let k = 0, p = 1;
        do { k++; p *= rng(); } while (p > L);
        return k - 1;
      }
      // Top-N most probable scores with probabilities (for confidence display)
      function topScores(lh, la, n, kodate) {
        const rho = kodate ? WC26.getRho(kodate) : (WC26.RHO_GROUP || -0.20);
        const scores = [];
        for (let x = 0; x <= 5; x++) for (let y = 0; y <= 5; y++) {
          const p = WC26.poissonPMF(x, lh) * WC26.poissonPMF(y, la) * WC26.dixonColesTau(x, y, lh, la, rho);
          scores.push({s:`${x}-${y}`, p});
        }
        scores.sort((a,b) => b.p - a.p);
        return scores.slice(0, n);
      }

      // KO score: seeded Poisson + ET/PK if draw (deterministic per match)
      function detScore(home, away, lh, la, kodate) {
        const rng = seededRandom(seedHash(`${home}|${away}|${kodate}`));
        const ga90 = seededPoisson(lh, rng), gb90 = seededPoisson(la, rng);
        const top3 = topScores(lh, la, 3, kodate);
        if (ga90 !== gb90) return { ga90, gb90, ga: ga90, gb: gb90, method: "90'", lh, la, top3 };
        // Draw → extra time
        const eloH = WC26.getEffectiveElo ? WC26.getEffectiveElo(home) : 1500;
        const eloA = WC26.getEffectiveElo ? WC26.getEffectiveElo(away) : 1500;
        const gammaH = Math.max(0.10, 0.70 + 0.05 * ((eloH - eloA) / 400));
        const gammaA = Math.max(0.10, 0.70 - 0.05 * ((eloH - eloA) / 400));
        const ET_FATIGUE = 0.85;
        const etH = seededPoisson(lh * (30/90) * gammaH * ET_FATIGUE, rng);
        const etA = seededPoisson(la * (30/90) * gammaA * ET_FATIGUE, rng);
        if (ga90 + etH !== gb90 + etA) return { ga90, gb90, ga: ga90+etH, gb: gb90+etA, method: 'AET', lh, la, top3 };
        // Still draw → penalties
        const pHome = Math.max(0.40, Math.min(0.60, 0.50 + 0.05 * ((eloH - eloA) / 400)));
        const ga = rng() < pHome ? ga90 + 1 : ga90;
        const gb = ga === ga90 ? gb90 + 1 : gb90;
        return { ga90, gb90, ga, gb, method: 'PSO', lh, la, top3 };
      }
      function runKORound(pairs, kodate) {
        const res = [], winners = [];
        for (const [home, away] of pairs) {
          const mktProbs = WC26.getStoredMarketOdds(marketOddsMap, home, away, kodate);
          const probs = WC26.getBlendedProbs(home, away, preFormMap, kodate, mktProbs);
          const actual = actualMap[`${home}|${away}|${kodate}`] || actualMap[`${home}|${away}|`] || actualMap[`${away}|${home}|${kodate}`] || actualMap[`${away}|${home}|`];
          if (actual) {
            let ga = actual.score1, gb = actual.score2;
            const method = ga !== gb ? "90'" : 'PSO';
            if (ga === gb && actual.winner) { if (actual.winner === home) ga++; else gb++; }
            winners.push(ga > gb ? home : away);
            res.push({ a: home, ga, gb, b: away, method, probs, mkt: mktProbs || null });
          } else {
            // Deterministic: use model lambdas (rounded) instead of random simKO
            const [lh, la] = WC26.getFormAdjustedLambdas(home, away, preFormMap, kodate, mktProbs);
            const sc = detScore(home, away, lh, la, kodate);
            winners.push(sc.ga > sc.gb ? home : away);
            res.push({ a: home, ga: sc.ga, gb: sc.gb, b: away, method: sc.method, probs, mkt: mktProbs || null, ga90: sc.ga90, gb90: sc.gb90, lh: sc.lh, la: sc.la, top3: sc.top3 || null });
          }
        }
        return [winners, res];
      }
      // R32: sequential pairs from bracket (16 matches → 16 winners)
      // Bracket is ordered so sequential pairing produces correct R16 cross-pairing
      const r32pairs = [];
      for (let i = 0; i < koBracket.length; i += 2) r32pairs.push([koBracket[i], koBracket[i+1]]);
      let [w1, r32r] = runKORound(r32pairs, '2026-06-28');
      // R16: sequential pairs from R32 winners
      const r16pairs = [];
      for (let i = 0; i < w1.length; i += 2) r16pairs.push([w1[i], w1[i+1]]);
      let [w2, r16r] = runKORound(r16pairs, '2026-07-04');
      // QF: sequential pairs from R16 winners
      const qfpairs = [[w2[0],w2[1]],[w2[2],w2[3]],[w2[4],w2[5]],[w2[6],w2[7]]];
      let [w3, qfr] = runKORound(qfpairs, '2026-07-09');
      // SF: sequential pairs from QF winners
      const sfpairs = [[w3[0],w3[1]],[w3[2],w3[3]]];
      let [w4, sfr] = runKORound(sfpairs, '2026-07-14');
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

    return { standings, matchResults, rankings, bestThirds, ko, formMap, isoParams, dynamicElo: { ...WC26.dynamicElo } };
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
      // Store raw probs (DC+GBDT, no temperature) for calibration optimization
      const rawProbs = WC26.getRawProbs(r.team1, r.team2, preFormMap, r.date, mktOdds);
      r.rawProbs = { win: rawProbs.win, draw: rawProbs.draw, loss: rawProbs.loss };
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
    const covered = new Set();

    function addEV(ta, tb, date, mktOdds) {
      const resultKey = `${ta}|${tb}`;
      if (actualMap[resultKey]) return;
      const probs = WC26.getBlendedProbs(ta, tb, preFormMap, date, mktOdds);
      const modelProbs = [probs.win, probs.draw, probs.loss];
      const marketProbs = [mktOdds.win, mktOdds.draw, mktOdds.loss];
      const labels = ['W', 'D', 'L'];
      for (let i = 0; i < 3; i++) {
        const payout = 1 / Math.max(marketProbs[i], 0.01);
        const ev = modelProbs[i] * payout - 1;
        const edge = modelProbs[i] - marketProbs[i];
        const kelly = WC26.kellyFraction ? WC26.kellyFraction(modelProbs[i], payout) : 0;
        results.push({
          team1: ta, team2: tb, date, outcome: labels[i],
          modelProb: modelProbs[i], marketProb: marketProbs[i],
          modelAll: { w: probs.win, d: probs.draw, l: probs.loss },
          marketAll: { w: mktOdds.win, d: mktOdds.draw, l: mktOdds.loss },
          edge, ev, kelly, payout,
          confidence: Math.abs(edge) / Math.max(marketProbs[i], 0.01),
          volume: mktOdds.volume || 0
        });
      }
    }

    // Group stage matches (from MATCHES array)
    for (const m of MATCHES) {
      const [date, , ta, tb] = m;
      const mktOdds = WC26.getStoredMarketOdds(marketOdds, ta, tb, date);
      if (!mktOdds) continue;
      covered.add(`${ta}|${tb}`);
      addEV(ta, tb, date, mktOdds);
    }

    // Knockout / any other matches from marketOdds not in MATCHES
    for (const [key, mktOdds] of Object.entries(marketOdds)) {
      if (!mktOdds || !mktOdds.win) continue;
      const parts = key.split('|');
      if (parts.length < 2) continue;
      const ta = parts[0], tb = parts[1];
      if (!ta || !tb || !TEAMS[ta] || !TEAMS[tb]) continue;
      if (covered.has(`${ta}|${tb}`) || covered.has(`${tb}|${ta}`)) continue;
      const date = parts[2] || '';
      addEV(ta, tb, date, mktOdds);
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

// ── Single-threaded MC for small N ────────────────────────────────
function runMonteCarloSingle(actualResults, N, marketOdds, savedElo) {
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
      const mr = {};
      result.rounds.slice(0, 4).forEach((round, ri) => {
        for (const m of round) mr[`${m.a}|${m.b}`] = { ga: m.ga, gb: m.gb, round: ri + 1 };
      });
      history.push({ champion: result.champion, matchResults: mr });
      successCount++;
    } catch (e) { console.warn('[MC] Simulation failed:', e.message); }
  }

  Object.assign(WC26.dynamicElo, savedElo);
  if (successCount < N * 0.5) console.warn(`[MC] Only ${successCount}/${N} simulations succeeded`);
  mcResults = { champ, finalist, semi, quarter, r16, N: successCount };
  simulationHistory = history;
  return { ...mcResults, simulationHistory: history, _meta: { requested: N, succeeded: successCount, failed: N - successCount } };
}

// ── Action: montecarlo (parallel via worker_threads) ────────────────
async function runMonteCarlo(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const N = params.N || 50000;
  const marketOdds = params.marketOdds || cachedMarketOdds;

  WC26.rebuildDynamicElo(actualResults);
  WC26.trainAndBlendGBDT(actualResults);
  const savedElo = { ...WC26.dynamicElo };

  // For small N, run single-threaded to avoid worker overhead
  if (N <= 2000) {
    return runMonteCarloSingle(actualResults, N, marketOdds, savedElo);
  }

  // Determine worker count (use available CPUs, max 16, min 1)
  const numWorkers = Math.max(1, Math.min(16, os.cpus().length - 1));
  const batchSize = Math.ceil(N / numWorkers);

  console.log(`[MC] Running ${N} sims across ${numWorkers} workers (${batchSize} each)`);

  // Spawn workers
  const workers = [];
  for (let w = 0; w < numWorkers; w++) {
    const wN = (w === numWorkers - 1) ? N - batchSize * (numWorkers - 1) : batchSize;
    if (wN <= 0) continue;
    workers.push(new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'mc-worker.js'), {
        workerData: { batchSize: wN, actualResults, marketOdds, savedElo, optimalT: WC26._optimalT || 1.15 }
      });
      worker.on('message', resolve);
      worker.on('error', reject);
    }));
  }

  // Collect results
  const results = await Promise.all(workers);
  const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
  let successCount = 0;
  const history = [];

  for (const r of results) {
    successCount += r.successCount;
    for (const [k, v] of Object.entries(r.champ)) champ[k] = (champ[k] || 0) + v;
    for (const [k, v] of Object.entries(r.finalist)) finalist[k] = (finalist[k] || 0) + v;
    for (const [k, v] of Object.entries(r.semi)) semi[k] = (semi[k] || 0) + v;
    for (const [k, v] of Object.entries(r.quarter)) quarter[k] = (quarter[k] || 0) + v;
    for (const [k, v] of Object.entries(r.r16)) r16[k] = (r16[k] || 0) + v;
    history.push(...r.history);
  }

  Object.assign(WC26.dynamicElo, savedElo);
  if (successCount < N * 0.5) console.warn(`[MC] Only ${successCount}/${N} simulations succeeded`);
  mcResults = { champ, finalist, semi, quarter, r16, N: successCount };
  simulationHistory = history;

  return { ...mcResults, simulationHistory: history };
}

// ── Action: calibration diagnostics (reliability diagram + optimal T) ──
function runCalibrationDiag(params) {
  const actualResults = params.actualResults || cachedActualResults;
  const nBins = params.nBins || 10;
  const reliability = WC26.reliabilityDiagram(actualResults, nBins);
  const optimalT = WC26.findOptimalTemperature(actualResults);
  return { reliability, optimalT, pipeline: 'Dixon-Coles → GBDT(20%) → Temperature → Isotonic' };
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

// ── Rate limiting ────────────────────────────────────────────────────
const requestLog = []; // {action, t0, elapsed, size, error}
const RATE_WINDOW = 10000; // 10s window
const RATE_LIMIT = 20; // max 20 requests per window
function checkRateLimit() {
  const now = Date.now();
  while (requestLog.length > 0 && requestLog[0].t0 < now - RATE_WINDOW) requestLog.shift();
  return requestLog.length < RATE_LIMIT;
}

// ── HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/compute') {
    // Rate limit check
    if (!checkRateLimit()) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limited', type: 'RATE_LIMIT', retryAfter: 5 }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const input = JSON.parse(body);
      const action = input.action;
      const params = input.params || {};
      const t0 = Date.now();
      const logEntry = { action, t0, elapsed: 0, size: 0, error: null };
      requestLog.push(logEntry);

      try {
        let result;

        switch (action) {
          case 'simulation': result = runSimulation(params); break;
          case 'reevaluate': result = runReevaluate(params); break;
          case 'calibration': result = runCalibration(params); break;
          case 'caldiag': result = runCalibrationDiag(params); break;
          case 'ev': result = runEV(params); break;
          case 'brier': result = runBrier(params); break;
          case 'backtest': result = runBacktest(); break;
          case 'montecarlo': result = await runMonteCarlo(params); break;
          case 'full': result = await runFull(params); break;
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Unknown action: ${action}`, type: 'INVALID_ACTION' }));
            return;
        }

        const elapsed = Date.now() - t0;
        const output = JSON.stringify(result);
        logEntry.elapsed = elapsed;
        logEntry.size = output.length;
        console.log(`[Compute] ${action} completed in ${elapsed}ms (${(output.length/1024).toFixed(1)}KB)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(output);
      } catch (e) {
        logEntry.error = e.message;
        const elapsed = Date.now() - t0;
        logEntry.elapsed = elapsed;
        console.error(`[Compute] ${action} FAILED in ${elapsed}ms:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: e.message,
          type: 'COMPUTE_ERROR',
          action,
          suggestion: 'Check server logs for details'
        }));
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
