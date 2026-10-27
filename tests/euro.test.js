'use strict';
// 欧战（欧冠联赛阶段、解放者杯小组赛+两回合淘汰）的验收契约。
// 全部用合成数据：不联网、不读 data/uefa/、不读 data/api-keys.json。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const euro = require('../engine/euro');
const eurodata = require('../engine/eurodata');
const { toDay } = require('../engine/data');
const { mulberry32 } = require('../engine/simulate');

// 欧战配置单独放在 engine/events/euro/：events/*.json 是国家队赛事的「小组+淘汰」通用赛制，
// 由 engine.test.js 逐个校验，欧战赛制不同不能混在一起。
const EVENTS = path.join(__dirname, '..', 'engine', 'events');
const EURO_EVENTS = path.join(EVENTS, 'euro');
const loadCfg = id => JSON.parse(fs.readFileSync(path.join(EURO_EVENTS, `${id}.json`), 'utf8'));
const UCL = loadCfg('ucl-2026-27');
const CLI = loadCfg('copa-libertadores-2026');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const opts = { halfLifeDays: 365, prior: 1, eloBeta: 0, windowDays: 1095 };

const mk = (date, home, away, hg, ag, extra = {}) => ({
  date, day: toDay(date), home, away, hg, ag,
  tournament: extra.code || 'CL', division: extra.code || 'CL', season: extra.season || '2627',
  neutral: !!extra.neutral, market: null, stage: extra.stage === undefined ? 'LEAGUE_STAGE' : extra.stage,
  leg: extra.leg == null ? null : extra.leg, ...(extra.pens ? { pens: extra.pens } : {}),
});

const addDays = (iso, n) => new Date(toDay(iso) * 86400000 + n * 86400000).toISOString().slice(0, 10);

/** 合成联赛阶段：18 场一轮、共 8 轮；前 playedRounds 轮算已赛，其余进赛程。 */
function syntheticSwiss(cfg, { playedRounds = 3 } = {}) {
  const T = cfg.teams;
  const pairs = [];
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) pairs.push([T[i], T[j]]);
  pairs.length = T.length * 8 / 2;
  const played = [], scheduled = [];
  pairs.forEach(([h, a], k) => {
    const round = Math.floor(k / (T.length / 2));
    const date = addDays('2026-09-08', round * 14 + (k % 7 === 0 ? 0 : 1));
    const hg = (k * 7) % 4, ag = (k * 5) % 3;
    const row = mk(date, h, a, hg, ag);
    if (round < playedRounds) played.push(row);
    else scheduled.push({ ...row, hg: null, ag: null, status: 'TIMED', matchday: round + 1 });
  });
  return { played, scheduled };
}

/** 合成解放者杯小组赛：每组双循环 12 场，前 playedInGroup 场算已赛。 */
function syntheticGroups(cfg, { playedInGroup = 4 } = {}) {
  const played = [], scheduled = [];
  for (const g of Object.keys(cfg.groups)) {
    const T = cfg.groups[g];
    let k = 0;
    for (const h of T) for (const a of T) {
      if (h === a) continue;
      const date = addDays('2026-04-07', k * 3);
      const row = mk(date, h, a, 1 + (k % 3), k % 2, { code: 'CLI', season: '2626', stage: 'GROUP_STAGE' });
      if (k < playedInGroup) played.push(row);
      else scheduled.push({ ...row, hg: null, ag: null, status: 'SCHEDULED', group: `GROUP_${g}` });
      k++;
    }
  }
  return { played, scheduled };
}

