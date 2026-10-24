'use strict';
// 通用赛事蒙特卡洛：小组循环 → 排名（含相互战绩）→ 最佳第三 → 淘汰赛（加时 + 点球）。
// 已经踢完的比赛（数据集里同赛事、赛期内）直接用真实比分，只模拟剩下的。
const { runElo, HOME_ADV } = require('./elo');
const dc = require('./dc');
const { toDay } = require('./data');

const ET_FACTOR = 1 / 3;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSample(lambda, rnd) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}

/** 预计算每对球队的比分分布（扁平累积表，抽样 O(格数)）。 */
function makeMatchCache(model, elo, hosts) {
  const cache = new Map();
  return function get(a, b) {
    const key = a + '|' + b;
    if (cache.has(key)) return cache.get(key);
    const aHome = hosts.has(a) && !hosts.has(b), bHome = hosts.has(b) && !hosts.has(a);
    let home = a, away = b, flip = false;
    if (bHome) { home = b; away = a; flip = true; }
    const rh = (elo.get(home) ?? 1500) + (aHome || bHome ? HOME_ADV : 0), ra = elo.get(away) ?? 1500;
    const p = dc.predict(model, home, away, { neutral: !(aHome || bHome), eloDiff: rh - ra });
    const cells = [];
    let c = 0;
    for (let x = 0; x < p.matrix.length; x++) for (let y = 0; y < p.matrix[x].length; y++) {
      c += p.matrix[x][y];
      cells.push(flip ? [c, y, x] : [c, x, y]);
    }
    const out = {
      cells,
      lambdaA: flip ? p.lambdaAway : p.lambdaHome, lambdaB: flip ? p.lambdaHome : p.lambdaAway,
      pA: flip ? p.pA : p.pH, pD: p.pD, pB: flip ? p.pH : p.pA,
      likely: mostLikely(p.matrix, flip),
    };
    cache.set(key, out);
    return out;
  };
}

function mostLikely(P, flip) {
  let best = [0, 0], bp = -1;
  for (let x = 0; x < P.length; x++) for (let y = 0; y < P[x].length; y++) if (P[x][y] > bp) { bp = P[x][y]; best = [x, y]; }
  return flip ? [best[1], best[0]] : best;
}

function sampleScore(m, rnd) {
  const u = rnd() * m.cells[m.cells.length - 1][0];
  let lo = 0, hi = m.cells.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (m.cells[mid][0] < u) lo = mid + 1; else hi = mid; }
  return [m.cells[lo][1], m.cells[lo][2]];
}

/** 排名：积分 → 相互战绩（积分、净胜、进球）→ 总净胜 → 总进球 → 随机。 */
function rankGroup(teams, results, rnd) {
  const st = new Map(teams.map(t => [t, { team: t, pts: 0, gd: 0, gf: 0, lot: rnd() }]));
  for (const [a, b, ga, gb] of results) {
    const A = st.get(a), B = st.get(b);
    A.gf += ga; B.gf += gb; A.gd += ga - gb; B.gd += gb - ga;
    if (ga > gb) A.pts += 3; else if (ga < gb) B.pts += 3; else { A.pts++; B.pts++; }
  }
  const rows = [...st.values()];
  const byPts = new Map();
  for (const r of rows) { if (!byPts.has(r.pts)) byPts.set(r.pts, []); byPts.get(r.pts).push(r); }
  for (const tied of byPts.values()) {
    const set = new Set(tied.map(r => r.team));
    for (const r of tied) { r.hp = 0; r.hgd = 0; r.hgf = 0; }
    if (tied.length > 1) for (const [a, b, ga, gb] of results) {
      if (!set.has(a) || !set.has(b)) continue;
      const A = st.get(a), B = st.get(b);
      A.hgf += ga; B.hgf += gb; A.hgd += ga - gb; B.hgd += gb - ga;
      if (ga > gb) A.hp += 3; else if (ga < gb) B.hp += 3; else { A.hp++; B.hp++; }
    }
  }
  rows.sort((x, y) => y.pts - x.pts || y.hp - x.hp || y.hgd - x.hgd || y.hgf - x.hgf || y.gd - x.gd || y.gf - x.gf || x.lot - y.lot);
  return rows;
}

function roundRobin(teams) {
  const out = [];
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) out.push([teams[i], teams[j]]);
  return out;
}

/** 第三名分配：有官方组合表就查表；否则按 allowed 约束回溯（标记 approximate）。 */
function assignThirds(event, qualifiedGroups) {
  const key = [...qualifiedGroups].sort().join('');
  const tt = event.thirdTable;
  if (tt && tt.combos && tt.combos[key]) {
    const s = tt.combos[key];
    return { map: Object.fromEntries(tt.slots.map((slot, i) => [slot, s[i]])), approximate: false };
  }
  const slots = Object.keys(event.thirdAllowed || {});
  const res = {}, used = new Set();
  const solve = i => {
    if (i === slots.length) return true;
    for (const g of event.thirdAllowed[slots[i]]) {
      if (!qualifiedGroups.includes(g) || used.has(g)) continue;
      res[slots[i]] = g; used.add(g);
      if (solve(i + 1)) return true;
      used.delete(g);
    }
    return false;
  };
  if (!solve(0)) throw new Error(`第三名无法分配：${key}`);
  return { map: res, approximate: true };
}

/** 从数据集取本届已踢比赛：同赛事、赛期内。返回 Map(a|b → [ga, gb, shootoutWinner])，双向。 */
function playedResults(matches, event) {
  const s = toDay(event.start), e = toDay(event.end);
  const out = new Map();
  for (const m of matches) {
    if (m.tournament !== event.tournament || m.day < s || m.day > e) continue;
    out.set(m.home + '|' + m.away, [m.hg, m.ag, m.shootoutWinner]);
    out.set(m.away + '|' + m.home, [m.ag, m.hg, m.shootoutWinner]);
  }
  return out;
}

