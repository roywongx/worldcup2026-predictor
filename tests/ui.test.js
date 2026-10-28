'use strict';
// 前端 UI 核心纯函数的验收契约：index.html 里 ==UI-CORE-BEGIN== 到 ==UI-CORE-END== 之间的代码
// 不碰 DOM，可以单独求值。node --test tests/ui.test.js —— 全部用合成数据，不联网、不起浏览器。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function readCore() {
  const begin = '// ==UI-CORE-BEGIN==';
  const end = '// ==UI-CORE-END==';
  const i = HTML.indexOf(begin);
  const j = HTML.indexOf(end);
  assert.ok(i >= 0 && j > i, 'index.html 里找不到 UI-CORE 标记');
  return HTML.slice(i + begin.length, j);
}

const CODE = readCore();
// eslint-disable-next-line no-new-func
const C = new Function(CODE + '\nreturn UI_CORE;')();

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('核心段不碰 DOM / the core block never touches the DOM', () => {
  assert.ok(!/\bdocument\b/.test(CODE), 'core 段不应出现 document');
  assert.ok(!/\bwindow\b/.test(CODE), 'core 段不应出现 window');
  assert.ok(!/\blocalStorage\b/.test(CODE), 'core 段不应出现 localStorage');
});

test('事件状态：未开赛 / 进行中 / 已结束（边界日按进行中算）', () => {
  const today = '2026-10-28';
  const ev = { start: '2027-01-07', end: '2027-02-05' };
  assert.equal(C.eventStatus(ev, today), 'upcoming');
  assert.equal(C.eventStatus({ start: '2026-08-01', end: '2027-05-31' }, today), 'live');
  assert.equal(C.eventStatus({ start: '2026-06-11', end: '2026-07-19' }, today), 'ended');
  assert.equal(C.eventStatus({ start: today, end: '2026-12-31' }, today), 'live', '开赛当天算进行中');
  assert.equal(C.eventStatus({ start: '2026-08-01', end: today }, today), 'live', '结束当天仍算进行中');
  assert.equal(C.eventStatus({ start: '2026-08-01', end: '2026-10-27' }, today), 'ended');
});

test('日期一律按 UTC 解析与格式化，不受本地时区影响', () => {
  assert.equal(C.parseDay('2026-10-28'), Date.UTC(2026, 9, 28));
  // UTC 当天 23:30 仍然是同一天
  assert.equal(C.todayISO(Date.UTC(2026, 9, 28, 23, 30)), '2026-10-28');
  // UTC 当天 00:10 也是同一天（若用本地时区，东八区会算成前一天）
  assert.equal(C.todayISO(Date.UTC(2026, 9, 28, 0, 10)), '2026-10-28');
  assert.ok(Number.isNaN(C.parseDay('2026-13-01')), '非法月份返回 NaN');
  assert.equal(C.daysUntil('2026-11-04', '2026-10-28'), 7);
  assert.equal(C.addDays('2026-10-28', 7), '2026-11-04');
});

test('模型 vs 市场的分歧：三个结果里差值最大的那个，单位百分点', () => {
  close(C.disagreement([0.30, 0.26, 0.44], [0.25, 0.30, 0.45]), 5);
  close(C.disagreement([0.50, 0.30, 0.20], [0.50, 0.30, 0.20]), 0);
  close(C.disagreement([0.10, 0.10, 0.80], [0.10, 0.18, 0.72]), 8);
  assert.equal(C.disagreement([0.5, 0.3, 0.2], null), null, '没有市场赔率就没有分歧');
  assert.equal(C.disagreement(null, [0.5, 0.3, 0.2]), null);
});

test('夺冠概率带：按概率降序切段，合计恰好 100%', () => {
  const segs = C.bandSegments([
    { team: 'A', p: 0.5 }, { team: 'B', p: 0.3 }, { team: 'C', p: 0.2 }
  ]);
  assert.deepEqual(segs.map(s => s.team), ['A', 'B', 'C']);
  close(C.bandSum(segs), 100, 1e-9);
  assert.deepEqual(segs.map(s => Math.round(s.pct)), [50, 30, 20]);
  assert.deepEqual(segs.map(s => s.level), [6, 5, 5]);

  // 三等分：浮点除法后也必须正好 100
  const thirds = C.bandSegments([{ team: 'A', p: 1 / 3 }, { team: 'B', p: 1 / 3 }, { team: 'C', p: 1 / 3 }]);
  close(C.bandSum(thirds), 100, 1e-9);
  assert.equal(thirds.length, 3);

  // 概率和为 1 以外的情况按比例归一
  const scaled = C.bandSegments([{ team: 'A', p: 3 }, { team: 'B', p: 1 }]);
  close(C.bandSum(scaled), 100, 1e-9);
  close(scaled[0].pct, 75, 1e-9);

  // 0 与负数不入段，空输入不报错
  assert.equal(C.bandSegments([{ team: 'A', p: 0 }, { team: 'B', p: -1 }]).length, 0);
  assert.deepEqual(C.bandSegments([]), []);
  assert.deepEqual(C.bandSegments(null), []);
});

