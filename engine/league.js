'use strict';
// 俱乐部联赛：双循环剩余赛程、按各联赛同分规则排名、赛季蒙特卡洛（名次/欧战/降级概率）。
// 与赛事引擎一致：只用 asOf 之前的比赛拟合（含 Elo），剩余比赛按比分矩阵抽样。
const fs = require('fs');
const path = require('path');
const { runElo, HOME_ADV } = require('./elo');
const dc = require('./dc');
const { mulberry32, poissonSample } = require('./simulate');
const { parseCSV, toDay } = require('./data');
const { CLUB_DIR, seasonTeams, implied, parseDate } = require('./clubdata');

const DAY = 86400000;
const TOP = ['E0', 'SP1', 'D1', 'I1', 'F1'];

/** 双循环里还没踢的有序主客对。 */
function remainingFixtures(teams, played) {
  const done = new Set(played.map(m => m.home + '|' + m.away));
  const out = [];
  for (const h of teams) for (const a of teams) if (h !== a && !done.has(h + '|' + a)) out.push([h, a]);
  return out;
}

function basicStats(teams, results) {
  const st = new Map(teams.map(t => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, away_gf: 0, away_wins: 0 }]));
  for (const m of results) {
    const A = st.get(m.home), B = st.get(m.away);
    if (!A || !B) continue;
    A.p++; B.p++;
    A.gf += m.hg; A.ga += m.ag; B.gf += m.ag; B.ga += m.hg;
    B.away_gf += m.ag;
    if (m.hg > m.ag) { A.w++; B.l++; A.pts += 3; }
    else if (m.hg < m.ag) { B.w++; A.l++; B.pts += 3; B.away_wins++; }
    else { A.d++; B.d++; A.pts++; B.pts++; }
  }
  for (const r of st.values()) r.gd = r.gf - r.ga;
  return st;
}

/** 相互战绩：只在当前仍并列的这几队之间的比赛上算。 */
function h2hStats(group, results) {
  const set = new Set(group);
  const st = new Map(group.map(t => [t, { pts: 0, gd: 0, gf: 0, away_gf: 0 }]));
  for (const m of results) {
    if (!set.has(m.home) || !set.has(m.away)) continue;
    const A = st.get(m.home), B = st.get(m.away);
    A.gf += m.hg; B.gf += m.ag; A.gd += m.hg - m.ag; B.gd += m.ag - m.hg;
    B.away_gf += m.ag;
    if (m.hg > m.ag) A.pts += 3; else if (m.hg < m.ag) B.pts += 3; else { A.pts++; B.pts++; }
  }
  return st;
}

/** 逐条规则细分并列组；规则用尽后随机（lot）。 */
function orderGroup(group, rules, results, lot) {
  if (group.length <= 1) return group;
  if (!rules.length) return group.sort((a, b) => lot(a) - lot(b));
  const [key, ...rest] = rules;
  let metric;
  if (key.startsWith('h2h_')) {
    const k = key.slice(4);
    const h = h2hStats(group.map(r => r.team), results);
    metric = r => h.get(r.team)[k];
  } else if (key === 'wins') metric = r => r.w;
  else metric = r => r[key];
  const sorted = group.slice().sort((a, b) => metric(b) - metric(a));
  const out = [];
  for (let i = 0; i < sorted.length;) {
    const v = metric(sorted[i]);
    let j = i + 1;
    while (j < sorted.length && metric(sorted[j]) === v) j++;
    out.push(...orderGroup(sorted.slice(i, j), rest, results, lot));
    i = j;
  }
  return out;
}

/** 排名。results 为 {home,away,hg,ag}；返回 {team,p,w,d,l,gf,ga,gd,pts} 的行。 */
function rankTable(teams, results, tiebreak = ['pts', 'gd', 'gf'], rnd = mulberry32(1)) {
  const st = basicStats(teams, results);
  const lot = new Map(teams.map(t => [t, rnd()]));
  return orderGroup([...st.values()], tiebreak, results, r => lot.get(r.team));
}

function sampleFrom(cells, rnd) {
  const u = rnd() * cells[cells.length - 1][0];
  let lo = 0, hi = cells.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cells[mid][0] < u) lo = mid + 1; else hi = mid; }
  return [cells[lo][1], cells[lo][2]];
}

/** 赛季起止（'2627' → 2026-08-01 / 2027-05-31）。 */
function seasonBounds(season) {
  const y = 2000 + +season.slice(0, 2);
  return { start: `${y}-08-01`, end: `${y + 1}-05-31` };
}

