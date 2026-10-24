'use strict';
// Dixon-Coles：log λ_home = μ + h·[非中立] + att_home − def_away (+ β·ΔElo/800)
//              log λ_away = μ        + att_away − def_home (− β·ΔElo/800)
// 参数用时间衰减加权的泊松似然拟合（坐标迭代，每步闭式解），att/def 以伪观测 k 向 0 收缩，
// 低比分相关性 ρ 单独做一维网格搜索。

const DEFAULTS = {
  halfLifeDays: 730,      // 时间衰减半衰期
  windowDays: 365 * 8,    // 只用这么久以内的比赛
  friendlyWeight: 0.5,    // 友谊赛权重（相对正式比赛）
  prior: 3,               // att/def 收缩的伪观测数（加权进球数量级）
  iterations: 40,
  eloBeta: 0,             // ΔElo 并入强度；0 = 纯 Dixon-Coles
  maxGoals: 10,
};

function weightOf(m, day, cfg) {
  const age = day - m.day;
  const w = Math.pow(0.5, age / cfg.halfLifeDays);
  return m.tournament === 'Friendly' ? w * cfg.friendlyWeight : w;
}

/**
 * 用 day 之前（不含）的比赛拟合。eloAt(m) 可选：返回该场赛前 [rh, ra]，用于 β 项。
 */
function fit(matches, day, opts = {}, eloAt = null) {
  const cfg = { ...DEFAULTS, ...opts };
  const rows = [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.day >= day) continue;
    if (day - m.day > cfg.windowDays) break;
    const w = weightOf(m, day, cfg);
    let e = 0;
    if (cfg.eloBeta && eloAt) { const r = eloAt(m); if (r) e = cfg.eloBeta * (r[0] - r[1]) / 800; }
    rows.push({ h: m.home, a: m.away, hg: m.hg, ag: m.ag, w, home: m.neutral ? 0 : 1, e });
  }
  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];
  const att = new Map(teams.map(t => [t, 0]));
  const def = new Map(teams.map(t => [t, 0]));
  let mu = Math.log(1.3), h = Math.log(1.25);
  const k = cfg.prior;

  for (let it = 0; it < cfg.iterations; it++) {
    // att：exp(att_i) = (Σ w·g + k) / (Σ w·exp(μ + h + e − def_opp) + k)
    const num = new Map(teams.map(t => [t, k])), den = new Map(teams.map(t => [t, k]));
    for (const r of rows) {
      const base = Math.exp(mu);
      num.set(r.h, num.get(r.h) + r.w * r.hg);
      den.set(r.h, den.get(r.h) + r.w * base * Math.exp(h * r.home + r.e - def.get(r.a)) );
      num.set(r.a, num.get(r.a) + r.w * r.ag);
      den.set(r.a, den.get(r.a) + r.w * base * Math.exp(-r.e - def.get(r.h)));
    }
    for (const t of teams) att.set(t, Math.log(num.get(t) / den.get(t)));
    // def：exp(−def_j) = (Σ w·失球 + k) / (Σ w·exp(μ + h + e + att_opp) + k)
    const dn = new Map(teams.map(t => [t, k])), dd = new Map(teams.map(t => [t, k]));
    for (const r of rows) {
      const base = Math.exp(mu);
      dn.set(r.a, dn.get(r.a) + r.w * r.hg);
      dd.set(r.a, dd.get(r.a) + r.w * base * Math.exp(h * r.home + r.e + att.get(r.h)));
      dn.set(r.h, dn.get(r.h) + r.w * r.ag);
      dd.set(r.h, dd.get(r.h) + r.w * base * Math.exp(-r.e + att.get(r.a)));
    }
    for (const t of teams) def.set(t, -Math.log(dn.get(t) / dd.get(t)));
    // 居中（可辨识性），把均值并入 μ
    const ma = mean(att), md = mean(def);
    for (const t of teams) { att.set(t, att.get(t) - ma); def.set(t, def.get(t) - md); }
    mu += ma - md;
    // μ 与主场优势 h
    let gs = 0, ex = 0, hgSum = 0, hex = 0;
    for (const r of rows) {
      const lh0 = Math.exp(h * r.home + r.e + att.get(r.h) - def.get(r.a));
      const la0 = Math.exp(-r.e + att.get(r.a) - def.get(r.h));
      gs += r.w * (r.hg + r.ag); ex += r.w * (lh0 + la0);
      if (r.home) { hgSum += r.w * r.hg; hex += r.w * Math.exp(mu + r.e + att.get(r.h) - def.get(r.a)); }
    }
    mu = Math.log(gs / ex);
    if (hex > 0) h = Math.log(hgSum / hex);
  }
  const model = { mu, h, att, def, rho: 0, cfg, day };
  model.rho = fitRho(rows, model);
  return model;
}

