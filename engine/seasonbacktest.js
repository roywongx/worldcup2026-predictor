'use strict';
// 赛季级样本外检验：在若干检查点截断数据、模拟剩余赛季，评分「各队最终落在某名次区间」的概率。
// 与比赛级 RPS 互补：比赛级看不出「领先 6 分就说 90% 夺冠」这种过度自信。
// σ 只在训练赛季（1314–1617）上调，测试赛季只用来报告。
const { mulberry32 } = require('./simulate');
const { TOP, rankTable, prepareLeague, runSeason } = require('./league');
const { seasonTeams } = require('./clubdata');

const CHECKPOINTS = ['10-25', '01-01', '03-15'];
const CAL_EDGES = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1];
const CLAMP = 1e-4;

/** 名次区间（1 起）：title = 第 1；top4 = 第 1–4；bottom3 = 倒数 3 名（N−2..N）。 */
function zonesFor(n) {
  return { title: [1, 1], top4: [1, 4], bottom3: [n - 2, n] };
}

/** 检查点日期：8–12 月的检查点用赛季起始年，1–6 月用次年（1718 + '01-01' → 2018-01-01）。 */
function checkpointDate(season, mmdd) {
  const y = 2000 + +season.slice(0, 2);
  return +mmdd.slice(0, 2) < 7 ? `${y + 1}-${mmdd}` : `${y}-${mmdd}`;
}

/** Brier 与 log-loss（p 夹在 [1e-4, 1−1e-4]）。 */
function rate(preds) {
  const n = preds.length;
  if (!n) return { n: 0, brier: null, logLoss: null };
  let brier = 0, ll = 0;
  for (const { p, y } of preds) {
    const d = p - y;
    brier += d * d;
    const q = Math.min(1 - CLAMP, Math.max(CLAMP, p));
    ll += y ? -Math.log(q) : -Math.log(1 - q);
  }
  return { n, brier: brier / n, logLoss: ll / n };
}

/** 校准分箱：n、平均预测、实际频率。p 正好等于 1 时进最后一箱。 */
function calibrate(preds, edges = CAL_EDGES) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], n: 0, pSum: 0, ySum: 0 }));
  for (const { p, y } of preds) {
    let k = bins.length - 1;
    for (let i = 0; i < bins.length; i++) if (p < bins[i].hi) { k = i; break; }
    bins[k].n++; bins[k].pSum += p; bins[k].ySum += y;
  }
  return bins.map(b => ({ lo: b.lo, hi: b.hi, n: b.n, pred: b.n ? b.pSum / b.n : null, freq: b.n ? b.ySum / b.n : null }));
}

const rmse = xs => Math.sqrt(xs.reduce((s, x) => s + (x.pred - x.actual) ** 2, 0) / xs.length);

/**
 * 对五大联赛顶级的每个赛季、每个检查点做一次 prepareLeague（σ 网格复用同一份 prep），
 * 再用每个 σ 各跑一次 runSeason，按比赛数完整的赛季评分。
 * cfgByDivision: { E0: { tiebreak: [...] }, ... } 或 Map。
 */
