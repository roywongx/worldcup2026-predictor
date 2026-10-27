'use strict';
// 欧战赛制引擎：欧冠联赛阶段（36 队 8 轮，1–8 直接进 16 强、9–24 打附加赛、25–36 出局）
// 与解放者杯（8 组 × 4 双循环 → 小组前 2 → 16 强起两回合，决赛单场）。
// 与联赛引擎同一套模型（Dixon-Coles + Elo + σ 实力扰动）：已赛用真实比分，剩余场次只按 API 给的赛程抽样。
// 赛程只信 API（不自己造对阵）；抽签环节（欧战附加赛/16 强配对、解放者杯 16 强抽签）按官方结构随机近似。
const { runElo, HOME_ADV } = require('./elo');
const dc = require('./dc');
const { mulberry32 } = require('./simulate');
const { toDay } = require('./data');
const { rankTable, sampleDC } = require('./league');
const { applyAliases } = require('./eurodata');

const DAY = 86400000;

/**
 * 拟合池：国内联赛 CSV 比赛 + 本赛事的欧战比赛。欧战队名按 cfg.modelNames 归一到 football-data.co.uk 的写法
 * （同一个俱乐部两边写法不同，不归一会变成两支球队）。
 * divisions 给定时只保留这些级别（双池时用）。
 */
function euroPool(domestic, euroMatches, cfg, { divisions = null, alias = null } = {}) {
  const map = alias || cfg.modelNames || {};
  const all = domestic.concat(applyAliases(euroMatches, map)).sort((a, b) => a.day - b.day);
  if (!divisions) return all;
  const set = new Set(divisions);
  return all.filter(m => set.has(m.division));
}

/** 联赛阶段剩余场次：API 赛程里 day ≥ asOf 的场次（已经踢过的同日/更早场次不算）。 */
function swissRemaining(scheduled, asOfDay, played = []) {
  const done = new Set(played.map(m => m.home + '|' + m.away));
  return (scheduled || []).filter(m => m.day >= asOfDay && !done.has(m.home + '|' + m.away));
}

/** 联赛阶段排名：直接复用 league.rankTable 的同分规则机制（pts/gd/gf/away_gf/wins/away_wins/h2h_*）。 */
function rankSwiss(teams, results, tiebreak, rnd) {
  return rankTable(teams, results, tiebreak, rnd);
}

/** 两回合的主客场：firstHome 先主场。 */
function legOrder(a, b, { firstHome = b } = {}) {
  const h1 = firstHome === a ? a : b, a1 = firstHome === a ? b : a;
  return [[h1, a1], [a1, h1]];
}

function sampleFrom(cells, rnd) {
  const u = rnd() * cells[cells.length - 1][0];
  let lo = 0, hi = cells.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cells[mid][0] < u) lo = mid + 1; else hi = mid; }
  return [cells[lo][1], cells[lo][2]];
}

/** 比分矩阵缓存：neutral=true 时不加主场优势；key() 把 API 队名映射到拟合池里的写法。 */
function matchCache(model, elo, key = t => t) {
  const cache = new Map();
  return function get(home, away, neutral = false) {
    const k = key(home) + '|' + key(away) + '|' + (neutral ? 1 : 0);
    if (cache.has(k)) return cache.get(k);
    const rh = (elo.get(key(home)) ?? 1500) + (neutral ? 0 : HOME_ADV), ra = elo.get(key(away)) ?? 1500;
    const p = dc.predict(model, key(home), key(away), { neutral, eloDiff: rh - ra });
    const cells = [];
    let c = 0;
    for (let x = 0; x < p.matrix.length; x++) for (let y = 0; y < p.matrix[x].length; y++) { c += p.matrix[x][y]; cells.push([c, x, y]); }
    const out = { ...p, cells };
    cache.set(k, out);
    return out;
  };
}

