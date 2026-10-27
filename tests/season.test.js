'use strict';
// 赛季模拟「实力不确定性」与赛季级检验的验收契约（设计方编写；实现方不得修改本文件，只能让它通过）。
// node --test tests/season.test.js —— 全部用合成数据，不联网、不依赖 data/clubs/。
const test = require('node:test');
const assert = require('node:assert/strict');
const league = require('../engine/league');
const seasonbt = require('../engine/seasonbacktest');
const dc = require('../engine/dc');
const { mulberry32, poissonSample } = require('../engine/simulate');
const { toDay } = require('../engine/data');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// 单循环轮次（circle method），再主客对调成双循环
function roundRobinRounds(T) {
  const n = T.length, arr = T.slice(), rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds.concat(rounds.map(rd => rd.map(([h, a]) => [a, h])));
}

/** 合成职业赛季：双循环、每周一轮；strength(i) 决定实力；maxRounds 可造不完整赛季。 */
function buildSeason({ n = 18, seasons = 3, strength = () => 0, playedRounds = null, maxRounds = null, seed = 3, startYear = 2018 } = {}) {
  const T = Array.from({ length: n }, (_, i) => `Club${i}`);
  const rnd = mulberry32(seed);
  const matches = [];
  let lastSeason = null;
  for (let s = 0; s < seasons; s++) {
    const y = startYear + s;
    const season = String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
    lastSeason = season;
    const rounds = roundRobinRounds(T);
    const last = s === seasons - 1;
    rounds.forEach((rd, ri) => {
      if (maxRounds != null && ri >= maxRounds) return;
      if (last && playedRounds != null && ri >= playedRounds) return;
      for (const [h, a] of rd) {
        const ih = T.indexOf(h), ia = T.indexOf(a);
        const lh = Math.exp(0.25 + 0.2 + strength(ih) - strength(ia) * 0.5);
        const la = Math.exp(0.25 + strength(ia) - strength(ih) * 0.5);
        matches.push({
          date: '', day: toDay(`${y}-08-10`) + ri * 7, home: h, away: a,
          hg: poissonSample(lh, rnd), ag: poissonSample(la, rnd),
          tournament: 'X1', division: 'X1', season, neutral: false, market: null,
        });
      }
    });
  }
  return { T, matches, season: lastSeason };
}

const LEAGUE = {
  id: 'test-league', division: 'X1', name: 'Test League', nameZh: '测试联赛',
  tiebreak: ['pts', 'gd', 'gf'],
  zones: [{ key: 'title', from: 1, to: 1 }, { key: 'ucl', from: 1, to: 4 }, { key: 'relegation', from: 7, to: 8 }],
  names: {},
};
const OPTS = { halfLifeDays: 365, windowDays: 1500, prior: 2 };

// —— 旧版抽样循环（拆分前的实现），作为 σ=0 的参照 ——
function sampleFrom(cells, rnd) {
  const u = rnd() * cells[cells.length - 1][0];
  let lo = 0, hi = cells.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cells[mid][0] < u) lo = mid + 1; else hi = mid; }
  return [cells[lo][1], cells[lo][2]];
}