function seasonBacktest(matches, cfgByDivision, {
  fromSeason = '1718', toSeason = '2526', checkpoints = CHECKPOINTS, sigmas = [0],
  sims = 5000, seed = 20260801, modelOpts = {}, log = () => {},
} = {}) {
  const cfgOf = d => (cfgByDivision instanceof Map ? cfgByDivision.get(d) : cfgByDivision[d]) || {};
  const acc = sigmas.map(() => ({
    zones: { title: [], top4: [], bottom3: [] },
    pts: [],
    byCp: checkpoints.map(() => ({ zones: { title: [], top4: [], bottom3: [] }, pts: [] })),
  }));
  const skipped = [];
  const scored = new Set();
  let fitted = 0;

  for (const division of TOP) {
    const tiebreak = cfgOf(division).tiebreak || ['pts', 'gd', 'gf'];
    const seasons = [...new Set(matches
      .filter(m => m.division === division && m.season >= fromSeason && m.season <= toSeason)
      .map(m => m.season))].sort();
    for (const season of seasons) {
      const ms = matches.filter(m => m.division === division && m.season === season);
      const teams = seasonTeams(matches, division, season);
      const n = teams.length;
      if (ms.length !== n * (n - 1)) {
        skipped.push({ division, season, teams: n, matches: ms.length, expected: n * (n - 1), reason: '赛季不完整（比赛数 ≠ n(n−1)）' });
        continue;
      }
      const truth = rankTable(teams, ms, tiebreak, mulberry32(1));
      scored.add(division + '|' + season);
      const posOf = new Map(truth.map((r, i) => [r.team, i + 1]));
      const ptsOf = new Map(truth.map(r => [r.team, r.pts]));
      const zoneRank = zonesFor(n);

      for (let ci = 0; ci < checkpoints.length; ci++) {
        const asOf = checkpointDate(season, checkpoints[ci]);
        const prep = prepareLeague(matches, { division, season, tiebreak }, { asOf, modelOpts, seed });
        fitted++;
        sigmas.forEach((sigma, si) => {
          const { tally, ptsSum } = runSeason(prep, { sims, seed, sigma });
          for (const t of teams) {
            const tp = posOf.get(t), arr = tally.get(t);
            for (const [zone, [lo, hi]] of Object.entries(zoneRank)) {
              let p = 0;
              for (let r = lo - 1; r <= hi - 1; r++) p += arr[r];
              const item = { p: p / sims, y: tp >= lo && tp <= hi ? 1 : 0 };
              acc[si].zones[zone].push(item);
              acc[si].byCp[ci].zones[zone].push(item);
            }
            const pts = { pred: ptsSum.get(t) / sims, actual: ptsOf.get(t) };
            acc[si].pts.push(pts);
            acc[si].byCp[ci].pts.push(pts);
          }
        });
        log({ division, season, asOf, teams: n, sims });
      }
    }
  }

  const summarize = si => {
    const a = acc[si];
    const zone = z => rate(a.zones[z]);
    const title = zone('title'), top4 = zone('top4'), bottom3 = zone('bottom3');
    return {
      sigma: sigmas[si],
      n: title.n,
      title, top4, bottom3,
      meanBrier: (title.brier + top4.brier + bottom3.brier) / 3,
      rmsePts: rmse(a.pts),
      calibration: { title: calibrate(a.zones.title), bottom3: calibrate(a.zones.bottom3) },
      byCheckpoint: checkpoints.map((cp, ci) => {
        const z = k => rate(a.byCp[ci].zones[k]);
        const bt = z('title'), b4 = z('top4'), bb = z('bottom3');
        return { checkpoint: cp, n: bt.n, title: bt, top4: b4, bottom3: bb, meanBrier: (bt.brier + b4.brier + bb.brier) / 3, rmsePts: rmse(a.byCp[ci].pts) };
      }),
    };
  };

  return {
    seasons: { from: fromSeason, to: toSeason },
    seasonCount: new Set([...scored].map(k => k.split('|')[1])).size,
    divisionSeasons: scored.size,
    checkpoints, sigmas, sims, seed,
    fitted,
    n: acc.length ? acc[0].zones.title.length : 0,
    skipped,
    notes: [
      '评估区间统一按名次定义，不随历史规则变化：title = 第 1 名；top4 = 第 1–4 名；bottom3 = 倒数 3 名（N−2..N）。',
      '检查点日期：10-25 用赛季起始年，01-01 / 03-15 用次年；当天及以后的比赛不参与拟合。',
      '积分处罚（扣分）数据里没有，未处理。',
      '比赛数 ≠ n(n−1) 的赛季跳过（fixtures 不完整）。',
    ],
    bySigma: sigmas.map((_, si) => summarize(si)),
  };
}

/** 只在训练赛季上选 σ：目标 = title / top4 / bottom3 三个区间 Brier 的平均（检查点合并）。 */
function seasonTune(matches, cfgByDivision, {
  trainFrom = '1314', trainTo = '1617', grid = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3],
  sims = 2000, seed = 20260801, modelOpts = {}, log = () => {},
} = {}) {
  const r = seasonBacktest(matches, cfgByDivision, { fromSeason: trainFrom, toSeason: trainTo, sigmas: grid, sims, seed, modelOpts });
  const results = r.bySigma.map(x => ({
    sigma: x.sigma, objective: x.meanBrier,
    title: x.title.brier, top4: x.top4.brier, bottom3: x.bottom3.brier,
    logLoss: (x.title.logLoss + x.top4.logLoss + x.bottom3.logLoss) / 3,
    rmsePts: x.rmsePts, n: x.n,
  }));
  for (const x of results) log(x);
  const best = results.slice().sort((a, b) => a.objective - b.objective)[0];
  return { best, results, trainFrom, trainTo, sims, checkpoints: r.checkpoints, n: r.n, skipped: r.skipped, seed };
}

module.exports = { CHECKPOINTS, CAL_EDGES, zonesFor, checkpointDate, rate, calibrate, seasonBacktest, seasonTune };