/** 预备：拟合（只用 asOf 之前的比赛）、Elo、比分矩阵缓存。alias 把 API 队名映射到拟合池写法。 */
function prepareEuro(matches, cfg, { asOf = null, modelOpts = {}, alias = null } = {}) {
  const dataEnd = matches.length ? matches[matches.length - 1].day : 0;
  const asOfDay = asOf ? (typeof asOf === 'number' ? asOf : toDay(asOf)) : dataEnd + 1;
  const eloPre = new Map();
  runElo(matches, { until: asOfDay, onBefore(m, r) { eloPre.set(m, [(r.get(m.home) ?? 1500) + (m.neutral ? 0 : HOME_ADV), r.get(m.away) ?? 1500]); } });
  const elo = runElo(matches, { until: asOfDay });
  const model = dc.fit(matches, asOfDay, modelOpts, m => eloPre.get(m));
  const key = t => (alias && alias[t]) || t;
  return { asOfDay, dataEnd, model, elo, key, get: matchCache(model, elo, key), cfg };
}

/** 抽一场比分：有真实比分就用真实的（已赛的比赛不该被重抽）。 */
function sample(prep, home, away, rnd, { neutral = false, real = null, delta = null, sigma = 0 } = {}) {
  const r = real && real.get(home + '|' + away);
  if (r) return [r[0], r[1]];
  if (sigma > 0 && delta) {
    const f = prep.get(home, away, neutral);
    const dh = delta.get(home) || 0, da = delta.get(away) || 0;
    return sampleDC(f.lambdaHome * Math.exp(dh - da), f.lambdaAway * Math.exp(da - dh), prep.model.rho, rnd);
  }
  return sampleFrom(prep.get(home, away, neutral).cells, rnd);
}

/** 单场定胜负：平 → 真实点球（有就用），否则点球按五五开（近似；不单独建模加时）。 */
function playSingle(prep, a, b, rnd, { neutral = true, real = null, pens = null, delta = null, sigma = 0 } = {}) {
  const [ga, gb] = sample(prep, a, b, rnd, { neutral, real, delta, sigma });
  if (ga !== gb) return ga > gb ? a : b;
  if (pens && pens[0] !== pens[1]) return pens[0] > pens[1] ? a : b;
  return rnd() < 0.5 ? a : b;
}

/**
 * 两回合：主客各一场，按总比分晋级；总比分平 → 点球五五开（近似，加时不单独建模）。
 * 已赛的回合用真实比分；缺失的回合才抽样。返回 { a, b, legs, aggA, aggB, winner, decidedBy }。
 */
function twoLeg(prep, a, b, rnd, { firstHome = b, real = null, pens = null, delta = null, sigma = 0 } = {}) {
  const legs = legOrder(a, b, { firstHome });
  let ga = 0, gb = 0;
  const out = [];
  for (const [h, aw] of legs) {
    const [hg, ag] = sample(prep, h, aw, rnd, { real, delta, sigma });
    out.push({ home: h, away: aw, hg, ag });
    if (h === a) { ga += hg; gb += ag; } else { ga += ag; gb += hg; }
  }
  if (ga !== gb) return { a, b, legs: out, aggA: ga, aggB: gb, winner: ga > gb ? a : b, decidedBy: 'agg' };
  if (pens && pens[0] !== pens[1]) return { a, b, legs: out, aggA: ga, aggB: gb, winner: pens[0] > pens[1] ? a : b, decidedBy: 'pens' };
  return { a, b, legs: out, aggA: ga, aggB: gb, winner: rnd() < 0.5 ? a : b, decidedBy: 'pens' };
}

/** 洗牌（Fisher–Yates，只用 rnd）。 */
function shuffle(list, rnd) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Box–Muller 标准正态（σ 扰动用）。 */
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** 预测一场（页面「赛程」用）：主/平/客、期望进球、最可能比分。 */
function predictRow(prep, home, away, neutral) {
  const f = prep.get(home, away, neutral);
  let best = [0, 0], bp = -1;
  for (let x = 0; x < f.matrix.length; x++) for (let y = 0; y < f.matrix[x].length; y++) if (f.matrix[x][y] > bp) { bp = f.matrix[x][y]; best = [x, y]; }
  return { pH: f.pH, pD: f.pD, pA: f.pA, xgH: +f.lambdaHome.toFixed(2), xgA: +f.lambdaAway.toFixed(2), likely: best };
}

const pctOf = (x, n) => x / n;

/**
 * 欧冠式联赛阶段 + 淘汰赛。每次模拟里把联赛阶段排完，再按官方签位（附加赛/16 强配对）两回合打到决赛。
 * cfg.bands / playoffGroups / r16Groups / qfBracket / sfBracket 见事件配置。
 */
