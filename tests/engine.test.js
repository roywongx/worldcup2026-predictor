'use strict';
// node --test tests/   （不依赖网络与历史数据文件，全部用合成数据）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dc = require('../engine/dc');
const elo = require('../engine/elo');
const { rps, score } = require('../engine/metrics');
const { parseCSV, editions, toDay } = require('../engine/data');
const sim = require('../engine/simulate');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('泊松分布与比分矩阵归一化', () => {
  const p = dc.poissonPMF(1.4, 30);
  close(p.reduce((s, x) => s + x, 0), 1, 1e-12);
  const P = dc.scoreMatrix(1.6, 0.9, -0.1);
  close(P.flat().reduce((s, x) => s + x, 0), 1, 1e-12);
  const o = dc.outcome(P);
  close(o.pH + o.pD + o.pA, 1, 1e-12);
  assert.ok(o.pH > o.pA, '期望进球多的一方胜率更高');
});

test('Dixon-Coles τ：ρ<0 时 0-0、1-1 概率上调，1-0、0-1 下调', () => {
  assert.ok(dc.tau(0, 0, 1.2, 1.1, -0.1) > 1);
  assert.ok(dc.tau(1, 1, 1.2, 1.1, -0.1) > 1);
  assert.ok(dc.tau(1, 0, 1.2, 1.1, -0.1) < 1);
  assert.equal(dc.tau(2, 3, 1.2, 1.1, -0.1), 1);
});

function synthetic(seed = 7) {
  const rnd = sim.mulberry32(seed);
  const teams = Array.from({ length: 12 }, (_, i) => `T${i}`);
  const att = new Map(teams.map((t, i) => [t, (i - 5.5) * 0.08]));
  const def = new Map(teams.map((t, i) => [t, (5.5 - (i * 7) % 12) * 0.06]));
  const matches = [];
  let day = toDay('2018-01-01');
  for (let round = 0; round < 30; round++) for (let i = 0; i < teams.length; i++) for (let j = 0; j < teams.length; j++) {
    if (i === j || rnd() > 0.35) continue;
    const h = teams[i], a = teams[j];
    const lh = Math.exp(0.2 + 0.25 + att.get(h) - def.get(a)), la = Math.exp(0.2 + att.get(a) - def.get(h));
    matches.push({ date: '', day: day++, home: h, away: a, hg: sim.poissonSample(lh, rnd), ag: sim.poissonSample(la, rnd), tournament: 'League', neutral: false });
  }
  return { teams, att, def, matches };
}

test('拟合能还原合成数据的攻防参数与主场优势', () => {
  const { teams, att, def, matches } = synthetic();
  const m = dc.fit(matches, matches[matches.length - 1].day + 1, { halfLifeDays: 1e9, windowDays: 1e9, prior: 0.5, iterations: 80 });
  const corr = (xs, ys) => {
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return n / Math.sqrt(dx * dy);
  };
  assert.ok(corr(teams.map(t => att.get(t)), teams.map(t => m.att.get(t))) > 0.9, 'att 相关 > 0.9');
  assert.ok(corr(teams.map(t => def.get(t)), teams.map(t => m.def.get(t))) > 0.9, 'def 相关 > 0.9');
  close(m.h, 0.25, 0.08);
});

test('拟合只用 day 之前的比赛（不偷看）', () => {
  const { matches } = synthetic();
  const cut = matches[Math.floor(matches.length / 2)].day;
  const a = dc.fit(matches, cut, {});
  const b = dc.fit(matches.filter(m => m.day < cut), cut, {});
  close(a.mu, b.mu, 1e-12);
  close(a.att.get('T3'), b.att.get('T3'), 1e-12);
});

test('Elo：零和更新、主场优势、净胜球放大', () => {
  const ms = [{ day: 1, home: 'A', away: 'B', hg: 3, ag: 0, tournament: 'Friendly', neutral: true }];
  const r = elo.runElo(ms);
  close(r.get('A') + r.get('B'), 3000, 1e-9);
  close(r.get('A') - 1500, 20 * 1.75 * 0.5, 1e-9);
  assert.equal(elo.kFactor('FIFA World Cup'), 60);
  assert.equal(elo.kFactor('Copa América'), 50);
  assert.equal(elo.goalMultiplier(2), 1.5);
});

test('RPS：完美预测为 0，均匀预测为已知值', () => {
  close(rps([1, 0, 0], 0), 0);
  close(rps([1 / 3, 1 / 3, 1 / 3], 0), ((1 / 3 - 1) ** 2 + (2 / 3 - 1) ** 2) / 2);
  const s = score([{ p: [0.6, 0.3, 0.1], o: 0 }, { p: [0.2, 0.3, 0.5], o: 2 }]);
  assert.equal(s.accuracy, 1);
});

test('CSV 解析含引号与逗号；赛事按时间断档切届', () => {
  const rows = parseCSV('a,b\n"x, y",2\n"say ""hi""",3\n');
  assert.equal(rows[0].a, 'x, y');
  assert.equal(rows[1].a, 'say "hi"');
  const ms = ['2019-06-01', '2019-06-20', '2021-06-11', '2021-07-11'].map(d => ({ date: d, day: toDay(d), home: 'A', away: 'B', tournament: 'UEFA Euro' }));
  const eds = editions(ms, 'UEFA Euro');
  assert.equal(eds.length, 2);
  assert.equal(eds[1].year, 2021);
});

