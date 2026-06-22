// World Cup 2026 Predictor — extracted module
// model/stats.js — Pure math and scoring functions (no dependencies beyond data/)
globalThis.WC26 = globalThis.WC26 || {};

/** Negative Binomial PMF: P(X=k) = C(k+r-1, k) * (r/(r+μ))^r * (μ/(r+μ))^k */
WC26.negBinPMF = function(k, mu, r) {
  if (mu <= 0) return k === 0 ? 1 : 0;
  if (r <= 0) return WC26.poissonPMF(k, mu);
  const p = r / (r + mu);
  let logCoeff = 0;
  for (let i = 0; i < k; i++) logCoeff += Math.log(r + i) - Math.log(i + 1);
  return Math.exp(logCoeff + r * Math.log(p) + k * Math.log(1 - p));
};

/** Gamma(r,1) sample via Marsaglia-Tsang (r >= 1) with boost for r < 1 */
WC26.gammaSample = function(r) {
  if (r < 1) return WC26.gammaSample(r + 1) * Math.pow(Math.random(), 1 / r);
  const d = r - 1/3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = WC26.randn(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};

/** Standard normal sample via Box-Muller (caches second sample) */
WC26._randnSpare = null;
WC26.randn = function() {
  if (WC26._randnSpare !== null) { const s = WC26._randnSpare; WC26._randnSpare = null; return s; }
  const u = Math.random(), v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u || 1e-10));
  WC26._randnSpare = mag * Math.sin(2 * Math.PI * v);
  return mag * Math.cos(2 * Math.PI * v);
};

/** Poisson probability mass function */
WC26.poissonPMF = function(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lam + k * Math.log(lam) - WC26._logFactorial(k));
};

/** Dixon-Coles tau correction for low-score correlation */
WC26.dixonColesTau = function(h, a, lh, la, rho) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
};

/** Sample from Negative Binomial via Gamma-Poisson mixture */
WC26.negBinSample = function(mu, r) {
  if (mu <= 0) return 0;
  if (r <= 0) return WC26._poissonSampleRaw(mu);
  const g = WC26.gammaSample(r);
  return WC26._poissonSampleRaw(mu * g / r);
};

/** Raw Poisson sample: Knuth for λ<10, transformed rejection for 10≤λ<30, normal for λ≥30 */
WC26._poissonSampleRaw = function(lam) {
  if (lam <= 0) return 0;
  if (lam < 10) {
    // Knuth algorithm — O(λ) iterations, fast for small λ
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  if (lam >= 30) {
    // Normal approximation with continuity correction
    const s = WC26.randn();
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * s));
  }
  // 10 ≤ λ < 30: Atkinson transformed rejection (constant-time average)
  const c = 0.767 - 3.36 / lam;
  const beta = Math.PI / Math.sqrt(3 * lam);
  const alpha = beta * lam;
  const k = Math.log(c) - lam - Math.log(beta);
  const logLam = Math.log(lam);
  while (true) {
    let u = Math.random();
    if (u === 0) continue;
    const x = (alpha - Math.log((1 - u) / u)) / beta;
    const n = Math.floor(x + 0.5);
    if (n < 0) continue;
    const v = Math.random();
    const y = alpha - beta * x;
    const lhs = y + Math.log(v / (1 + Math.exp(y)) / (1 + Math.exp(y)));
    const rhs = k + n * logLam - WC26._logFactorial(n);
    if (lhs <= rhs) return n;
  }
};

/** Log factorial using Stirling for n>15 */
WC26._logFactorial = function(n) {
  if (n <= 15) return Math.log(WC26.FACT[n]);
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
};

/** Sample from Poisson or Negative Binomial (when NB_R > 0, consistent with matchProbs) */
WC26.poissonSample = function(lam) {
  if (WC26.NB_R > 0) return WC26.negBinSample(lam, WC26.NB_R);
  return WC26._poissonSampleRaw(lam);
};

/** Ranked Probability Score (football standard) */
WC26.rankedProbabilityScore = function(probs, outcome) {
  const cumProbs = [probs[0], probs[0] + probs[1], 1];
  const cumOutcome = [outcome === 0 ? 1 : 0, outcome <= 1 ? 1 : 0, 1];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += Math.pow(cumProbs[i] - cumOutcome[i], 2);
  }
  return sum / 2;
};

/** Multi-class Brier score */
WC26.brierScore = function(probs, outcome) {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const actual = i === outcome ? 1 : 0;
    sum += Math.pow(probs[i] - actual, 2);
  }
  return sum / 3;
};

/** Log loss */
WC26.logLoss = function(probs, outcome) {
  const p = Math.max(0.001, Math.min(0.999, probs[outcome]));
  return -Math.log(p);
};

/** Expected Calibration Error (ECE) */
WC26.expectedCalibrationError = function(predictions, outcomes, nBins) {
  nBins = nBins || 10;
  const bins = Array.from({length: nBins}, () => ({ count: 0, sumProb: 0, sumCorrect: 0 }));

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const predictedClass = pred[0] >= pred[1] && pred[0] >= pred[2] ? 0 :
                           pred[1] >= pred[2] ? 1 : 2;
    const confidence = pred[predictedClass];
    const binIdx = Math.min(nBins - 1, Math.floor(confidence * nBins));
    bins[binIdx].count++;
    bins[binIdx].sumProb += confidence;
    bins[binIdx].sumCorrect += (predictedClass === outcomes[i]) ? 1 : 0;
  }

  let ece = 0, totalCount = 0;
  for (const bin of bins) {
    if (bin.count > 0) {
      const avgConfidence = bin.sumProb / bin.count;
      const avgAccuracy = bin.sumCorrect / bin.count;
      ece += bin.count * Math.abs(avgConfidence - avgAccuracy);
      totalCount += bin.count;
    }
  }
  return totalCount > 0 ? ece / totalCount : 0;
};