function simulateSwiss(matches, scheduled, cfg, { sims = 20000, seed = 20260801, asOf = null, modelOpts = {}, sigma = 0, pool = null } = {}) {
  if (!(sigma >= 0)) throw new Error(`sigma 必须 ≥ 0（收到 ${sigma}）`);
  const teams = [...cfg.teams];
  const dataEnd = matches.length ? matches[matches.length - 1].day : 0;
  const asOfDay = asOf ? (typeof asOf === 'number' ? asOf : toDay(asOf)) : dataEnd + 1;
  const prep = prepareEuro(pool || matches, cfg, { asOf: asOfDay, modelOpts, alias: cfg.modelNames });
  const season = String(cfg.season);
  const mine = matches.filter(m => m.division === cfg.code && m.season === season && m.day < asOfDay);
  const played = mine.filter(m => !m.stage || m.stage === 'LEAGUE_STAGE');
  const koPlayed = mine.filter(m => m.stage && m.stage !== 'LEAGUE_STAGE');
  const remaining = swissRemaining(scheduled, asOfDay, played);
  const real = new Map();
  for (const m of mine) real.set(m.home + '|' + m.away, [m.hg, m.ag]);

  const rnd = mulberry32(seed);
  const current = rankSwiss(teams, played, cfg.tiebreak, mulberry32(seed ^ 0x5f3759df));
  const posCount = new Map(teams.map(t => [t, new Float64Array(teams.length)]));
  const ptsSum = new Map(teams.map(t => [t, 0]));
  const bands = cfg.bands || [];
  const bandKeys = bands.map(b => b.key);
  const bandCount = new Map(teams.map(t => [t, Object.fromEntries(bandKeys.map(k => [k, 0]))]));
  const ko = new Map(teams.map(t => [t, { r16: 0, qf: 0, sf: 0, final: 0, title: 0 }]));
  const bandOf = pos => { for (const b of bands) if (pos >= b.from && pos <= b.to) return b.key; return null; };

  const results = played.map(m => ({ home: m.home, away: m.away, hg: m.hg, ag: m.ag }))
    .concat(remaining.map(m => ({ home: m.home, away: m.away, hg: 0, ag: 0 })));

  for (let s = 0; s < sims; s++) {
    const delta = sigma > 0 ? new Map(teams.map(t => [t, sigma * gauss(rnd)])) : null;
    for (let i = 0; i < remaining.length; i++) {
      const [hg, ag] = sample(prep, remaining[i].home, remaining[i].away, rnd, { real, delta, sigma });
      results[played.length + i].hg = hg; results[played.length + i].ag = ag;
    }
    const table = rankSwiss(teams, results, cfg.tiebreak, rnd);
    for (let i = 0; i < table.length; i++) {
      posCount.get(table[i].team)[i]++;
      ptsSum.set(table[i].team, ptsSum.get(table[i].team) + table[i].pts);
      const b = bandOf(i + 1);
      if (b) bandCount.get(table[i].team)[b]++;
    }
    const order = table.map(r => r.team);

    // ── 附加赛：官方配对区间内随机（种子队第二回合主场） ──
    const playoffWinners = [];
    for (const g of cfg.playoffGroups) {
      const seeded = shuffle(g.seeded.map(r => order[r - 1]), rnd);
      const unseeded = shuffle(g.unseeded.map(r => order[r - 1]), rnd);
      const win = [];
      for (let i = 0; i < seeded.length; i++) {
        win.push(twoLeg(prep, seeded[i], unseeded[i], rnd, { firstHome: unseeded[i], real, delta, sigma }).winner);
      }
      playoffWinners.push(win);
    }

    // ── 16 强：官方固定签位（1/2 名对附加赛 IV 的两个胜者…），区内随机分配（近似抽签） ──
    const r16Pairs = [];
    for (const g of cfg.r16Groups) {
      const seeds = shuffle(g.seeds.map(r => order[r - 1]), rnd);
      const opp = shuffle((playoffWinners[g.playoffGroup] || []).slice(), rnd);
      for (let i = 0; i < seeds.length; i++) if (seeds[i] && opp[i]) r16Pairs.push([seeds[i], opp[i]]);
    }
    if (r16Pairs.length !== 2 * cfg.qfBracket.length) throw new Error(`16 强 ${r16Pairs.length} 组对阵，8 强签位需要 ${2 * cfg.qfBracket.length} 队（检查 cfg.r16Groups / qfBracket）`);
    for (const [a, b] of r16Pairs) { ko.get(a).r16++; ko.get(b).r16++; }
    const r16Winners = r16Pairs.map(([a, b]) => twoLeg(prep, a, b, rnd, { firstHome: b, real, delta, sigma }).winner);

    // ── 8 强 / 4 强 / 决赛（签位固定；首回合主场官方抽签，这里按名单顺序近似） ──
    const playRound = (entries, bracket, key) => {
      if (entries.length !== 2 * bracket.length) throw new Error(`${key} 签位需要 ${2 * bracket.length} 队，得到 ${entries.length}`);
      const pairs = bracket.map(([i, j]) => [entries[i], entries[j]]);
      for (const [a, b] of pairs) { ko.get(a)[key]++; ko.get(b)[key]++; }
      return pairs.map(([a, b]) => twoLeg(prep, a, b, rnd, { firstHome: b, real, delta, sigma }).winner);
    };
    const qfWinners = playRound(r16Winners, cfg.qfBracket, 'qf');
    const sfWinners = playRound(qfWinners, cfg.sfBracket, 'sf');
    if (sfWinners.length !== 2) throw new Error(`4 强应是 2 组对阵，得到 ${sfWinners.length}`);
    for (const t of sfWinners) ko.get(t).final++;
    const champion = playSingle(prep, sfWinners[0], sfWinners[1], rnd, { neutral: true, real, delta, sigma });
    ko.get(champion).title++;
  }

  const p = x => pctOf(x, sims);
  const teamOut = current.map((r, i) => ({
    team: r.team, elo: Math.round(prep.elo.get(r.team) ?? 1500),
    attack: +(prep.model.att.get(r.team) || 0).toFixed(3), defence: +(prep.model.def.get(r.team) || 0).toFixed(3),
    current: { p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts },
    expectedPts: +(ptsSum.get(r.team) / sims).toFixed(2),
    position: i + 1,
    positions: Array.from(posCount.get(r.team), x => x / sims),
    bands: Object.fromEntries(bandKeys.map(k => [k, p(bandCount.get(r.team)[k])])),
    knockout: { r16: p(ko.get(r.team).r16), qf: p(ko.get(r.team).qf), sf: p(ko.get(r.team).sf), final: p(ko.get(r.team).final), title: p(ko.get(r.team).title) },
  }));

  const upcoming = remaining.map(m => {
    const q = predictRow(prep, m.home, m.away, !!m.neutral);
    return { date: m.date, stage: m.stage || 'LEAGUE_STAGE', matchday: m.matchday == null ? null : m.matchday,
      home: m.home, away: m.away, pH: q.pH, pD: q.pD, pA: q.pA, xgH: q.xgH, xgA: q.xgA, likely: q.likely,
      neutral: !!m.neutral, market: null };
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    kind: 'swiss',
    league: { id: cfg.id, name: cfg.name, nameZh: cfg.nameZh, code: cfg.code, season, start: cfg.start, end: cfg.end },
    generatedAt: new Date().toISOString(),
    asOf: new Date(asOfDay * DAY).toISOString().slice(0, 10),
    dataThrough: mine.length ? mine[mine.length - 1].date : null,
    sims, seed, sigma,
    played: played.length, remaining: remaining.length, knockoutPlayed: koPlayed.length,
    bandsDef: bands,
    names: cfg.names || {},
    model: { ...prep.model.cfg, mu: +prep.model.mu.toFixed(4), homeAdvantage: +prep.model.h.toFixed(4), rho: prep.model.rho },
    marketAvailable: false,
    teams: teamOut,
    upcoming,
  };
}

/** 从已赛/已排赛程里按阶段重建淘汰赛对阵：stage|两支球队 → 回合列表（含点球）。 */
function knockoutTies(matches, scheduled, cfg = {}) {
  const out = new Map();
  const add = (stage, home, away, score, date, pens) => {
    const key = stage + '|' + [home, away].sort().join('|');
    if (!out.has(key)) out.set(key, { stage, a: home, b: away, legs: [], pens: null, pensMatch: null });
    const t = out.get(key);
    t.legs.push({ date, day: toDay(date), home, away, hg: score ? score[0] : null, ag: score ? score[1] : null });
    if (pens) { t.pens = pens; t.pensMatch = { home, away }; }
  };
  for (const m of matches) {
    if (!m.stage || m.stage === 'GROUP_STAGE' || m.stage === 'LEAGUE_STAGE') continue;
    add(m.stage, m.home, m.away, [m.hg, m.ag], m.date, m.pens || null);
  }
  for (const m of scheduled) {
    if (!m.stage || m.stage === 'GROUP_STAGE' || m.stage === 'LEAGUE_STAGE') continue;
    if (!m.home || !m.away) continue;
    add(m.stage, m.home, m.away, null, m.date, null);
  }
  for (const t of out.values()) t.legs.sort((x, y) => x.day - y.day);
  return out;
}

/** 真实的两回合结果 → 胜者（总比分 → 点球）。未定胜者返回 null。 */
function tieWinner(t) {
  if (!t || !t.legs.length || t.legs.some(l => l.hg == null)) return null;
  let ga = 0, gb = 0;
  for (const l of t.legs) {
    if (l.home === t.a) { ga += l.hg; gb += l.ag; } else { ga += l.ag; gb += l.hg; }
  }
  if (ga !== gb) return ga > gb ? t.a : t.b;
  if (t.pens) {
    const [pa, pb] = t.pensMatch.home === t.a ? t.pens : [t.pens[1], t.pens[0]];
    if (pa !== pb) return pa > pb ? t.a : t.b;
  }
  return null;
}

/** 解放者杯 16 强抽签近似：小组第一抽小组第二，同组回避。 */
function drawRoundOf16(winners, runners, rnd) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rs = shuffle(runners, rnd);
    if (winners.every((w, i) => w.group !== rs[i].group)) return winners.map((w, i) => [w.team, rs[i].team]);
  }
  return winners.map((w, i) => [w.team, runners[i].team]);
}