function simulate(matches, event, { sims = 20000, seed = 20270107, asOf = null, modelOpts = {} } = {}) {
  const asOfDay = asOf ? toDay(asOf) : Math.min(toDay(event.start), matches[matches.length - 1].day + 1);
  const elo = runElo(matches, { until: asOfDay });
  const eloAt = (() => {
    const pre = new Map();
    runElo(matches, { onBefore(m, r) { pre.set(m, [(r.get(m.home) ?? 1500) + (m.neutral ? 0 : HOME_ADV), r.get(m.away) ?? 1500]); }, until: asOfDay });
    return m => pre.get(m);
  })();
  const model = dc.fit(matches, asOfDay, modelOpts, eloAt);
  const hosts = new Set(event.host || []);
  const get = makeMatchCache(model, elo, hosts);
  const played = playedResults(matches, event);
  const rnd = mulberry32(seed);

  const groups = Object.keys(event.groups);
  const teams = groups.flatMap(g => event.groups[g]);
  const rounds = event.knockout.rounds;
  const tally = new Map(teams.map(t => [t, { pos: [0, 0, 0, 0], advance: 0, reach: Object.fromEntries(rounds.map(r => [r, 0])), champion: 0 }]));
  let approximateThirds = 0;

  const playKO = (a, b) => {
    const k = played.get(a + '|' + b);
    if (k) {
      const [ga, gb, sw] = k;
      if (ga !== gb) return ga > gb ? a : b;
      return sw || (rnd() < 0.5 ? a : b);
    }
    const m = get(a, b);
    let [ga, gb] = sampleScore(m, rnd);
    if (ga !== gb) return ga > gb ? a : b;
    ga += poissonSample(m.lambdaA * ET_FACTOR, rnd); gb += poissonSample(m.lambdaB * ET_FACTOR, rnd);
    if (ga !== gb) return ga > gb ? a : b;
    return rnd() < 0.5 ? a : b;
  };

  for (let s = 0; s < sims; s++) {
    const standing = {}, thirds = [];
    for (const g of groups) {
      const res = roundRobin(event.groups[g]).map(([a, b]) => {
        const k = played.get(a + '|' + b);
        const [ga, gb] = k ? k : sampleScore(get(a, b), rnd);
        return [a, b, ga, gb];
      });
      const rows = rankGroup(event.groups[g], res, rnd);
      rows.forEach((r, i) => tally.get(r.team).pos[i]++);
      standing[g] = rows.map(r => r.team);
      if (event.advance.bestThirds) thirds.push({ ...rows[2], group: g });
    }
    const slot = {};
    for (const g of groups) for (let i = 0; i < event.advance.perGroup; i++) slot[`${i + 1}${g}`] = standing[g][i];
    if (event.advance.bestThirds) {
      thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.lot - y.lot);
      const q = thirds.slice(0, event.advance.bestThirds);
      const { map, approximate } = assignThirds(event, q.map(t => t.group));
      if (approximate) approximateThirds++;
      for (const [winnerSlot, g] of Object.entries(map)) slot[`3@${winnerSlot}`] = standing[g][2];
    }
    let alive = event.knockout.firstRound.map(([x, y]) => [slot[x], slot[y]]);
    for (const [a, b] of alive) { tally.get(a).advance++; tally.get(b).advance++; }
    for (let r = 0; r < rounds.length; r++) {
      const winners = [];
      for (const [a, b] of alive) {
        tally.get(a).reach[rounds[r]]++; tally.get(b).reach[rounds[r]]++;
        winners.push(playKO(a, b));
      }
      if (winners.length === 1) { tally.get(winners[0]).champion++; break; }
      alive = [];
      for (let i = 0; i < winners.length; i += 2) alive.push([winners[i], winners[i + 1]]);
    }
  }

  const pct = x => x / sims;
  const teamOut = teams.map(t => {
    const x = tally.get(t);
    return {
      team: t, group: groups.find(g => event.groups[g].includes(t)), elo: Math.round(elo.get(t) ?? 1500),
      attack: +(model.att.get(t) || 0).toFixed(3), defence: +(model.def.get(t) || 0).toFixed(3),
      position: x.pos.map(pct), advance: pct(x.advance),
      reach: Object.fromEntries(Object.entries(x.reach).map(([k, v]) => [k, pct(v)])), champion: pct(x.champion),
    };
  }).sort((a, b) => b.champion - a.champion || b.advance - a.advance);

  const groupMatches = Object.fromEntries(groups.map(g => [g, roundRobin(event.groups[g]).map(([a, b]) => {
    const m = get(a, b), k = played.get(a + '|' + b);
    return { a, b, pA: m.pA, pD: m.pD, pB: m.pB, xgA: +m.lambdaA.toFixed(2), xgB: +m.lambdaB.toFixed(2), likely: m.likely,
      played: k ? [k[0], k[1]] : null };
  })]));

  return {
    event: { id: event.id, name: event.name, nameZh: event.nameZh, start: event.start, end: event.end, host: event.host || [] },
    generatedAt: new Date().toISOString(), asOf: new Date(asOfDay * 86400000).toISOString().slice(0, 10),
    dataThrough: matches[matches.length - 1].date, sims, seed,
    model: { ...model.cfg, mu: +model.mu.toFixed(4), homeAdvantage: +model.h.toFixed(4), rho: model.rho },
    playedMatches: played.size / 2, approximateThirdsShare: approximateThirds / sims,
    names: event.names || {}, teams: teamOut, groupMatches, rounds,
  };
}

module.exports = { simulate, rankGroup, assignThirds, roundRobin, mulberry32, poissonSample, playedResults };
