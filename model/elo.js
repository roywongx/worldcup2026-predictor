// World Cup 2026 Predictor — extracted module
// model/elo.js — Elo rating system
globalThis.WC26 = globalThis.WC26 || {};

/** Dynamic Elo ratings (mutable) */
WC26.dynamicElo = {};

/** Isotonic calibration cache */
WC26.isotonicCalibration = null;

/** Get match importance multiplier (legacy — now returns 1.0, K uses additive bonus) */
WC26.getMatchImportance = function(matchDate) {
  return 1.0;
};

/** Get rho based on match date */
WC26.getRho = function(matchDate) {
  if (matchDate && matchDate.substring(0, 10) >= '2026-06-29') return WC26.RHO_KNOCKOUT;
  return WC26.RHO_GROUP;
};

/** Elo expected score for team A */
WC26.eloExpected = function(ra, rb) {
  return 1 / (Math.pow(10, -(ra - rb) / 400) + 1);
};

/** Harmonic margin: H(gd) = sum(1/i for i=1..gd). Diminishing returns. */
WC26.eloGoalIndex = function(gd) {
  let sum = 0;
  for (let i = 1; i <= Math.min(gd, 10); i++) sum += 1 / i;
  return sum;
};

/** Update dynamic Elo ratings after a match.
 *  K = base + stage_bonus (additive, not multiplicative). */
WC26.updateElo = function(team1, team2, score1, score2, matchDate) {
  if (score1 == null || score2 == null) return;
  const ra = WC26.dynamicElo[team1], rb = WC26.dynamicElo[team2];
  const gd = Math.abs(score1 - score2);
  const G = WC26.eloGoalIndex(gd);
  const C = WC26.CONFIG;
  let K = C.ELO_K_BASE;
  if (matchDate && matchDate.substring(0, 10) >= '2026-06-29') K += C.ELO_K_KO_BONUS;
  let W;
  if (score1 > score2) W = 1;
  else if (score1 < score2) W = 0;
  else W = 0.5;
  const We = WC26.eloExpected(ra, rb);
  const Pa = K * G * (W - We);
  WC26.dynamicElo[team1] = Math.round(ra + Pa);
  WC26.dynamicElo[team2] = Math.round(rb - Pa);
};

/** Initialize dynamic Elo from static TEAMS data */
WC26.initDynamicElo = function() {
  for (const t of Object.keys(WC26.TEAMS)) {
    WC26.dynamicElo[t] = WC26.TEAMS[t].elo;
  }
};

/** Safely execute fn with pre-tournament Elo, then restore dynamic state */
WC26.withPreTournamentElo = function(fn) {
  const saved = { ...WC26.dynamicElo };
  WC26.initDynamicElo();
  try { return fn(); }
  finally { Object.assign(WC26.dynamicElo, saved); }
};

/** Rebuild dynamic Elo from scratch by replaying all results */
WC26.rebuildDynamicElo = function(results, regressRate) {
  WC26.initDynamicElo();
  for (const r of (results || [])) {
    WC26.updateElo(r.team1, r.team2, r.score1, r.score2, r.date);
  }
  // Mean reversion: pull toward pre-tournament prior after replay
  // Applied per-replay so it's not overwritten by the replay itself
  if (regressRate && regressRate > 0) {
    for (const t of Object.keys(WC26.dynamicElo)) {
      const prior = WC26.TEAMS[t] ? WC26.TEAMS[t].elo : 1500;
      WC26.dynamicElo[t] = WC26.dynamicElo[t] * (1 - regressRate) + prior * regressRate;
    }
  }
};

/** Get effective Elo for a team (dynamic if available, else static) */
WC26.getEffectiveElo = function(team) {
  if (WC26.dynamicElo && WC26.dynamicElo[team] !== undefined) return WC26.dynamicElo[team];
  return WC26.TEAMS[team] ? WC26.TEAMS[team].elo : 1500;
};

/** Mean reversion (B2): pull dynamic Elo toward pre-tournament prior.
 *  Called once per daily sync to prevent Elo drift from small sample bias.
 *  rate=0.001 means 0.1% toward prior per day (slow, conservative). */
WC26.regressElo = function(rate) {
  rate = rate || 0.001;
  if (!WC26.dynamicElo) return;
  for (const t of Object.keys(WC26.dynamicElo)) {
    const prior = WC26.TEAMS[t] ? WC26.TEAMS[t].elo : 1500;
    WC26.dynamicElo[t] = WC26.dynamicElo[t] * (1 - rate) + prior * rate;
  }
};