test('欧战配置：欧冠 36 队、区间连续、官方附加赛/16 强签位、同分规则前 4 条', () => {
  assert.equal(UCL.kind, 'swiss');
  assert.equal(UCL.code, 'CL');
  assert.equal(UCL.teams.length, 36);
  assert.equal(new Set(UCL.teams).size, 36, '队名不能重复');

  // 区间：1–8 直接进 16 强、9–24 附加赛、25–36 出局，且cover 1..36 不重叠
  assert.deepEqual(UCL.bands.map(b => [b.key, b.from, b.to]), [['r16', 1, 8], ['playoff', 9, 24], ['out', 25, 36]]);
  const seen = new Set();
  for (const b of UCL.bands) for (let p = b.from; p <= b.to; p++) { assert.ok(!seen.has(p), `名次 ${p} 重复`); seen.add(p); }
  assert.equal(seen.size, 36);

  // 同分规则前 4 条（UEFA 官方：净胜球 → 进球 → 客场进球 → 胜场）
  assert.deepEqual(UCL.tiebreak.slice(0, 4), ['pts', 'gd', 'gf', 'away_gf']);
  assert.deepEqual(UCL.tiebreak.slice(0, 6), ['pts', 'gd', 'gf', 'away_gf', 'wins', 'away_wins']);

  // 附加赛配对：9/10 vs 23/24、11/12 vs 21/22、13/14 vs 19/20、15/16 vs 17/18
  assert.deepEqual(UCL.playoffGroups.map(g => [g.seeded, g.unseeded]), [
    [[9, 10], [23, 24]], [[11, 12], [21, 22]], [[13, 14], [19, 20]], [[15, 16], [17, 18]],
  ]);
  const playoffSeeds = UCL.playoffGroups.flatMap(g => g.seeded.concat(g.unseeded)).sort((a, b) => a - b);
  assert.deepEqual(playoffSeeds, Array.from({ length: 16 }, (_, i) => i + 9), '9–24 名全部进附加赛');

  // 16 强：1/2 名对附加赛 IV（15/16 vs 17/18）、3/4 对 III、5/6 对 II、7/8 对 I
  assert.deepEqual(UCL.r16Groups.map(g => [g.seeds, g.playoffGroup]), [
    [[1, 2], 3], [[3, 4], 2], [[5, 6], 1], [[7, 8], 0],
  ]);
  // 8 强 / 4 强签位：8 个 16 强胜者全部用上，4 强用上 4 个 8 强胜者
  assert.equal(UCL.qfBracket.length, 4);
  assert.deepEqual(UCL.qfBracket.flat().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(UCL.sfBracket.flat().sort((a, b) => a - b), [0, 1, 2, 3]);

  // 中文名：36 队全覆盖；modelNames 只能指向已配置的球队
  assert.equal(Object.keys(UCL.names).length, 36);
  for (const t of UCL.teams) assert.ok(UCL.names[t], `缺中文名：${t}`);
  for (const k of Object.keys(UCL.modelNames)) assert.ok(UCL.teams.includes(k), `modelNames 里有未知球队 ${k}`);
  assert.ok(UCL.sources.length >= 3 && UCL.notes.length > 50);
});

test('欧战配置：解放者杯 8 组 × 4 队、4 轮淘汰、stageOf 一致', () => {
  assert.equal(CLI.kind, 'groups2leg');
  assert.equal(CLI.code, 'CLI');
  const groups = Object.keys(CLI.groups);
  assert.equal(groups.length, 8);
  assert.deepEqual(groups, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const teams = groups.flatMap(g => CLI.groups[g]);
  assert.equal(teams.length, 32);
  assert.equal(new Set(teams).size, 32);
  assert.deepEqual(CLI.rounds.map(r => r.key), ['R16', 'QF', 'SF', 'F']);
  for (const r of CLI.rounds) assert.equal(CLI.stageOf[r.key], r.stage, `${r.key} 的 stageOf 不一致`);
  assert.equal(CLI.tiebreak[0], 'pts');
  assert.deepEqual(CLI.tiebreak.slice(0, 2), ['pts', 'gd']);
  for (const t of teams) assert.ok(CLI.names[t], `缺中文名：${t}`);
  assert.ok(CLI.sources.length >= 2);
});

test('eurodata.parseEuro：点球不算比分、阶段/回合、中立场、未开赛单独导出', () => {
  const raw = {
    matches: [
      // 已赛（常规 2-1）
      { utcDate: '2026-09-08T16:45:00Z', status: 'FINISHED', stage: 'LEAGUE_STAGE', matchday: 1,
        homeTeam: { name: 'Alpha' }, awayTeam: { name: 'Beta' }, score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 } } },
      // 已赛（点球：常规 1-1，点球 4-5，fullTime 把点球算进去了）
      { utcDate: '2026-08-18T22:00:00Z', status: 'FINISHED', stage: 'PLAY_OFFS',
        homeTeam: { name: 'Gamma' }, awayTeam: { name: 'Delta' },
        score: { duration: 'PENALTY_SHOOTOUT', regularTime: { home: 1, away: 1 }, penalties: { home: 4, away: 5 }, fullTime: { home: 5, away: 6 } } },
      { utcDate: '2026-08-25T22:00:00Z', status: 'FINISHED', stage: 'PLAY_OFFS',
        homeTeam: { name: 'Delta' }, awayTeam: { name: 'Gamma' },
        score: { duration: 'REGULAR', fullTime: { home: 0, away: 2 } } },
      // 决赛：中立场
      { utcDate: '2026-11-28T00:00:00Z', status: 'FINISHED', stage: 'FINAL',
        homeTeam: { name: 'Alpha' }, awayTeam: { name: 'Delta' }, score: { duration: 'REGULAR', fullTime: { home: 1, away: 0 } } },
      // 未开赛（两队待定 → 不进 upcoming）、已取消、未开赛（两队已知）
      { utcDate: '2027-01-27T20:00:00Z', status: 'SCHEDULED', stage: 'FINAL', homeTeam: { name: null }, awayTeam: { name: null }, score: { fullTime: { home: null, away: null } } },
      { utcDate: '2026-05-08T00:30:00Z', status: 'CANCELLED', stage: 'GROUP_STAGE', homeTeam: { name: 'X' }, awayTeam: { name: 'Y' }, score: { fullTime: { home: null, away: null } } },
      { utcDate: '2026-11-03T17:45:00Z', status: 'TIMED', stage: 'LEAGUE_STAGE', matchday: 4,
        homeTeam: { name: 'Beta' }, awayTeam: { name: 'Alpha' }, score: { fullTime: { home: null, away: null } } },
    ],
  };
  const ms = eurodata.parseEuro(raw, 'CL', '2627');
  assert.equal(ms.length, 4, '只收已赛且有两队名字的比赛');
  assert.deepEqual(ms.map(m => [m.home, m.away, m.hg, m.ag]), [
    ['Gamma', 'Delta', 1, 1], ['Delta', 'Gamma', 0, 2], ['Alpha', 'Beta', 2, 1], ['Alpha', 'Delta', 1, 0],
  ]);
  assert.ok(ms.every(m => m.division === 'CL' && m.tournament === 'CL' && m.season === '2627' && m.market === null));
  assert.equal(ms[0].pens[0], 4, '点球单独记');
  assert.equal(ms[0].stage, 'PLAY_OFFS');
  assert.deepEqual([ms[0].leg, ms[1].leg], [1, 2], '同一对球队按日期分来回合');
  assert.equal(ms[2].leg, null, '联赛阶段没有回合');
  assert.equal(ms[3].neutral, true, '决赛是中立场');
  assert.equal(ms[2].neutral, false);
  assert.equal(ms[1].hg, 0, '点球不计入比分（Delta 第二回合 0-2 是常规时间）');

  const up = eurodata.upcomingEuro(raw);
  assert.equal(up.length, 1, '两队待定的场次不导出（没有对阵）');
  assert.deepEqual([up[0].home, up[0].away, up[0].matchday, up[0].date], ['Beta', 'Alpha', 4, '2026-11-03']);
});