function legacySim(prep, { sims, seed }) {
  const { teams, rem, played, fixtures, cfg } = prep;
  const rnd = mulberry32(seed);
  const tally = new Map(teams.map(t => [t, new Float64Array(teams.length)]));
  const ptsSum = new Map(teams.map(t => [t, 0]));
  const base = played.map(m => ({ home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const results = base.concat(rem.map(([home, away]) => ({ home, away, hg: 0, ag: 0 })));
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < rem.length; i++) {
      const [hg, ag] = sampleFrom(fixtures[i].cells, rnd);
      results[base.length + i].hg = hg; results[base.length + i].ag = ag;
    }
    const table = league.rankTable(teams, results, cfg.tiebreak, rnd);
    for (let i = 0; i < table.length; i++) { tally.get(table[i].team)[i]++; ptsSum.set(table[i].team, ptsSum.get(table[i].team) + table[i].pts); }
  }
  return { tally, ptsSum };
}

test('σ=0：prepare + runSeason 与旧版抽样循环逐位相同，simulateLeague 输出不变', () => {
  const { matches, season } = buildSeason({ n: 8, seasons: 3, playedRounds: 8, seed: 11 });
  const cfg = { ...LEAGUE, season };
  const sims = 300, seed = 11;
  const out = league.simulateLeague(matches, cfg, { sims, seed, modelOpts: OPTS });
  const prep = league.prepareLeague(matches, cfg, { modelOpts: OPTS, seed });
  const r = league.runSeason(prep, { sims, seed, sigma: 0 });
  const old = legacySim(prep, { sims, seed });

  assert.equal(out.sigma, 0);
  assert.equal(prep.rem.length, 8 * 7 - 8 * 4, '剩余场次 = 双循环 − 已赛');
  for (const t of prep.teams) {
    for (let i = 0; i < prep.teams.length; i++) {
      assert.equal(r.tally.get(t)[i], old.tally.get(t)[i], `${t} 第 ${i + 1} 名次数`);
      close(r.ptsSum.get(t), old.ptsSum.get(t), 0);
    }
    const row = out.teams.find(x => x.team === t);
    for (let i = 0; i < prep.teams.length; i++) close(row.positions[i], old.tally.get(t)[i] / sims, 1e-12);
    close(row.expectedPts, +(old.ptsSum.get(t) / sims).toFixed(2), 1e-12);
  }
  // 名次与官方表一致（σ=0 时排名表的并列抽签也用同一个 rnd 流）
  assert.deepEqual(out.teams.map(t => t.team), prep.current.map(r2 => r2.team));
});

test('拒绝抽样：抽出的比分分布与 dc.scoreMatrix 一致', () => {
  const l = 1.4, m = 1.1, rho = -0.1, N = 200000;
  const P = dc.scoreMatrix(l, m, rho);
  const rnd = mulberry32(7);
  let p00 = 0, p11 = 0, p10 = 0, p20 = 0, pDraw = 0;
  for (let i = 0; i < N; i++) {
    const [x, y] = league.sampleDC(l, m, rho, rnd);
    if (x === 0 && y === 0) p00++;
    if (x === 1 && y === 1) p11++;
    if (x === 1 && y === 0) p10++;
    if (x === 2 && y === 0) p20++;
    if (x === y) pDraw++;
  }
  let draw = 0;
  for (let x = 0; x < P.length; x++) for (let y = 0; y < P[x].length; y++) if (x === y) draw += P[x][y];
  close(p00 / N, P[0][0], 0.004);
  close(p11 / N, P[1][1], 0.004);
  close(p10 / N, P[1][0], 0.004);
  close(pDraw / N, draw, 0.004);
  // 尾部也抽查一格
  close(p20 / N, P[2][0], 0.004);
});

test('意图：明显领先的强队在 σ=0.25 下夺冠概率严格下降；名次概率仍是双随机矩阵', () => {
  // 造一个确定的赛季：Club0 前 3 轮全胜 1-0，其余比赛全 1-1，剩余 20 轮交给模型
  const n = 8, T = Array.from({ length: n }, (_, i) => `Club${i}`);
  const matches = [];
  roundRobinRounds(T).forEach((rd, ri) => {
    if (ri >= 3) return;
    for (const [h, a] of rd) {
      const [hg, ag] = h === 'Club0' ? [1, 0] : a === 'Club0' ? [0, 1] : [1, 1];
      matches.push({
        date: '', day: toDay('2020-08-10') + ri * 7, home: h, away: a, hg, ag,
        tournament: 'X1', division: 'X1', season: '2021', neutral: false, market: null,
      });
    }
  });
  const cfg = { ...LEAGUE, season: '2021' };
  const sims = 4000, seed = 21;
  const fixed = league.simulateLeague(matches, cfg, { sims, seed, modelOpts: OPTS, sigma: 0 });
  const uncertain = league.simulateLeague(matches, cfg, { sims, seed, modelOpts: OPTS, sigma: 0.25 });
  const leader = fixed.teams[0];
  assert.equal(leader.team, 'Club0', `领头羊应是 Club0，实际 ${leader.team}`);
  assert.ok(leader.zones.title > 0.6, `σ=0 时强队应明显领先，实际 ${leader.zones.title}`);
  const leader25 = uncertain.teams.find(t => t.team === leader.team);
  assert.ok(leader25.zones.title < leader.zones.title, `${leader25.zones.title} 应严格小于 ${leader.zones.title}`);
  assert.ok(uncertain.teams.reduce((s, t) => s + t.zones.title, 0) > 0.98);
  for (const out of [fixed, uncertain]) {
    for (let i = 0; i < out.teams.length; i++) close(out.teams.reduce((s, t) => s + t.positions[i], 0), 1, 1e-9);
    for (const t of out.teams) close(t.positions.reduce((s, x) => s + x, 0), 1, 1e-9);
  }
});

test('不偷看：删掉检查点之后的比赛，prepare / runSeason 结果完全相同', () => {
  const { matches, season } = buildSeason({ n: 10, seasons: 3, playedRounds: 12, seed: 9 });
  const cfg = { ...LEAGUE, season };
  const asOfDay = toDay(`${2018 + 2}-09-15`);
  const full = league.prepareLeague(matches, cfg, { asOf: asOfDay, modelOpts: OPTS, seed: 5 });
  const cut = matches.filter(m => m.day < asOfDay);
  assert.ok(cut.length > 0 && cut.length < matches.length, '截断应真的删掉一些比赛');
  const part = league.prepareLeague(cut, cfg, { asOf: asOfDay, modelOpts: OPTS, seed: 5 });
  assert.equal(part.played.length, full.played.length);
  assert.equal(part.rem.length, full.rem.length);
  const a = league.runSeason(full, { sims: 500, seed: 5 });
  const b = league.runSeason(part, { sims: 500, seed: 5 });
  for (const t of full.teams) {
    assert.deepEqual(Array.from(b.tally.get(t)), Array.from(a.tally.get(t)), t);
    assert.equal(b.ptsSum.get(t), a.ptsSum.get(t), t);
  }
  // σ>0 也一样（δ 与比分抽样都只依赖 prep 与 seed）
  const c = league.runSeason(full, { sims: 500, seed: 5, sigma: 0.3 });
  const d = league.runSeason(part, { sims: 500, seed: 5, sigma: 0.3 });
  for (const t of full.teams) assert.deepEqual(Array.from(d.tally.get(t)), Array.from(c.tally.get(t)), t);
});

test('区间定义：18 / 20 队的 bottom3 分别是 16–18、18–20；不完整赛季被跳过并列入清单', () => {
  assert.deepEqual(seasonbt.zonesFor(18), { title: [1, 1], top4: [1, 4], bottom3: [16, 18] });
  assert.deepEqual(seasonbt.zonesFor(20), { title: [1, 1], top4: [1, 4], bottom3: [18, 20] });
  assert.equal(seasonbt.checkpointDate('1718', '10-25'), '2017-10-25');
  assert.equal(seasonbt.checkpointDate('1718', '01-01'), '2018-01-01');
  assert.equal(seasonbt.checkpointDate('1718', '03-15'), '2018-03-15');

  // 1819：18 队完整赛季；1920：20 队只踢了 30 轮（300/380 场）→ 跳过
  const complete = buildSeason({ n: 18, seasons: 1, seed: 4, startYear: 2018 });
  const partial = buildSeason({ n: 20, seasons: 1, seed: 4, startYear: 2019, maxRounds: 30 });
  const matches = complete.matches.concat(partial.matches).map(m => ({ ...m, division: 'E0' }));
  const r = seasonbt.seasonBacktest(matches, { E0: { tiebreak: ['pts', 'gd', 'gf'] } }, {
    fromSeason: '1819', toSeason: '1920', sigmas: [0, 0.2], sims: 200,
  });
  assert.equal(r.n, 18 * 3, '只评 1819 的 18 队 × 3 个检查点');
  assert.equal(r.bySigma.length, 2);
  for (const x of r.bySigma) {
    assert.equal(x.bottom3.n, 54);
    assert.equal(x.top4.n, 54);
    assert.ok(x.title.brier >= 0 && Number.isFinite(x.title.logLoss));
    assert.equal(x.calibration.title.reduce((s, b) => s + b.n, 0), 54);
    assert.equal(x.byCheckpoint.length, 3);
  }
  const skip = r.skipped.find(s => s.season === '1920');
  assert.ok(skip, '1920 应出现在跳过清单');
  assert.equal(skip.division, 'E0');
  assert.equal(skip.matches, 300);
  assert.equal(skip.expected, 380);
  assert.equal(skip.teams, 20);
  assert.ok(r.notes.some(n => n.includes('扣分')), 'notes 要写明积分处罚未处理');
});