function mean(map) { let s = 0; for (const v of map.values()) s += v; return map.size ? s / map.size : 0; }

function tau(x, y, l, m, rho) {
  if (x === 0 && y === 0) return 1 - l * m * rho;
  if (x === 0 && y === 1) return 1 + l * rho;
  if (x === 1 && y === 0) return 1 + m * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function fitRho(rows, model) {
  let best = 0, bestLL = -Infinity;
  for (let rho = -0.25; rho <= 0.101; rho += 0.01) {
    let ll = 0;
    for (const r of rows) {
      if (r.hg > 1 || r.ag > 1) continue;
      const [l, m] = rates(model, r.h, r.a, !r.home, r.e);
      const t = tau(r.hg, r.ag, l, m, rho);
      if (t <= 0) { ll = -Infinity; break; }
      ll += r.w * Math.log(t);
    }
    if (ll > bestLL) { bestLL = ll; best = Math.round(rho * 100) / 100; }
  }
  return best;
}

/** 期望进球 [λ_home, λ_away]。未出现过的球队按平均水平（att=def=0）。 */
function rates(model, home, away, neutral, e = 0) {
  const ah = model.att.get(home) || 0, aa = model.att.get(away) || 0;
  const dh = model.def.get(home) || 0, da = model.def.get(away) || 0;
  const l = Math.exp(model.mu + (neutral ? 0 : model.h) + e + ah - da);
  const m = Math.exp(model.mu - e + aa - dh);
  return [l, m];
}

function poissonPMF(lambda, n) {
  const p = new Array(n + 1);
  p[0] = Math.exp(-lambda);
  for (let i = 1; i <= n; i++) p[i] = p[i - 1] * lambda / i;
  return p;
}

/** 比分概率矩阵 P[x][y]（已含 τ 修正并归一化）。 */
function scoreMatrix(l, m, rho, maxGoals = DEFAULTS.maxGoals) {
  const px = poissonPMF(l, maxGoals), py = poissonPMF(m, maxGoals);
  const P = [];
  let s = 0;
  for (let x = 0; x <= maxGoals; x++) {
    P.push([]);
    for (let y = 0; y <= maxGoals; y++) {
      const v = Math.max(0, tau(x, y, l, m, rho)) * px[x] * py[y];
      P[x].push(v); s += v;
    }
  }
  for (const row of P) for (let y = 0; y < row.length; y++) row[y] /= s;
  return P;
}

function outcome(P) {
  let pH = 0, pD = 0, pA = 0;
  for (let x = 0; x < P.length; x++) for (let y = 0; y < P[x].length; y++) {
    if (x > y) pH += P[x][y]; else if (x === y) pD += P[x][y]; else pA += P[x][y];
  }
  return { pH, pD, pA };
}

/** 单场预测：返回 λ、比分矩阵与胜平负概率。eloDiff = 主队赛前 Elo − 客队（含不含主场均可，β 项只看差值）。 */
function predict(model, home, away, { neutral = true, eloDiff = 0 } = {}) {
  const e = model.cfg.eloBeta ? model.cfg.eloBeta * eloDiff / 800 : 0;
  const [l, m] = rates(model, home, away, neutral, e);
  const P = scoreMatrix(l, m, model.rho, model.cfg.maxGoals);
  return { lambdaHome: l, lambdaAway: m, matrix: P, ...outcome(P) };
}

module.exports = { DEFAULTS, fit, predict, rates, scoreMatrix, outcome, tau, poissonPMF };