/** 一个淘汰赛对阵：用已排赛程定主客与已赛比分，缺的回合补上。 */
function playTie(prep, a, b, rnd, { tie = null, single = false, real = null, delta = null, sigma = 0 } = {}) {
  const legs = [];
  if (tie) for (const l of tie.legs) legs.push({ home: l.home, away: l.away, score: l.hg != null ? [l.hg, l.ag] : null });
  const want = single ? 1 : 2;
  const fallback = single ? [[a, b]] : legOrder(a, b, { firstHome: b });
  for (let i = legs.length; i < want; i++) legs.push({ home: fallback[i][0], away: fallback[i][1], score: null });
  let ga = 0, gb = 0;
  for (const l of legs.slice(0, want)) {
    const [hg, ag] = l.score || sample(prep, l.home, l.away, rnd, { neutral: single, real, delta, sigma });
    if (l.home === a) { ga += hg; gb += ag; } else { ga += ag; gb += hg; }
  }
  if (ga !== gb) return ga > gb ? a : b;
  if (tie && tie.pens) {
    const [pa, pb] = tie.pensMatch.home === a ? tie.pens : [tie.pens[1], tie.pens[0]];
    if (pa !== pb) return pa > pb ? a : b;
  }
  return rnd() < 0.5 ? a : b;
}

