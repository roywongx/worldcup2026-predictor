// World Cup 2026 Predictor — extracted module
// model/stats.js — Pure math and scoring functions (no dependencies beyond data/)
window.WC26 = window.WC26 || {};

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

/** Standard normal sample via Box-Muller */
WC26.randn = function() {
  const u = Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u || 1e-10)) * Math.cos(2 * Math.PI * v);
};

/** Poisson probability mass function */
WC26.poissonPMF = function(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lam + k * Math.log(lam) - Math.log(WC26.FACT[k] || WC26.FACT[15]));
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

/** Raw Poisson sample (Knuth algorithm; k<30 safe for lam < 6 via NB gamma mixing) */
WC26._poissonSampleRaw = function(lam) {
  if (lam <= 0) return 0;
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L && k < 30);
  return k - 1;
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
  const EPS = 0.015;
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
    let best = lookup[0];
    for (const bin of lookup) {
      if (p >= bin.p) best = bin;
      else break;
    }
    return best.calP;
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
  if (rW > 0.95 || rD > 0.95 || rL > 0.95 || rW < 0.05 || rD < 0.05 || rL < 0.05) {
    return { win: pW, draw: pD, loss: pL };
  }
  return { win: rW, draw: rD, loss: rL };
};

/** Fit isotonic calibration from actualResults and cache it */
WC26.fitAndCacheCalibration = function(actualResults) {
  WC26.isotonicCalibration = WC26.fitIsotonicCalibration(actualResults);
};
