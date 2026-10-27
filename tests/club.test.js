'use strict';
// 俱乐部联赛的验收契约（设计方编写；实现方不得修改本文件，只能让它通过）。
// node --test tests/club.test.js —— 全部用合成数据，不联网、不依赖 data/clubs/。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { implied, parseDate, seasonCode } = require('../engine/clubdata');
const league = require('../engine/league');
const clubbt = require('../engine/clubbacktest');
const { mulberry32, poissonSample } = require('../engine/simulate');
const { toDay } = require('../engine/data');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('clubdata：日期两种写法、去抽水概率、赛季代码', () => {
  assert.equal(parseDate('24/05/2026'), '2026-05-24');
  assert.equal(parseDate('05/08/06'), '2006-08-05');
  const p = implied(2.0, 3.5, 4.0);
  close(p[0] + p[1] + p[2], 1, 1e-12);
  assert.ok(p[0] > p[2]);
  assert.equal(implied(0, 3, 3), null);
  assert.equal(seasonCode(2026), '2627');
  assert.equal(seasonCode(1999), '9900');
});

test('remainingFixtures：双循环里还没踢的有序主客对', () => {
  const teams = ['A', 'B', 'C', 'D'];
  const played = [{ home: 'A', away: 'B' }, { home: 'B', away: 'A' }, { home: 'C', away: 'D' }];
  const rem = league.remainingFixtures(teams, played);
  assert.equal(rem.length, 12 - 3);
  const keys = new Set(rem.map(([h, a]) => `${h}|${a}`));
  assert.ok(!keys.has('A|B') && !keys.has('B|A') && !keys.has('C|D'));
  assert.ok(keys.has('D|C') && keys.has('A|C'));
});

// 两队同分：A 净胜球更多，但相互战绩 B 占优
const RES = [
  ['A', 'B', 0, 1], ['B', 'A', 0, 0],
  ['A', 'C', 5, 0], ['C', 'A', 0, 0], ['A', 'D', 3, 0], ['D', 'A', 0, 1],
  ['B', 'C', 1, 0], ['C', 'B', 1, 0], ['B', 'D', 1, 0], ['D', 'B', 0, 0],
  ['C', 'D', 0, 0], ['D', 'C', 0, 0],
].map(([home, away, hg, ag]) => ({ home, away, hg, ag }));

test('rankTable：英超式（净胜球优先）与西甲式（相互战绩优先）给出不同结果', () => {
  const rnd = mulberry32(1);
  const a = league.rankTable(['A', 'B', 'C', 'D'], RES, ['pts', 'gd', 'gf', 'h2h_pts'], rnd);
  const b = league.rankTable(['A', 'B', 'C', 'D'], RES, ['pts', 'h2h_pts', 'h2h_gd', 'gd', 'gf'], rnd);
  const pts = Object.fromEntries(a.map(r => [r.team, r.pts]));
  assert.equal(pts.A, pts.B, '构造的 A、B 同分');
  assert.deepEqual(a.slice(0, 2).map(r => r.team), ['A', 'B']);
  assert.deepEqual(b.slice(0, 2).map(r => r.team), ['B', 'A']);
  for (const r of a) for (const k of ['team', 'p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts']) assert.ok(k in r, `行字段 ${k}`);
});

function syntheticSeason({ teams = 8, seasons = 4, playedRounds = null, seed = 3 } = {}) {
  const rnd = mulberry32(seed);
  const T = Array.from({ length: teams }, (_, i) => `Club${i}`);
  const str = new Map(T.map((t, i) => [t, (teams / 2 - i) * 0.12]));
  const matches = [];
  let day = toDay('2018-08-01');
  for (let s = 0; s < seasons; s++) {
    const season = String(18 + s).padStart(2, '0') + String(19 + s).padStart(2, '0');
    const pairs = [];
    for (const h of T) for (const a of T) if (h !== a) pairs.push([h, a]);
    pairs.sort(() => rnd() - 0.5);
    const limit = s === seasons - 1 && playedRounds != null ? playedRounds : pairs.length;
    for (const [h, a] of pairs.slice(0, limit)) {
      const lh = Math.exp(0.25 + 0.2 + str.get(h) - str.get(a) * 0.5), la = Math.exp(0.25 + str.get(a) - str.get(h) * 0.5);
      matches.push({ date: '', day: day++, home: h, away: a, hg: poissonSample(lh, rnd), ag: poissonSample(la, rnd),
        tournament: 'X1', division: 'X1', season, neutral: false, market: null });
    }
    day += 60;
  }
  return { T, matches, season: matches[matches.length - 1].season };
}

const LEAGUE = {
  id: 'test-league', division: 'X1', name: 'Test League', nameZh: '测试联赛',
  tiebreak: ['pts', 'gd', 'gf'],
  zones: [{ key: 'title', from: 1, to: 1 }, { key: 'ucl', from: 1, to: 4 }, { key: 'relegation', from: 7, to: 8 }],
  names: {},
};