test('名次热力表取值：低于 0.5% 留空，其余分 1–5 级且随概率单调', () => {
  assert.equal(C.heatLevel(0), 0);
  assert.equal(C.heatLevel(0.0049), 0, '<0.5% 留空');
  assert.equal(C.heatLevel(0.005), 1);
  assert.equal(C.heatLevel(0.19), 1);
  assert.equal(C.heatLevel(0.21), 2);
  assert.equal(C.heatLevel(0.5), 3);
  assert.equal(C.heatLevel(1), 5);
  let prev = 0;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const lv = C.heatLevel(p);
    assert.ok(lv >= prev, `概率 ${p.toFixed(2)} 的等级不应下降`);
    assert.ok(lv >= 0 && lv <= 5);
    prev = lv;
  }
});

test('名次区间：一名同时属于冠军与前四时，取范围更窄的那个', () => {
  const zones = [
    { key: 'title', from: 1, to: 1 },
    { key: 'ucl', from: 1, to: 4 },
    { key: 'relegation_playoff', from: 16, to: 16 },
    { key: 'relegation', from: 17, to: 18 }
  ];
  assert.equal(C.positionZone(1, zones).key, 'title');
  assert.equal(C.positionZone(3, zones).key, 'ucl');
  assert.equal(C.positionZone(4, zones).key, 'ucl');
  assert.equal(C.positionZone(16, zones).key, 'relegation_playoff');
  assert.equal(C.positionZone(18, zones).key, 'relegation');
  assert.equal(C.positionZone(9, zones), null);
  assert.equal(C.positionZone(1, null), null);
});

test('未来窗口：窗口内有比赛就用窗口，空 upcoming 走兜底且不报错', () => {
  const today = '2026-10-28';
  const rows = [
    { date: '2026-10-20', league: 'a', home: 'X', away: 'Y' },
    { date: '2026-10-29', league: 'a', home: 'A', away: 'B' },
    { date: '2026-11-04', league: 'b', home: 'C', away: 'D' },
    { date: '2026-11-11', league: 'b', home: 'E', away: 'F' }
  ];
  const win = C.fixtureRows(rows, today, 7);
  assert.equal(win.fallback, false);
  assert.deepEqual(win.rows.map(r => r.date), ['2026-10-29', '2026-11-04']);

  // 窗口内没有比赛：退回最近 n 场，先过去的（日期由近到远），再未来的
  const past = rows.filter(r => r.date < '2026-10-28');
  const res = C.fixtureRows(past, today, 7, 2);
  assert.equal(res.fallback, true);
  assert.equal(res.rows.length, 1, 'n 只设上限，不够就少给');
  assert.deepEqual(res.rows.map(r => r.date), ['2026-10-20']);

  // 过去的和未来的都在窗口外时，先列过去的（由近到远），再列未来的
  const mixed = C.fixtureRows([
    { date: '2026-10-20' }, { date: '2026-11-30' }, { date: '2026-12-10' }, { date: '2026-12-20' }
  ], '2026-12-01', 7, 3);
  assert.equal(mixed.fallback, true);
  assert.deepEqual(mixed.rows.map(r => r.date), ['2026-11-30', '2026-10-20', '2026-12-10']);

  // 空数组 / null / undefined 都不抛错
  for (const empty of [[], null, undefined]) {
    const r = C.fixtureRows(empty, today, 7);
    assert.deepEqual(r.rows, []);
    assert.equal(r.empty, true);
    assert.equal(r.fallback, true);
  }

  // 没有日期的行被忽略，不会产生 NaN 排序
  const clean = C.fixtureRows([{ date: null }, { date: '2026-10-30' }], today, 7);
  assert.deepEqual(clean.rows.map(r => r.date), ['2026-10-30']);
});

test('赛程窗口端点与联赛进度', () => {
  assert.equal(C.inWindow('2026-10-28', '2026-10-28', 7), true);
  assert.equal(C.inWindow('2026-11-04', '2026-10-28', 7), true, '含右端点');
  assert.equal(C.inWindow('2026-11-05', '2026-10-28', 7), false);
  assert.equal(C.inWindow('2026-10-27', '2026-10-28', 7), false);
  close(C.progressRatio(70, 310), 70 / 380);
  assert.equal(C.progressRatio(0, 0), 0);
  assert.equal(C.seasonLabel('2627'), '26/27');
});

test('百分比格式化：四舍五入、100%、极小值与 0', () => {
  assert.equal(C.fmtPct(0.5314), '53.1%');
  assert.equal(C.fmtPct(0.5314, 0), '53%');
  assert.equal(C.fmtPct(1), '100%');
  assert.equal(C.fmtPct(0.9996), '100%');
  assert.equal(C.fmtPct(0.0001), '<0.1%');
  assert.equal(C.fmtPct(0), '0%');
  assert.equal(C.fmtPct(undefined), '0%');
  assert.equal(C.fmtPp(8.234), '8.2pp');
  assert.equal(C.fmtPp(null), '0.0pp');
});

// 回测结论（训练季 1314–1617 与测试季 1718–2526 都是市场 RPS 更低）决定：
// 模型偏离市场是风险，不是机会。这条测试钉住文案语义，防止被改回「发现分歧=找机会」。
test('模型偏离市场的文案是风险提示，不是机会提示', () => {
  const copies = HTML.match(/gapRisk:\s*'([^']*)'/g) || [];
  assert.equal(copies.length, 2, 'zh/en 各一条 gapRisk');
  assert.match(copies[0], /风险/);
  assert.match(copies[1], /risk/i);
  for (const m of copies) assert.doesNotMatch(m, /机会/, '不得把偏离描述成机会');
  // 表格里标黄的判定阈值仍是 8pp
  assert.match(HTML, /gap >= 8/);
});
