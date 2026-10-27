'use strict';
// 俱乐部回测：每隔 refitEveryDays 用「当天之前」的全部俱乐部比赛重拟合（一次拟合服务所有级别），
// 再预测当天各场。目标级别与赛季由调用方指定；绝不使用当天及以后的比赛。
const dc = require('./dc');
const { score, calibration, result } = require('./metrics');
const { eloOnly, preMatchElo } = require('./backtest');
const { combos } = require('./tune');
const { TOP } = require('./league');

function clubBacktest(matches, { divisions = TOP, fromSeason = '0000', toSeason = '9999', opts = {}, refitEveryDays = 7, pre = null } = {}) {
  const eloPre = pre || preMatchElo(matches);
  const eloAt = m => eloPre.get(m);
  const targets = matches.filter(m => divisions.includes(m.division) && m.season >= fromSeason && m.season <= toSeason);
  const rows = [];
  let model = null, fitDay = null;
  for (const m of targets) {
    // 重新拟合的判据只看日期，因此结果与数据被截断到某一天时完全一致（不偷看）
    if (fitDay === null || m.day - fitDay >= refitEveryDays) { model = dc.fit(matches, m.day, opts, eloAt); fitDay = m.day; }
    const [rh, ra] = eloPre.get(m);
    const p = dc.predict(model, m.home, m.away, { neutral: false, eloDiff: rh - ra });
    rows.push({
      division: m.division, season: m.season, date: m.date, day: m.day, home: m.home, away: m.away, hg: m.hg, ag: m.ag,
      p: [p.pH, p.pD, p.pA], market: m.market || null, elo: eloOnly(rh, ra), o: result(m.hg, m.ag),
    });
  }
  return rows;
}

const rated = preds => {
  const s = score(preds);
  return s.n ? { ...s, ece: calibration(preds).ece } : s;
};

function summarize(rows) {
  const marketRows = rows.filter(r => r.market);
  const overall = {
    model: rated(rows.map(r => ({ p: r.p, o: r.o }))),
    market: rated(marketRows.map(r => ({ p: r.market, o: r.o }))),
    elo: rated(rows.map(r => ({ p: r.elo, o: r.o }))),
    // 同一子集上模型 vs 市场才可比
    modelOnMarketRows: rated(marketRows.map(r => ({ p: r.p, o: r.o }))),
    eloOnMarketRows: rated(marketRows.map(r => ({ p: r.elo, o: r.o }))),
  };
  const by = key => {
    const g = new Map();
    for (const r of rows) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return [...g].map(([k, rs]) => {
      const mr = rs.filter(r => r.market);
      return { key: k, model: rated(rs.map(r => ({ p: r.p, o: r.o }))),
        market: rated(mr.map(r => ({ p: r.market, o: r.o }))), elo: rated(rs.map(r => ({ p: r.elo, o: r.o }))) };
    });
  };
  return { overall, byDivision: by(r => r.division), bySeason: by(r => r.season), calibration: calibration(rows.map(r => ({ p: r.p, o: r.o }))) };
}

const CLUB_GRID = {
  halfLifeDays: [120, 240, 365, 540],
  prior: [1, 3, 8],
  eloBeta: [0, 0.5, 1, 1.5],
  windowDays: [1095],
};

/** 只在训练赛季上网格搜索，RPS 最低者胜（测试赛季只用来报告）。 */
function clubTune(matches, { trainFrom = '1314', trainTo = '1617', grid = CLUB_GRID, refitEveryDays = 14, log = () => {} } = {}) {
  const results = [];
  for (const opts of combos(grid)) {
    const s = score(clubBacktest(matches, { fromSeason: trainFrom, toSeason: trainTo, opts, refitEveryDays }));
    results.push({ opts, rps: s.rps, logLoss: s.logLoss, n: s.n });
    log(opts, s);
  }
  results.sort((a, b) => a.rps - b.rps);
  return { best: results[0], results, trainFrom, trainTo, refitEveryDays };
}

module.exports = { TOP, CLUB_GRID, preMatchElo, clubBacktest, summarize, clubTune, rated };