test('simulateLeague：概率守恒、期望积分不低于当前积分、未赛场次数正确', () => {
  const { T, matches, season } = syntheticSeason({ playedRounds: 20 });
  const out = league.simulateLeague(matches, { ...LEAGUE, season }, { sims: 2000, seed: 9, modelOpts: { prior: 2 } });
  assert.equal(out.kind, 'league');
  assert.equal(out.teams.length, T.length);
  assert.equal(out.played, 20);
  assert.equal(out.remaining, T.length * (T.length - 1) - 20);
  for (const t of out.teams) {
    close(t.positions.reduce((s, x) => s + x, 0), 1, 1e-9);
    assert.ok(t.expectedPts >= t.current.pts - 1e-9);
    close(t.zones.title, t.positions[0], 1e-12);
    assert.ok(t.zones.ucl >= t.zones.title - 1e-12);
  }
  for (let i = 0; i < T.length; i++) close(out.teams.reduce((s, t) => s + t.positions[i], 0), 1, 1e-9);
  close(out.teams.reduce((s, t) => s + t.zones.relegation, 0), 2, 1e-9);
  assert.ok(Array.isArray(out.upcoming));
});

test('simulateLeague：赛季全部踢完时，名次就是真实积分榜', () => {
  const { matches, season } = syntheticSeason({ playedRounds: null, seasons: 3 });
  const out = league.simulateLeague(matches, { ...LEAGUE, season }, { sims: 300, seed: 1 });
  assert.equal(out.remaining, 0);
  const table = league.rankTable(out.teams.map(t => t.team), matches.filter(m => m.season === season), LEAGUE.tiebreak, mulberry32(1));
  for (let i = 0; i < table.length; i++) {
    const t = out.teams.find(x => x.team === table[i].team);
    if (i === 0 || table[i].pts !== table[i - 1].pts || table[i].gd !== table[i - 1].gd || table[i].gf !== table[i - 1].gf) close(t.positions[i], 1, 1e-12);
  }
});

test('clubBacktest：不偷看——后续比赛不影响先前比赛的预测；行包含市场概率', () => {
  const { matches } = syntheticSeason({ seasons: 4 });
  for (const m of matches) m.market = [0.45, 0.27, 0.28];
  const lastSeason = matches[matches.length - 1].season;
  const opts = { halfLifeDays: 365, windowDays: 1500, prior: 2, eloBeta: 0.5 };
  const full = clubbt.clubBacktest(matches, { divisions: ['X1'], fromSeason: lastSeason, toSeason: lastSeason, opts, refitEveryDays: 7 });
  const cut = full[Math.floor(full.length / 2)];
  const truncated = matches.filter(m => m.day <= cut.day);
  const part = clubbt.clubBacktest(truncated, { divisions: ['X1'], fromSeason: lastSeason, toSeason: lastSeason, opts, refitEveryDays: 7 });
  const same = part.find(r => r.date === cut.date && r.home === cut.home && r.day === cut.day) || part[part.length - 1];
  for (let i = 0; i < 3; i++) close(same.p[i], cut.p[i], 1e-12);
  for (const r of full) {
    close(r.p[0] + r.p[1] + r.p[2], 1, 1e-9);
    assert.deepEqual(r.market, [0.45, 0.27, 0.28]);
    assert.ok([0, 1, 2].includes(r.o));
  }
  const s = clubbt.summarize(full);
  for (const k of ['model', 'market', 'elo']) assert.ok(s.overall[k].n > 0 && s.overall[k].rps > 0, k);
  assert.ok(Array.isArray(s.byDivision) && Array.isArray(s.bySeason));
});

const LEAGUES = path.join(__dirname, '..', 'engine', 'leagues');
test('联赛配置：字段完整、区间合法、同分规则只用已知键', () => {
  const files = fs.existsSync(LEAGUES) ? fs.readdirSync(LEAGUES).filter(f => f.endsWith('.json')) : [];
  assert.ok(files.length >= 5, '至少五大联赛');
  const KEYS = new Set(['pts', 'gd', 'gf', 'wins', 'away_gf', 'h2h_pts', 'h2h_gd', 'h2h_gf', 'h2h_away_gf']);
  const divs = new Set();
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(LEAGUES, f), 'utf8'));
    for (const k of ['id', 'division', 'season', 'name', 'nameZh', 'teams', 'tiebreak', 'zones', 'names', 'sources']) assert.ok(k in c, `${f}: 缺 ${k}`);
    assert.equal(c.id, f.slice(0, -5));
    divs.add(c.division);
    assert.equal(c.tiebreak[0], 'pts');
    for (const k of c.tiebreak) assert.ok(KEYS.has(k), `${f}: 未知同分键 ${k}`);
    for (const z of c.zones) assert.ok(z.from >= 1 && z.to <= c.teams && z.from <= z.to, `${f}: 区间 ${z.key}`);
    assert.ok(c.zones.some(z => z.key === 'title') && c.zones.some(z => z.key === 'relegation'), `${f}: 需含 title 与 relegation`);
    assert.ok(Object.keys(c.names).length >= c.teams, `${f}: 中文队名至少覆盖当季参赛队`);
  }
  for (const d of ['E0', 'SP1', 'D1', 'I1', 'F1']) assert.ok(divs.has(d), `缺 ${d}`);
});
