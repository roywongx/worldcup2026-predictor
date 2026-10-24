'use strict';
// 调参：只在训练届次（默认 2010–2016 开赛）上做网格搜索，选 RPS 最低的参数；测试届次（2017+）只用来报告。
// 用「开赛前拟合一次」模式加速；最终评估用 rolling。
const bt = require('./backtest');
const { score } = require('./metrics');

const GRID = {
  halfLifeDays: [365, 730, 1460],
  friendlyWeight: [0.3, 0.6, 1],
  prior: [1, 3, 8],
  eloBeta: [0, 0.5, 1, 1.5, 2],
};

function* combos(grid) {
  const keys = Object.keys(grid);
  const idx = keys.map(() => 0);
  while (true) {
    yield Object.fromEntries(keys.map((k, i) => [k, grid[k][idx[i]]]));
    let i = keys.length - 1;
    while (i >= 0 && ++idx[i] === grid[keys[i]].length) idx[i--] = 0;
    if (i < 0) return;
  }
}

function tune(matches, { trainTo = 2016, grid = GRID, log = () => {} } = {}) {
  const pre = bt.preMatchElo(matches);
  const train = bt.selectEditions(matches, { from: 2010, to: trainTo });
  const results = [];
  for (const opts of combos(grid)) {
    const s = score(bt.backtest(matches, train, opts, { mode: 'pre', pre }));
    results.push({ opts, rps: s.rps, logLoss: s.logLoss });
    log(opts, s);
  }
  results.sort((a, b) => a.rps - b.rps);
  return { best: results[0], results, trainEditions: train.length, trainMatches: results.length ? undefined : 0 };
}

module.exports = { GRID, tune, combos };