test('eurodata.applyAliases：只换命中映射的队名', () => {
  const ms = [mk('2026-09-08', 'A FC', 'B FC', 1, 0)];
  const out = eurodata.applyAliases(ms, { 'A FC': 'A' });
  assert.deepEqual([out[0].home, out[0].away], ['A', 'B FC']);
  assert.equal(eurodata.applyAliases(ms, {})[0], ms[0], '没有映射时原样返回');
  assert.equal(ms[0].home, 'A FC', '不修改原数组');
});

test('eurodata.apiKey：缺文件/缺字段时报清楚的错（不打印内容）', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wc-euro-'));
  try {
    const file = path.join(dir, 'api-keys.json');
    assert.throws(() => eurodata.apiKey(file), /api-keys\.json/);
    fs.writeFileSync(file, JSON.stringify({ other: 'x' }));
    assert.throws(() => eurodata.apiKey(file), /football-data/);
    fs.writeFileSync(file, '{oops');
    assert.throws(() => eurodata.apiKey(file), /不是合法 JSON/);
    fs.writeFileSync(file, JSON.stringify({ 'football-data': 'k' }));
    assert.equal(eurodata.apiKey(file), 'k');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('swissRemaining：只留 asOf 之后、且没有真实比分的赛程', () => {
  const sched = [
    { date: '2026-10-20', day: toDay('2026-10-20'), home: 'A', away: 'B' },
    { date: '2026-10-22', day: toDay('2026-10-22'), home: 'C', away: 'D' },
    { date: '2026-11-03', day: toDay('2026-11-03'), home: 'A', away: 'C' },
  ];
  const played = [{ home: 'C', away: 'D' }];
  const out = euro.swissRemaining(sched, toDay('2026-10-22'), played);
  assert.deepEqual(out.map(m => m.home + '-' + m.away), ['A-C']);
});

test('rankSwiss：同分时按 UEFA 的 净胜球 → 进球 → 客场进球 顺序，第 4 条客场进球确实起作用', () => {
  // A 与 B 全部相同：3 分、净胜 0、进球 2；只有客场进球不同（B 1 个、A 0 个）
  const results = [
    { home: 'A', away: 'C', hg: 2, ag: 1 },  // A 主场 2-1
    { home: 'C', away: 'B', hg: 0, ag: 1 },  // B 客场 1-0（客场进球 1）
    { home: 'D', away: 'A', hg: 1, ag: 0 },  // A 客场 0-1 输
    { home: 'B', away: 'D', hg: 1, ag: 2 },  // B 主场 1-2 输
  ];
  const rows = euro.rankSwiss(['A', 'B', 'C', 'D'], results, UCL.tiebreak, mulberry32(1));
  const by = Object.fromEntries(rows.map(r => [r.team, r]));
  assert.equal(by.A.pts, by.B.pts);
  assert.equal(by.A.gd, by.B.gd);
  assert.equal(by.A.gf, by.B.gf);
  assert.deepEqual([by.A.away_gf, by.B.away_gf], [0, 1]);
  assert.deepEqual(rows.map(r => r.team), ['D', 'B', 'A', 'C']);
  for (const r of rows) for (const k of ['team', 'p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts', 'away_gf', 'away_wins']) assert.ok(k in r, `行字段 ${k}`);

  // 去掉客场进球这一条（英超式），A/B 只能靠抽签分开：种子不同两个顺序都会出现
  const orders = new Set();
  for (let s = 1; s <= 40; s++) orders.add(euro.rankSwiss(['A', 'B', 'C', 'D'], results, ['pts', 'gd', 'gf'], mulberry32(s)).slice(1, 3).map(r => r.team).join(''));
  assert.deepEqual([...orders].sort(), ['AB', 'BA'], '英超式规则下 A/B 完全并列');
});

test('twoLeg：主客各一场、按总比分晋级；总比分平按点球五五开（近似）', () => {
  // 桩：每场都抽到 1-0 给主队
  const prep = {
    model: { rho: 0 },
    get: () => ({ cells: [[1, 1, 0]], lambdaHome: 1, lambdaAway: 1, pH: 1, pD: 0, pA: 0 }),
  };
  const r = euro.twoLeg(prep, 'A', 'B', mulberry32(7));
  assert.deepEqual(r.legs.map(l => [l.home, l.away, l.hg, l.ag]), [['B', 'A', 1, 0], ['A', 'B', 1, 0]]);
  assert.equal(r.aggA, 1); assert.equal(r.aggB, 1);
  assert.equal(r.decidedBy, 'pens');
  let a = 0;
  const rnd = mulberry32(11);
  for (let i = 0; i < 2000; i++) if (euro.twoLeg(prep, 'A', 'B', rnd).winner === 'A') a++;
  assert.ok(a > 900 && a < 1100, `点球五五开（收到 ${a}/2000）`);

  // firstHome 控制首回合主场；真实点球决定胜者
  const r2 = euro.twoLeg(prep, 'A', 'B', mulberry32(3), { firstHome: 'A', pens: [5, 3] });
  assert.deepEqual(r2.legs.map(l => l.home), ['A', 'B']);
  assert.equal(r2.winner, 'A');
  const r3 = euro.twoLeg(prep, 'A', 'B', mulberry32(3), { pens: [1, 4] });
  assert.equal(r3.winner, 'B');
});

test('drawRoundOf16：小组第一抽小组第二，同组回避', () => {
  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const winners = groups.map(g => ({ team: `W${g}`, group: g }));
  const runners = groups.map(g => ({ team: `R${g}`, group: g }));
  for (let s = 0; s < 60; s++) {
    const pairs = euro.drawRoundOf16(winners, runners, mulberry32(s + 1));
    assert.equal(pairs.length, 8);
    const used = new Set();
    for (const [w, r] of pairs) {
      assert.ok(w.startsWith('W') && r.startsWith('R'));
      assert.notEqual(w.slice(1), r.slice(1), '同组不能相遇');
      assert.ok(!used.has(w) && !used.has(r));
      used.add(w); used.add(r);
    }
    assert.equal(used.size, 16);
  }
});

test('simulateSwiss：区间/晋级概率守恒、已赛用真实比分、剩余场次数正确', () => {
  const { played, scheduled } = syntheticSwiss(UCL, { playedRounds: 3 });
  const out = euro.simulateSwiss(played, scheduled, UCL, { sims: 400, seed: 5, modelOpts: opts, sigma: 0 });
  assert.equal(out.kind, 'swiss');
  assert.equal(out.marketAvailable, false);
  assert.equal(out.teams.length, 36);
  assert.equal(out.played, played.length);
  assert.equal(out.remaining, scheduled.length);
  assert.equal(out.bandsDef.length, 3);
  assert.equal(out.upcoming.length, scheduled.length);

  const sum = (f) => out.teams.reduce((s, t) => s + f(t), 0);
  for (const t of out.teams) close(t.positions.reduce((s, x) => s + x, 0), 1, 1e-9);
  close(sum(t => t.bands.r16), 8, 1e-9);
  close(sum(t => t.bands.playoff), 16, 1e-9);
  close(sum(t => t.bands.out), 12, 1e-9);
  close(sum(t => t.knockout.r16), 16, 1e-9);
  close(sum(t => t.knockout.qf), 8, 1e-9);
  close(sum(t => t.knockout.sf), 4, 1e-9);
  close(sum(t => t.knockout.final), 2, 1e-9);
  close(sum(t => t.knockout.title), 1, 1e-9);
  for (const t of out.teams) assert.ok(t.expectedPts >= t.current.pts - 1e-9, `${t.team} 期望积分不应低于当前`);
  // 名次概率合计 = 1 之外，每条名次列也应是 1 队
  for (let i = 0; i < 36; i++) close(sum(t => t.positions[i]), 1, 1e-9);
});

test('simulateSwiss：联赛阶段全部踢完时，期望积分就是当前积分（不重抽已赛）', () => {
  const { played } = syntheticSwiss(UCL, { playedRounds: 8 });
  const out = euro.simulateSwiss(played, [], UCL, { sims: 50, seed: 9, modelOpts: opts });
  assert.equal(out.remaining, 0);
  for (const t of out.teams) close(t.expectedPts, t.current.pts, 0.011);
  for (const t of out.teams) close(t.positions.reduce((s, x) => s + x, 0), 1, 1e-9);
  close(out.teams.reduce((s, t) => s + t.knockout.title, 0), 1, 1e-9);
});

test('simulateGroups2leg：非线性赛制——出线/各轮/夺冠概率守恒', () => {
  const { played, scheduled } = syntheticGroups(CLI, { playedInGroup: 4 });
  const out = euro.simulateGroups2leg(played, scheduled, CLI, { sims: 300, seed: 4, modelOpts: opts, sigma: 0.05 });
  assert.equal(out.kind, 'groups2leg');
  assert.equal(out.marketAvailable, false);
  assert.equal(out.teams.length, 32);
  assert.deepEqual(Object.keys(out.groups), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const sum = f => out.teams.reduce((s, t) => s + f(t), 0);
  // 每组 2 队出线、16 强 16 队、8 强 8、4 强 4、决赛 2、夺冠 1
  for (const g of Object.keys(out.groups)) close(out.teams.filter(t => t.group === g).reduce((s, t) => s + t.advance, 0), 2, 1e-9);
  close(sum(t => t.reach.R16), 16, 1e-9);
  close(sum(t => t.reach.QF), 8, 1e-9);
  close(sum(t => t.reach.SF), 4, 1e-9);
  close(sum(t => t.reach.F), 2, 1e-9);
  close(sum(t => t.champion), 1, 1e-9);
  for (const t of out.teams) { close(t.positions.reduce((s, x) => s + x, 0), 1, 1e-9); assert.equal(t.positions.length, 4); }
});

test('simulateGroups2leg：API 已给出的对阵与真实比分优先（决赛未踢时只剩两队可能夺冠）', () => {
  const groups = CLI.groups;
  const keys = Object.keys(groups);
  const played = [];
  // 小组赛：全踢完，主队 1-0（每组名次由积分与净胜球决定）
  for (const g of keys) {
    const T = groups[g];
    let k = 0;
    for (const h of T) for (const a of T) if (h !== a) {
      played.push(mk(addDays('2026-04-07', k), h, a, 1, 0, { code: 'CLI', season: '2626', stage: 'GROUP_STAGE', group: `GROUP_${g}` }));
      k++;
    }
  }
  const order = Object.fromEntries(keys.map(g => [g, groups[g]]));
  // 用真实积分表（含主场全胜）算小组前 2 —— 直接复用 rankSwiss
  const { rankSwiss } = euro;
  const rnd = mulberry32(1);
  const winners = [], runners = [];
  for (const g of keys) {
    const rows = rankSwiss(order[g], played.filter(m => order[g].includes(m.home)), CLI.tiebreak, rnd);
    winners.push({ team: rows[0].team, group: g });
    runners.push({ team: rows[1].team, group: g });
  }
  // 16 强 + 8 强 + 4 强：都是「先写的那支球队 1-0 赢」；决赛不踢
  const ko = [];
  const stages = ['PLAY_OFFS', 'QUARTER_FINALS', 'SEMI_FINALS'];
  let alive = winners.map((w, i) => [w.team, runners[i].team]);
  const chain = [];
  for (const stage of stages) {
    const next = [];
    chain.push([]);
    for (const [a, b] of alive) {
      const d1 = addDays('2026-08-11', chain.length * 10), d2 = addDays('2026-08-18', chain.length * 10);
      ko.push(mk(d1, a, b, 1, 0, { code: 'CLI', season: '2626', stage }));
      ko.push(mk(d2, b, a, 0, 1, { code: 'CLI', season: '2626', stage }));
      chain[chain.length - 1].push(a);
      next.push(a);
    }
    alive = [];
    for (let i = 0; i < next.length; i += 2) alive.push([next[i], next[i + 1]]);
  }
  const out = euro.simulateGroups2leg(played.concat(ko), [], CLI, { sims: 30, seed: 2, modelOpts: opts });
  const finalists = chain[chain.length - 1];
  assert.equal(finalists.length, 2);
  const champs = out.teams.filter(t => t.champion > 0);
  assert.deepEqual(champs.map(t => t.team).sort(), [...finalists].sort(), '真实半决赛结果之后只剩两队可能夺冠');
  close(champs.reduce((s, t) => s + t.champion, 0), 1, 1e-9);
  assert.equal(out.remaining, 1, '只剩决赛');
  assert.equal(out.upcoming.length, 1);
  assert.equal(out.upcoming[0].stage, 'FINAL');
  assert.equal(out.upcoming[0].neutral, true);
});

test('欧战配置单独放 events/euro/：字段完整，且不混进国家队赛事的 events/*.json', () => {
  assert.deepEqual(fs.readdirSync(EVENTS).filter(f => f.endsWith('.json')), ['asian-cup-2027.json'],
    'events/*.json 只放国家队赛事（engine.test.js 按「小组+淘汰」赛制逐个校验）');
  const ids = fs.readdirSync(EURO_EVENTS).filter(f => f.endsWith('.json'));
  assert.deepEqual(ids.sort(), ['copa-libertadores-2026.json', 'ucl-2026-27.json']);
  for (const id of ids) {
    const c = JSON.parse(fs.readFileSync(path.join(EURO_EVENTS, id), 'utf8'));
    assert.equal(c.id, id.slice(0, -5), `${id}: id 与文件名不一致`);
    assert.ok(c.kind === 'swiss' || c.kind === 'groups2leg', `${id}: kind`);
    for (const k of ['code', 'apiSeason', 'season', 'name', 'nameZh', 'start', 'end', 'tiebreak', 'names', 'sources', 'notes']) assert.ok(k in c, `${id}: 缺 ${k}`);
    assert.ok(c.start < c.end, `${id}: 日期区间`);
    assert.ok(Number.isInteger(c.apiSeason), `${id}: apiSeason 是 football-data.org 的赛季起点年`);
  }
});