test('小组排名：同分先看相互战绩，再看总净胜球', () => {
  const rnd = sim.mulberry32(1);
  // A、B 同 6 分；B 赢了 A（相互战绩），但 A 总净胜球更多 → B 在前
  const res = [['A', 'B', 0, 1], ['A', 'C', 5, 0], ['A', 'D', 5, 0], ['B', 'C', 0, 1], ['B', 'D', 1, 0], ['C', 'D', 0, 0]];
  const order = sim.rankGroup(['A', 'B', 'C', 'D'], res, rnd).map(r => r.team);
  assert.deepEqual(order.slice(0, 2), ['B', 'A']);
});

const EVENTS = path.join(__dirname, '..', 'engine', 'events');
for (const f of fs.readdirSync(EVENTS).filter(x => x.endsWith('.json'))) {
  const ev = JSON.parse(fs.readFileSync(path.join(EVENTS, f), 'utf8'));
  test(`赛事配置 ${ev.id}：球队唯一、对阵槽位可解析、第三名组合表满足约束`, () => {
    const teams = Object.values(ev.groups).flat();
    assert.equal(new Set(teams).size, teams.length, '球队不重复');
    const groups = Object.keys(ev.groups);
    const slots = new Set();
    for (const g of groups) for (let i = 1; i <= ev.advance.perGroup; i++) slots.add(`${i}${g}`);
    const thirdSlots = ev.thirdTable ? ev.thirdTable.slots : Object.keys(ev.thirdAllowed || {});
    for (const s of thirdSlots) slots.add(`3@${s}`);
    const used = ev.knockout.firstRound.flat();
    assert.equal(new Set(used).size, used.length, '首轮槽位不重复');
    for (const s of used) assert.ok(slots.has(s), `未知槽位 ${s}`);
    assert.equal(2 ** ev.knockout.rounds.length, used.length, '轮次与首轮人数一致');
    if (ev.thirdTable) {
      const combos = Object.entries(ev.thirdTable.combos);
      const k = ev.advance.bestThirds;
      const expected = (n, r) => (r === 0 ? 1 : (n * expected(n - 1, r - 1)) / r);
      assert.equal(combos.length, expected(groups.length, k), '组合数完整');
      for (const [combo, assign] of combos) {
        assert.equal([...assign].sort().join(''), combo, `${combo} 分配应恰好用到这几组`);
        ev.thirdTable.slots.forEach((slot, i) => {
          if (ev.thirdAllowed) assert.ok(ev.thirdAllowed[slot].includes(assign[i]), `${combo}: ${slot} 不能对 3${assign[i]}`);
          assert.notEqual(slot.slice(1), assign[i], `${combo}: 同组不能首轮相遇`);
        });
      }
    }
  });
}

test('模拟：夺冠概率和为 1、逐轮递减；已赛结果被采用', () => {
  const ev = JSON.parse(fs.readFileSync(path.join(EVENTS, 'asian-cup-2027.json'), 'utf8'));
  const { matches } = synthetic();
  const teams = Object.values(ev.groups).flat();
  // 用合成联赛的球队顶替赛事球队，并给 A 组塞入「已赛」结果：Palestine 全胜
  const rename = new Map(teams.map((t, i) => [`T${i % 12}`, t]));
  const ms = matches.map(m => ({ ...m, home: rename.get(m.home), away: rename.get(m.away) }));
  const s = toDay(ev.start);
  const A = ev.groups.A;
  const played = [[A[3], A[0], 2, 0], [A[3], A[1], 1, 0], [A[3], A[2], 3, 1]].map(([h, a, hg, ag], i) =>
    ({ date: ev.start, day: s + i, home: h, away: a, hg, ag, tournament: ev.tournament, neutral: true, shootoutWinner: null }));
  const out = sim.simulate([...ms, ...played], ev, { sims: 3000, asOf: ev.start, modelOpts: { prior: 2 } });
  close(out.teams.reduce((x, t) => x + t.champion, 0), 1, 1e-9);
  for (const t of out.teams) {
    const r = ev.knockout.rounds.map(k => t.reach[k]);
    for (let i = 1; i < r.length; i++) assert.ok(r[i] <= r[i - 1] + 1e-12, `${t.team} 晋级概率应逐轮递减`);
    assert.ok(t.champion <= r[r.length - 1] + 1e-12);
    close(t.position.reduce((x, y) => x + y, 0), 1, 1e-9);
  }
  const pal = out.teams.find(t => t.team === A[3]);
  assert.equal(pal.position[0], 1, '三战全胜必定小组第一');
  assert.equal(out.playedMatches, 3);
});

test('亚洲杯 2027 第三名组合表与官方一致（抽查首/中/尾行，防误改）', () => {
  const ev = JSON.parse(fs.readFileSync(path.join(EVENTS, 'asian-cup-2027.json'), 'utf8'));
  // 来源：AFC 赛程（zh.wikipedia 2027 年亚足联亚洲杯「淘汰赛」表），2026-10-24 逐行核对 15 行一致
  const pinned = { ABCD: 'CDAB', ABEF: 'EABF', ACEF: 'CAFE', BCEF: 'ECBF', CDEF: 'CDFE' };
  for (const [k, v] of Object.entries(pinned)) assert.equal(ev.thirdTable.combos[k], v, k);
});