/** data/clubs/fixtures.csv 里未来 14 天内该级别的赛程（文件不存在则空）。 */
function upcomingFixtures(cfg, asOfDay, predict) {
  const file = path.join(CLUB_DIR, 'fixtures.csv');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const r of parseCSV(fs.readFileSync(file, 'latin1').replace(/^﻿|^ï»¿/, ''))) {
    if (r.Div !== cfg.division || !r.Date || !r.HomeTeam || !r.AwayTeam) continue;
    const date = parseDate(r.Date), day = toDay(date);
    if (day < asOfDay || day > asOfDay + 14) continue;
    const p = predict(r.HomeTeam, r.AwayTeam);
    const market = implied(+r.PSH, +r.PSD, +r.PSA) || implied(+r.PPH, +r.PPD, +r.PPA) || implied(+r.AvgH, +r.AvgD, +r.AvgA);
    out.push({ date, home: r.HomeTeam, away: r.AwayTeam, pH: p.pH, pD: p.pD, pA: p.pA,
      xgH: +p.lambdaHome.toFixed(2), xgA: +p.lambdaAway.toFixed(2), market });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 赛季准备：拟合、当前积分表、剩余赛程以及每场的 λ 与比分矩阵。
 * asOf 缺省为数据最后一天 + 1（即用尽全部数据）。seed 只用于当前表并列抽签，与 simulateLeague 用同一个。
 */
function prepareLeague(matches, cfg, { asOf = null, modelOpts = {}, seed = 20260801 } = {}) {
  const division = cfg.division, season = cfg.season;
  const dataEnd = matches.length ? matches[matches.length - 1].day : 0;
  const asOfDay = asOf ? (typeof asOf === 'number' ? asOf : toDay(asOf)) : dataEnd + 1;
  const played = matches.filter(m => m.division === division && m.season === season && m.day < asOfDay);
  const teams = cfg.teams && cfg.teams.length ? [...cfg.teams] : seasonTeams(matches, division, season);

  // 赛前 Elo 一次遍历（主队 +HOME_ADV），同时得到当前 Elo
  const eloPre = new Map();
  runElo(matches, { until: asOfDay, onBefore(m, r) { eloPre.set(m, [(r.get(m.home) ?? 1500) + (m.neutral ? 0 : HOME_ADV), r.get(m.away) ?? 1500]); } });
  const elo = runElo(matches, { until: asOfDay });
  const model = dc.fit(matches, asOfDay, modelOpts, m => eloPre.get(m));

  const dist = new Map();
  const predict = (home, away) => {
    const key = home + '|' + away;
    if (!dist.has(key)) {
      const rh = (elo.get(home) ?? 1500) + HOME_ADV, ra = (elo.get(away) ?? 1500);
      const p = dc.predict(model, home, away, { neutral: false, eloDiff: rh - ra });
      const cells = [];
      let c = 0;
      for (let x = 0; x < p.matrix.length; x++) for (let y = 0; y < p.matrix[x].length; y++) { c += p.matrix[x][y]; cells.push([c, x, y]); }
      dist.set(key, { ...p, cells });
    }
    return dist.get(key);
  };

  const current = rankTable(teams, played, cfg.tiebreak, mulberry32(seed ^ 0x5f3759df));
  const rem = remainingFixtures(teams, played);
  const fixtures = rem.map(([h, a]) => predict(h, a));
  return { division, season, cfg, teams, played, rem, fixtures, model, elo, current, predict, asOfDay, dataEnd };
}

/** Box–Muller，一个标准正态（只用 rnd）。 */
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** τ 的上界（负值按 0 处理），用于拒绝抽样。 */
function tauMax(l, m, rho) {
  let t = 1;
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const v = dc.tau(x, y, l, m, rho);
    if (v > t) t = v;
  }
  return t;
}

/** 精确抽 Dixon-Coles 比分：先独立抽两个 Poisson，再以 τ/τmax 接受，否则重抽。 */
function sampleDC(l, m, rho, rnd) {
  const tmax = tauMax(l, m, rho);
  for (;;) {
    const x = poissonSample(l, rnd), y = poissonSample(m, rnd);
    const t = dc.tau(x, y, l, m, rho);
    if (t <= 0) continue;
    if (t >= tmax || rnd() < t / tmax) return [x, y];
  }
}

/**
 * 赛季蒙特卡洛：返回每队的名次计数与积分和。
 * sigma > 0 时，每次模拟开头给每队抽 δ ~ N(0, σ²)，剩余比赛用 λ·exp(δh−δa) 抽精确 DC 比分；
 * sigma = 0 时沿用比分矩阵抽样，随机数消耗与拆分前逐位相同。
 */
