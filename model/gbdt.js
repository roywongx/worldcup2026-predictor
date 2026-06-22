// World Cup 2026 Predictor — extracted module
// model/gbdt.js — Simplified Gradient Boosting Decision Trees
globalThis.WC26 = globalThis.WC26 || {};

WC26.SimpleGBDT = class SimpleGBDT {
  constructor(nTrees = 15, learningRate = 0.08, maxDepth = 2) {
    this.nTrees = nTrees;
    this.lr = learningRate;
    this.maxDepth = maxDepth;
    this.trees = [];
    this.trained = false;
    this.featureNames = ['eloDiff', 'atkDiff', 'defDiff', 'formDiff', 'homeBonus', 'momentumDiff'];
  }

  extractFeatures(team1, team2) {
    const t1 = WC26.TEAMS[team1] || {elo:1500,fifa:1500,mv:50,wc:0,form:0.5,host:0,odds:0,atk:1.0,def:1.0};
    const t2 = WC26.TEAMS[team2] || {elo:1500,fifa:1500,mv:50,wc:0,form:0.5,host:0,odds:0,atk:1.0,def:1.0};
    const dynElo1 = (WC26.dynamicElo && WC26.dynamicElo[team1]) || t1.elo;
    const dynElo2 = (WC26.dynamicElo && WC26.dynamicElo[team2]) || t2.elo;
    const form1 = WC26.getForm(team1);
    const form2 = WC26.getForm(team2);
    const momentum1 = WC26.getMomentum ? WC26.getMomentum(team1) : 0;
    const momentum2 = WC26.getMomentum ? WC26.getMomentum(team2) : 0;

    return [
      (dynElo1 - dynElo2) / 200,
      (WC26.getTeamAtk(team1) - WC26.getTeamAtk(team2)) * 5,
      (t1.def - t2.def) * 5,
      (form1 - form2) * 2,
      (t1.host - t2.host) * 10,
      (momentum1 - momentum2) * 2
    ];
  }

  train(actualResults) {
    if (!actualResults || actualResults.length < 10) {
      this.trained = false;
      return false;
    }
    this.trees = [];

    const X = [], y = [];
    for (const r of actualResults) {
      const features = this.extractFeatures(r.team1, r.team2);
      const outcome = r.score1 > r.score2 ? 0 : (r.score1 === r.score2 ? 1 : 2);
      X.push(features);
      y.push(outcome);
    }

    const n = X.length;
    const F = Array.from({ length: n }, () => [0, 0, 0]);

    for (let t = 0; t < this.nTrees; t++) {
      const probs = F.map(f => {
        const expF = f.map(Math.exp);
        const sum = expF.reduce((a, b) => a + b, 0);
        return expF.map(e => e / sum);
      });

      const residuals = Array.from({ length: n }, () => [0, 0, 0]);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          residuals[i][c] = (y[i] === c ? 1 : 0) - probs[i][c];
        }
      }

      for (let c = 0; c < 3; c++) {
        const stump = this._fitStump(X, residuals.map(r => r[c]));
        this.trees.push({ class: c, stump });

        for (let i = 0; i < n; i++) {
          F[i][c] += this.lr * this._predictStump(stump, X[i]);
        }
      }
    }

    this.trained = true;
    return true;
  }

  _fitStump(X, residuals) {
    let bestFeature = 0, bestThreshold = 0, bestGain = -Infinity;
    let bestLeftVal = 0, bestRightVal = 0;

    for (let f = 0; f < X[0].length; f++) {
      const values = X.map(x => x[f]).sort((a, b) => a - b);
      const thresholds = [];
      for (let i = 0; i < values.length - 1; i++) {
        thresholds.push((values[i] + values[i + 1]) / 2);
      }

      const step = Math.max(1, Math.floor(thresholds.length / 10));
      const sampled = thresholds.filter((_, i) => i % step === 0).slice(0, 10);
      for (const threshold of sampled) {
        let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0;
        for (let i = 0; i < X.length; i++) {
          if (X[i][f] <= threshold) {
            leftSum += residuals[i];
            leftCount++;
          } else {
            rightSum += residuals[i];
            rightCount++;
          }
        }

        if (leftCount === 0 || rightCount === 0) continue;

        const leftVal = leftSum / leftCount;
        const rightVal = rightSum / rightCount;
        const gain = leftCount * leftVal * leftVal + rightCount * rightVal * rightVal;

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = threshold;
          bestLeftVal = leftVal;
          bestRightVal = rightVal;
        }
      }
    }

    return { feature: bestFeature, threshold: bestThreshold, leftVal: bestLeftVal, rightVal: bestRightVal };
  }

  _predictStump(stump, x) {
    return x[stump.feature] <= stump.threshold ? stump.leftVal : stump.rightVal;
  }

  predict(team1, team2) {
    if (!this.trained) return null;

    const features = this.extractFeatures(team1, team2);
    const F = [0, 0, 0];

    for (const tree of this.trees) {
      F[tree.class] += this.lr * this._predictStump(tree.stump, features);
    }

    const expF = F.map(Math.exp);
    const sum = expF.reduce((a, b) => a + b, 0);
    return {
      win: expF[0] / sum,
      draw: expF[1] / sum,
      loss: expF[2] / sum
    };
  }
};

/** Global GBDT instance */
WC26.gbdt = new WC26.SimpleGBDT(15, 0.08, 2);

/** Train GBDT on available data and blend with Dixon-Coles */
WC26.trainAndBlendGBDT = function(actualResults) {
  if (!actualResults || actualResults.length < 15) return null;
  WC26.gbdt.train(actualResults);
  return WC26.gbdt.trained;
};

/** Get blended prediction: 80% Dixon-Coles + 20% GBDT */
WC26.getBlendedProbs = function(home, away, formMap, matchDate, marketProbs) {
  const dcProbs = WC26.matchProbs(home, away, formMap, matchDate, marketProbs);

  if (!WC26.gbdt.trained) return dcProbs;

  const gbdtProbs = WC26.gbdt.predict(home, away);
  if (!gbdtProbs) return dcProbs;

  const BLEND = 0.20;
  return {
    win: (1 - BLEND) * dcProbs.win + BLEND * gbdtProbs.win,
    draw: (1 - BLEND) * dcProbs.draw + BLEND * gbdtProbs.draw,
    loss: (1 - BLEND) * dcProbs.loss + BLEND * gbdtProbs.loss
  };
};