/** Temperature scaling: reduces overconfidence by smoothing extreme probabilities */
WC26.temperatureScale = function(pW, pD, pL, T) {
  T = T || 1.15;
  const sW = Math.pow(pW, 1 / T);
  const sD = Math.pow(pD, 1 / T);
  const sL = Math.pow(pL, 1 / T);
  const sum = sW + sD + sL;
  const EPS = 0.001;
  const rW = Math.max(EPS, Math.min(1 - EPS, sW / sum));
  const rD = Math.max(EPS, Math.min(1 - EPS, sD / sum));
  const rL = Math.max(EPS, Math.min(1 - EPS, sL / sum));
  const rSum = rW + rD + rL;
  return { win: rW / rSum, draw: rD / rSum, loss: rL / rSum };
};

/** Fit isotonic calibration using PAVA (Pool Adjacent Violators Algorithm) */
WC26.fitIsotonicCalibration = function(actualResults) {
  if (!actualResults || actualResults.length < 20) return null;

  const outcomes = { win: [], draw: [], loss: [] };
  for (const r of actualResults) {
    if (!r.probs || typeof r.probs.win !== 'number') continue;
    const outcome = r.score1 > r.score2 ? 0 : (r.score1 === r.score2 ? 1 : 2);
    outcomes.win.push({ p: r.probs.win, y: outcome === 0 ? 1 : 0 });
    outcomes.draw.push({ p: r.probs.draw, y: outcome === 1 ? 1 : 0 });
    outcomes.loss.push({ p: r.probs.loss, y: outcome === 2 ? 1 : 0 });
  }

  const result = {};
  for (const cls of ['win', 'draw', 'loss']) {
    const data = outcomes[cls];
    if (data.length < 5) { result[cls] = null; continue; }

    data.sort((a, b) => a.p - b.p);

    let bins = data.map(d => ({ sumP: d.p, sumY: d.y, count: 1 }));

    let changed = true;
    while (changed) {
      changed = false;
      const newBins = [];
      for (let i = 0; i < bins.length; i++) {
        if (newBins.length > 0) {
          const prev = newBins[newBins.length - 1];
          const prevRate = prev.sumY / prev.count;
          const currRate = bins[i].sumY / bins[i].count;
          if (currRate < prevRate) {
            prev.sumP += bins[i].sumP;
            prev.sumY += bins[i].sumY;
            prev.count += bins[i].count;
            changed = true;
            continue;
          }
        }
        newBins.push({ ...bins[i] });
      }
      bins = newBins;
    }

    result[cls] = bins.map(b => ({
      p: b.sumP / b.count,
      calP: b.sumY / b.count
    }));
  }
  return result;
};

/** Apply isotonic calibration to a probability triplet using lookup table */
WC26.applyIsotonicCalibration = function(probs, iso) {
  if (!iso) return probs;

  const calibrate = (p, lookup) => {
    if (!lookup || lookup.length === 0) return p;
    p = Math.max(0.001, Math.min(0.999, p));
    // Binary search for the bin
    let lo = 0, hi = lookup.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lookup[mid].p <= p) lo = mid; else hi = mid - 1; }
    // Linear interpolation between adjacent bins
    if (lo < lookup.length - 1) {
      const a = lookup[lo], b = lookup[lo + 1];
      const t = (p - a.p) / Math.max(1e-10, b.p - a.p);
      return a.calP + t * (b.calP - a.calP);
    }
    return lookup[lo].calP;
  };

  let cW = calibrate(probs.win, iso.win);
  let cD = calibrate(probs.draw, iso.draw);
  let cL = calibrate(probs.loss, iso.loss);

  const total = cW + cD + cL;
  return { win: cW/total, draw: cD/total, loss: cL/total };
};

/** Apply cached isotonic calibration to raw probabilities */
WC26.calibrateProbs = function(pW, pD, pL) {
  if (!WC26.isotonicCalibration) return { win: pW, draw: pD, loss: pL };
  const wBins = WC26.isotonicCalibration.win ? WC26.isotonicCalibration.win.length : 0;
  const dBins = WC26.isotonicCalibration.draw ? WC26.isotonicCalibration.draw.length : 0;
  const lBins = WC26.isotonicCalibration.loss ? WC26.isotonicCalibration.loss.length : 0;
  if (wBins < 3 || dBins < 3 || lBins < 3) {
    return { win: pW, draw: pD, loss: pL };
  }
  const cal = WC26.applyIsotonicCalibration({ win: pW, draw: pD, loss: pL }, WC26.isotonicCalibration);
  if (!cal || typeof cal.win !== 'number' || isNaN(cal.win)) return { win: pW, draw: pD, loss: pL };
  const total = cal.win + cal.draw + cal.loss;
  if (total <= 0) return { win: pW, draw: pD, loss: pL };
  const rW = cal.win / total, rD = cal.draw / total, rL = cal.loss / total;
  return { win: rW, draw: rD, loss: rL };
};

/** Fit isotonic calibration from actualResults and cache it */
WC26.fitAndCacheCalibration = function(actualResults) {
  WC26.isotonicCalibration = WC26.fitIsotonicCalibration(actualResults);
};
