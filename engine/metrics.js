'use strict';
// 胜平负概率的评分：RPS（有序结果的标准评分，越低越好）、log-loss、Brier、命中率、校准分箱。

const result = (hg, ag) => (hg > ag ? 0 : hg === ag ? 1 : 2);

function rps(p, o) {
  const cum = [p[0], p[0] + p[1]];
  const obs = [o === 0 ? 1 : 0, o <= 1 ? 1 : 0];
  return ((cum[0] - obs[0]) ** 2 + (cum[1] - obs[1]) ** 2) / 2;
}

function score(preds) {
  const n = preds.length;
  if (!n) return { n: 0 };
  let r = 0, ll = 0, br = 0, hit = 0;
  for (const { p, o } of preds) {
    r += rps(p, o);
    ll += -Math.log(Math.max(p[o], 1e-12));
    for (let i = 0; i < 3; i++) br += (p[i] - (i === o ? 1 : 0)) ** 2;
    const pick = p.indexOf(Math.max(...p));
    if (pick === o) hit++;
  }
  return { n, rps: r / n, logLoss: ll / n, brier: br / n, accuracy: hit / n };
}

/** 校准：把所有 (预测概率, 是否发生) 按概率分 10 箱，返回每箱平均预测 vs 实际频率。 */
function calibration(preds, bins = 10) {
  const b = Array.from({ length: bins }, () => ({ p: 0, y: 0, n: 0 }));
  for (const { p, o } of preds) for (let i = 0; i < 3; i++) {
    const k = Math.min(bins - 1, Math.floor(p[i] * bins));
    b[k].p += p[i]; b[k].y += i === o ? 1 : 0; b[k].n++;
  }
  const out = b.filter(x => x.n).map(x => ({ predicted: x.p / x.n, observed: x.y / x.n, n: x.n }));
  const ece = out.reduce((s, x) => s + Math.abs(x.predicted - x.observed) * x.n, 0) / out.reduce((s, x) => s + x.n, 0);
  return { bins: out, ece };
}

module.exports = { result, rps, score, calibration };
