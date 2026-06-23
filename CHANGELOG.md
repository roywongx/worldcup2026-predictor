# Changelog

## 2026-06-22 — Major Bugfix & Refactor Sprint

### 🔴 Critical Fixes

#### Probability Pipeline (W:50% D:0% L:50% → correct distributions)
- **Removed broken isotonic calibration** from `getBlendedProbs()` pipeline. The calibration was fitted on already-calibrated stored probabilities (double-calibration), producing degenerate lookup tables where `loss.calP=0` for most bins, collapsing all loss probabilities to 0%.
- Pipeline is now: **DC → GBDT blend (20%) → temperature scaling (T=1.15)** — clean, stable, no degenerate edge cases.
- Calibration infrastructure kept for future use when enough data accumulates.

#### GBDT Double-Blending (effective weight 36% → 20%)
- Removed inline GBDT mixing from `matchProbs()` in `dixon-coles.js`.
- All callers now use `getBlendedProbs()` for single-pass DC+GBDT blending.

#### Knockout PSO Results (home team always won → uses actual winner)
- `monte-carlo.js`: Uses `actual.winner` field from football-data.org's `score.winner` for penalty shootout results.
- `mc-worker.js`: matchResults now includes `winner` field, compatible with main thread.
- `index.html`: `runKORound()` bracket display also uses `actual.winner`.

#### Worker savedElo Never Restored (static Elo every simulation → dynamic Elo)
- `mc-worker.js`: `Object.assign(dynamicElo, savedElo)` now called before each simulation iteration.

#### GBDT Threshold Bias (lowest 10 only → uniform sampling)
- `gbdt.js` `_fitStump()`: Uniformly samples 10 thresholds across full range instead of always taking the lowest 10.

### 🟠 High-Priority Fixes

#### Elo K-Factor (96-141 → 30-45)
- Changed from multiplicative (`K=60 × importance=1.6-1.76`) to additive (`K=30 base + 15 KO bonus`).
- Effective K: 30 (group) / 45 (knockout). Matches eloratings.net methodology.

#### Group Ranking — FIFA H2H Tiebreakers
- Implemented recursive H2H tiebreaker: H2H pts → H2H GD → H2H GF → overall GD → overall GF.
- Correctly handles 2/3/4-way ties among all tied teams.

#### install.sh — SHA256 Integrity Verification
- Downloads `SHA256SUMS` and verifies all files after download.
- Aborts with clear error on any mismatch.

#### API Response Caching
- `/api/results`: 5 min cache
- `/api/odds`: 30 min cache
- Reduces football-data.org and the-odds-api quota consumption.

### 🟡 Medium-Priority Fixes

#### Cross-Verification of Match Results
- `fetchResults()` now fetches from both football-data.org and openfootball (GitHub).
- Verified results marked `verified`, mismatches flagged and auto-corrected.

#### Dynamic Form Consistency
- `getForm()` no longer depends on `currentResults` global. Uses `WC26._dynamicFormMap` instead (Worker-safe).

#### calculateHedge Math
- Now solves linear system of equations for 3-outcome hedging (was independently calculating each hedge).

#### poissonPMF Accuracy
- Uses Stirling approximation for k>15 (was incorrectly using 15! as fallback).

#### Poisson Sampling (3-tier)
- λ<10: Knuth / 10≤λ<30: Atkinson rejection / λ≥30: Normal approximation.

#### Temperature Scaling EPS
- Reduced from 0.015 to 0.001 (was inflating draw probability 18x for extreme mismatches).

### 🔵 Architecture Improvements

#### globalThis.WC26 Namespace
- All 7 module files use `globalThis.WC26` instead of `window.WC26`.
- Works in browser, Web Worker, and Node.js without shims.

#### Unified CONFIG Object
- All tuning constants (RHO_*, ELO_K_*, NB_R, HOME_HOST, etc.) consolidated into `WC26.CONFIG`.
- Backward-compatible getter/setter aliases for existing code.

#### Auto-Hash Service Worker Cache
- `build-cache-hash.sh` computes md5 of all assets, injects hash into `sw.js` CACHE constant.
- No more manual version bumping.

#### Magic Numbers Extracted
- 9 magic numbers from `dixon-coles.js` moved to `WC26.CONFIG` (BASE_LAMBDA, KNOCKOUT_FACTOR, ATKDEF_DAMPING, etc.).

#### Box-Muller Optimization
- `randn()` caches second sample, reducing ~50% Math.random() calls.

#### Isotonic Calibration Lookup
- Reverted from binary search + interpolation back to safe step function (interpolation was extrapolating to negative probabilities).

### Files Changed
- `index.html` — Probability display, PSO bracket, globalThis, CONFIG refs
- `server.py` — API caching, openfootball proxy, threading lock
- `model/dixon-coles.js` — Pure DC matchProbs, Elo K, CONFIG refs, hedge math
- `model/gbdt.js` — getBlendedProbs pipeline, GBDT threshold sampling
- `model/elo.js` — Additive K-factor design
- `model/monte-carlo.js` — H2H tiebreakers, PSO winner, bracket error
- `model/stats.js` — Poisson sampling, EPS, calibration fixes
- `data/teams.js` — CONFIG object, UEFA dedup, Elo constants
- `mc-worker.js` — savedElo restore, winner field, globalThis
- `sw.js` — Network-first for index.html
- `install.sh` — SHA256 verification
- `build-cache-hash.sh` — Auto-hash + SHA256SUMS generation
- `SHA256SUMS` — New file for integrity verification
- `CHANGELOG.md` — This file