function runSeason(prep, { sims = 20000, seed = 20260801, sigma = 0 } = {}) {
  const { teams, rem, played, fixtures, cfg, model } = prep;
  if (!(sigma >= 0)) throw new Error(`sigma 必须 ≥ 0（收到 ${sigma}）`);
  const rnd = mulberry32(seed);
  const tally = new Map(teams.map(t => [t, new Float64Array(teams.length)]));
  const ptsSum = new Map(teams.map(t => [t, 0]));

  const base = played.map(m => ({ home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const results = base.concat(rem.map(([home, away]) => ({ home, away, hg: 0, ag: 0 })));
  const idx = new Map(teams.map((t, i) => [t, i]));
  const hi = rem.map(([h]) => idx.get(h)), ai = rem.map(([, a]) => idx.get(a));
  const delta = new Float64Array(teams.length);
  const rho = model.rho;

  for (let s = 0; s < sims; s++) {
    if (sigma > 0) {
      for (let i = 0; i < teams.length; i++) delta[i] = sigma * gauss(rnd);
      for (let i = 0; i < rem.length; i++) {
        const f = fixtures[i], dh = delta[hi[i]], da = delta[ai[i]];
        const [hg, ag] = sampleDC(f.lambdaHome * Math.exp(dh - da), f.lambdaAway * Math.exp(da - dh), rho, rnd);
        results[base.length + i].hg = hg; results[base.length + i].ag = ag;
      }
    } else {
      for (let i = 0; i < rem.length; i++) {
        const [hg, ag] = sampleFrom(fixtures[i].cells, rnd);
        results[base.length + i].hg = hg; results[base.length + i].ag = ag;
      }
    }
    const table = rankTable(teams, results, cfg.tiebreak, rnd);
    for (let i = 0; i < table.length; i++) {
      tally.get(table[i].team)[i]++;
      ptsSum.set(table[i].team, ptsSum.get(table[i].team) + table[i].pts);
    }
  }
  return { sims, sigma, teams, tally, ptsSum };
}

/**
 * 赛季模拟：当季已赛用真实比分，剩余按模型比分矩阵抽样，逐场排名。
 * sigma > 0 时每次模拟额外抽每队实力扰动（见 runSeason）。
 */
function simulateLeague(matches, cfg, { sims = 20000, seed = 20260801, asOf = null, modelOpts = {}, sigma = 0 } = {}) {
  const division = cfg.division, season = cfg.season;
  const prep = prepareLeague(matches, cfg, { asOf, modelOpts, seed });
  const { teams, played, rem, model, elo, current, predict, asOfDay } = prep;
  const { tally, ptsSum } = runSeason(prep, { sims, seed, sigma });

  const zoneProbs = t => Object.fromEntries((cfg.zones || []).map(z => {
    let s = 0;
    for (let i = z.from - 1; i <= z.to - 1 && i < teams.length; i++) s += tally.get(t)[i];
    return [z.key, s / sims];
  }));

  const teamOut = current.map((r, idx) => ({
    team: r.team, elo: Math.round(elo.get(r.team) ?? 1500),
    attack: +(model.att.get(r.team) || 0).toFixed(3), defence: +(model.def.get(r.team) || 0).toFixed(3),
    current: { p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts },
    expectedPts: +(ptsSum.get(r.team) / sims).toFixed(2),
    position: idx + 1,
    positions: Array.from(tally.get(r.team), x => x / sims),
    zones: zoneProbs(r.team),
  }));

  const bounds = seasonBounds(season);
  return {
    kind: 'league',
    league: { id: cfg.id, name: cfg.name, nameZh: cfg.nameZh, division, season, start: bounds.start, end: bounds.end },
    generatedAt: new Date().toISOString(),
    asOf: new Date(asOfDay * DAY).toISOString().slice(0, 10),
    dataThrough: matches.length ? matches[matches.length - 1].date : null,
    sims, seed, sigma,
    played: played.length, remaining: rem.length,
    zonesDef: cfg.zones || [],
    names: cfg.names || {},
    model: { ...model.cfg, mu: +model.mu.toFixed(4), homeAdvantage: +model.h.toFixed(4), rho: model.rho },
    teams: teamOut,
    upcoming: upcomingFixtures(cfg, asOfDay, predict),
  };
}

module.exports = { TOP, remainingFixtures, rankTable, prepareLeague, runSeason, sampleDC, tauMax, simulateLeague, seasonBounds };
