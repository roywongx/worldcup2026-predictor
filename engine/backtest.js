'use strict';
// 滚动回测：赛事每个比赛日都只用「当天之前」的比赛重新拟合，再预测当天各场，不偷看结果。
const { editions } = require('./data');
const { runElo, HOME_ADV } = require('./elo');
const dc = require('./dc');
const { result, score, calibration } = require('./metrics');

const TOURNAMENTS = ['FIFA World Cup', 'UEFA Euro', 'Copa Am\u00e9rica', 'African Cup of Nations', 'AFC Asian Cup', 'Gold Cup'];

/** 一次遍历全部历史，记下每场比赛赛前的 Elo（[主, 客]，主队已含主场 +100）。 */
function preMatchElo(matches) {
  const pre = new Map();
  runElo(matches, {
    onBefore(m, r) {
      const rh = r.has(m.home) ? r.get(m.home) : 1500, ra = r.has(m.away) ? r.get(m.away) : 1500;
      pre.set(m, [rh + (m.neutral ? 0 : HOME_ADV), ra]);
    },
  });
  return pre;
}

function selectEditions(matches, { tournaments = TOURNAMENTS, from = 2010, to = 9999 } = {}) {
  return tournaments.flatMap(t => editions(matches, t)).filter(e => e.year >= from && e.year <= to)
    .sort((a, b) => a.start - b.start);
}

/**
 * 回测若干届赛事。mode='rolling' 每个比赛日重拟合；'pre' 只在开赛前拟合一次（调参用，快）。
 * 返回每场预测与汇总指标。
 */
function backtest(matches, eds, opts = {}, { mode = 'rolling', pre = null } = {}) {
  const eloPre = pre || preMatchElo(matches);
  const eloAt = m => eloPre.get(m);
  const rows = [];
  for (const ed of eds) {
    let model = null, fittedFor = null;
    for (const m of ed.matches) {
      const fitDay = mode === 'pre' ? ed.start : m.day;
      if (fittedFor !== fitDay) { model = dc.fit(matches, fitDay, opts, eloAt); fittedFor = fitDay; }
      const [rh, ra] = eloPre.get(m);
      const p = dc.predict(model, m.home, m.away, { neutral: m.neutral, eloDiff: rh - ra });
      rows.push({ edition: `${ed.tournament} ${ed.year}`, tournament: ed.tournament, year: ed.year, date: m.date,
        home: m.home, away: m.away, hg: m.hg, ag: m.ag,
        p: [p.pH, p.pD, p.pA], o: result(m.hg, m.ag), eloP: eloOnly(rh, ra) });
    }
  }
  return rows;
}

// 基准 1：Elo 胜率 + 经验平局率（|ΔElo| 越大平局越少）
function eloOnly(rh, ra) {
  const we = 1 / (1 + Math.pow(10, (ra - rh) / 400));
  const pD = 0.29 * Math.exp(-Math.pow((rh - ra) / 520, 2));
  return [Math.max(0, we - pD / 2), pD, Math.max(0, 1 - we - pD / 2)];
}

function summarize(rows) {
  const by = key => {
    const g = new Map();
    for (const r of rows) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return [...g].map(([k, rs]) => ({ key: k, model: score(rs), elo: score(rs.map(r => ({ p: r.eloP, o: r.o }))) }));
  };
  const base = baseRates(rows);
  return {
    overall: { model: score(rows), elo: score(rows.map(r => ({ p: r.eloP, o: r.o }))), base: score(rows.map(r => ({ p: base, o: r.o }))) },
    calibration: calibration(rows),
    byTournament: by(r => r.tournament),
    byEdition: by(r => r.edition),
  };
}

function baseRates(rows) {
  const c = [0, 0, 0];
  for (const r of rows) c[r.o]++;
  return c.map(x => x / rows.length);
}

module.exports = { TOURNAMENTS, preMatchElo, selectEditions, backtest, summarize, eloOnly };