/**
 * 小组赛（4 队双循环）+ 两回合淘汰赛。
 * 16 强按「小组第一抽小组第二、同组回避」随机近似（真实赛制是抽签）；之后每轮按签位顺序两两配对。
 * API 已给出某轮的具体对阵时直接用实际对阵与真实比分；未定的回合才抽样。
 */
function simulateGroups2leg(matches, scheduled, cfg, { sims = 20000, seed = 20260801, asOf = null, modelOpts = {}, sigma = 0, pool = null } = {}) {
  if (!(sigma >= 0)) throw new Error(`sigma 必须 ≥ 0（收到 ${sigma}）`);
  const groups = cfg.groups || {};
  const groupKeys = Object.keys(groups);
  const teams = groupKeys.flatMap(g => groups[g]);
  const dataEnd = matches.length ? matches[matches.length - 1].day : 0;
  const asOfDay = asOf ? (typeof asOf === 'number' ? asOf : toDay(asOf)) : dataEnd + 1;
  const prep = prepareEuro(pool || matches, cfg, { asOf: asOfDay, modelOpts, alias: cfg.modelNames });
  const season = String(cfg.season);
  const mine = matches.filter(m => m.division === cfg.code && m.season === season && m.day < asOfDay);
  const playedGroup = mine.filter(m => !m.stage || m.stage === 'GROUP_STAGE');
  const playedKo = mine.filter(m => m.stage && m.stage !== 'GROUP_STAGE');
  const real = new Map();
  for (const m of mine) real.set(m.home + '|' + m.away, [m.hg, m.ag]);
  const groupOf = new Map(teams.map(t => [t, groupKeys.find(g => groups[g].includes(t))]));

  const remainingGroup = (scheduled || []).filter(m => (!m.stage || m.stage === 'GROUP_STAGE') && m.day >= asOfDay && !real.has(m.home + '|' + m.away));
  const ties = knockoutTies(playedKo, scheduled || [], cfg);

  const rnd = mulberry32(seed);
  const posCount = new Map(teams.map(t => [t, new Float64Array(4)]));
  const ptsSum = new Map(teams.map(t => [t, 0]));
  const advanceCount = new Map(teams.map(t => [t, 0]));
  const rounds = (cfg.rounds || []).map(r => r.key);
  const reach = new Map(teams.map(t => [t, Object.fromEntries(rounds.map(k => [k, 0]))]));
  const title = new Map(teams.map(t => [t, 0]));
  const stageOf = cfg.stageOf || {};

  const groupPlayed = groupKeys.map(g => playedGroup.filter(m => groups[g].includes(m.home) && groups[g].includes(m.away)));
  const groupRemaining = groupKeys.map(g => remainingGroup.filter(m => groups[g].includes(m.home) && groups[g].includes(m.away)));
  const keptTies = [...ties.values()].filter(t => t.a && t.b);

  for (let s = 0; s < sims; s++) {
    const delta = sigma > 0 ? new Map(teams.map(t => [t, sigma * gauss(rnd)])) : null;
    const standing = {};
    for (let gi = 0; gi < groupKeys.length; gi++) {
      const g = groupKeys[gi];
      const res = groupPlayed[gi].map(m => ({ home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
      for (const m of groupRemaining[gi]) {
        const [hg, ag] = sample(prep, m.home, m.away, rnd, { delta, sigma });
        res.push({ home: m.home, away: m.away, hg, ag });
      }
      const rows = rankTable(groups[g], res, cfg.tiebreak, rnd);
      rows.forEach((r, i) => { posCount.get(r.team)[i]++; ptsSum.set(r.team, ptsSum.get(r.team) + r.pts); });
      standing[g] = rows;
      for (const r of rows.slice(0, 2)) advanceCount.set(r.team, advanceCount.get(r.team) + 1);
    }

    let alive;
    const firstStage = stageOf[rounds[0]];
    const firstTies = keptTies.filter(t => t.stage === firstStage);
    if (firstTies.length === groupKeys.length) {
      alive = firstTies.map(t => [t.a, t.b]);
    } else {
      const winners = groupKeys.map(g => ({ team: standing[g][0].team, group: g }));
      const runners = groupKeys.map(g => ({ team: standing[g][1].team, group: g }));
      alive = drawRoundOf16(winners, runners, rnd);
    }

    let winners = [];
    for (let ri = 0; ri < rounds.length; ri++) {
      const key = rounds[ri], stage = stageOf[key], single = key === 'F';
      const stageTies = keptTies.filter(t => t.stage === stage);
      const keyOf = ([a, b]) => [a, b].sort().join('|');
      const aliveSet = new Set(alive.flat());
      const useReal = stageTies.length === alive.length && stageTies.every(t => aliveSet.has(t.a) && aliveSet.has(t.b));
      const pairs = useReal ? stageTies.map(t => [t.a, t.b]) : alive;
      for (const pr of pairs) for (const tm of pr) if (tm) reach.get(tm)[key]++;
      winners = pairs.map(([a, b]) => {
        const tie = stageTies.find(t => keyOf([t.a, t.b]) === keyOf([a, b])) || null;
        return playTie(prep, a, b, rnd, { tie, single, real, delta, sigma });
      });
      if (single) break;
      alive = [];
      for (let i = 0; i < winners.length; i += 2) alive.push([winners[i], winners[i + 1]]);
    }
    title.set(winners[0], title.get(winners[0]) + 1);
  }

  const p = x => pctOf(x, sims);
  const currentTables = Object.fromEntries(groupKeys.map(g => {
    const rows = rankTable(groups[g], groupPlayed[groupKeys.indexOf(g)], cfg.tiebreak, mulberry32(seed ^ 0x51ed));
    return [g, rows];
  }));
  const teamOut = groupKeys.flatMap(g => currentTables[g].map((r, i) => ({
    team: r.team, group: g, elo: Math.round(prep.elo.get(r.team) ?? 1500),
    attack: +(prep.model.att.get(r.team) || 0).toFixed(3), defence: +(prep.model.def.get(r.team) || 0).toFixed(3),
    current: { p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts },
    expectedPts: +(ptsSum.get(r.team) / sims).toFixed(2),
    position: i + 1,
    positions: Array.from(posCount.get(r.team), x => x / sims),
    advance: p(advanceCount.get(r.team)),
    reach: Object.fromEntries(rounds.map(k => [k, p(reach.get(r.team)[k])])),
    champion: p(title.get(r.team)),
  })));

  const upcoming = remainingGroup.map(m => {
    const q = predictRow(prep, m.home, m.away, false);
    return { date: m.date, stage: m.stage || 'GROUP_STAGE', group: m.group || groupOf.get(m.home), matchday: m.matchday == null ? null : m.matchday,
      home: m.home, away: m.away, pH: q.pH, pD: q.pD, pA: q.pA, xgH: q.xgH, xgA: q.xgA, likely: q.likely, neutral: false, market: null };
  }).concat(keptTies.filter(t => t.legs.some(l => l.hg == null)).map(t => {
    const q = predictRow(prep, t.a, t.b, t.stage === 'FINAL');
    return { date: t.legs[0].date, stage: t.stage, home: t.a, away: t.b, pH: q.pH, pD: q.pD, pA: q.pA,
      xgH: q.xgH, xgA: q.xgA, likely: q.likely, neutral: t.stage === 'FINAL', market: null };
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // 决赛对阵还没在 API 里（两队待定）时，用两场半决赛的真实胜者补一行（只是把已定的对阵写出来，不造赛程）
  if (!upcoming.some(u => u.stage === 'FINAL')) {
    const sfWinners = keptTies.filter(t => t.stage === (cfg.stageOf || {}).SF).map(tieWinner).filter(Boolean);
    if (sfWinners.length === 2) {
      const q = predictRow(prep, sfWinners[0], sfWinners[1], true);
      upcoming.push({ date: cfg.end, stage: 'FINAL', home: sfWinners[0], away: sfWinners[1], pH: q.pH, pD: q.pD, pA: q.pA,
        xgH: q.xgH, xgA: q.xgA, likely: q.likely, neutral: true, market: null, note: 'from-semi-finals' });
    }
  }

  return {
    kind: 'groups2leg',
    league: { id: cfg.id, name: cfg.name, nameZh: cfg.nameZh, code: cfg.code, season, start: cfg.start, end: cfg.end },
    generatedAt: new Date().toISOString(),
    asOf: new Date(asOfDay * DAY).toISOString().slice(0, 10),
    dataThrough: mine.length ? mine[mine.length - 1].date : null,
    sims, seed, sigma,
    played: playedGroup.length + playedKo.length,
    remaining: remainingGroup.length + upcoming.filter(u => u.stage !== 'GROUP_STAGE').length,
    groups: Object.fromEntries(groupKeys.map(g => [g, currentTables[g].map(r => r.team)])),
    zonesDef: [{ key: 'advance', from: 1, to: 2, label: '前 2 出线', labelEn: 'Top two advance' }],
    rounds,
    names: cfg.names || {},
    model: { ...prep.model.cfg, mu: +prep.model.mu.toFixed(4), homeAdvantage: +prep.model.h.toFixed(4), rho: prep.model.rho },
    marketAvailable: false,
    teams: teamOut,
    upcoming,
  };
}

module.exports = {
  swissRemaining, rankSwiss, twoLeg, playSingle, playTie, simulateSwiss, simulateGroups2leg,
  prepareEuro, matchCache, drawRoundOf16, knockoutTies, tieWinner, shuffle, legOrder, euroPool,
};
