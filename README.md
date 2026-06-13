# 🏆 2026 FIFA World Cup Predictor

[English](#english) | [中文](#中文)

---

## English

### What is this?

A single-file HTML application that predicts the 2026 FIFA World Cup using the **Dixon-Coles bivariate Poisson model** (1997) — the academic gold standard for football match prediction. Features the complete **FIFA Annex C 495-combination bracket matrix** for accurate knockout stage simulation.

**Key differentiator**: Predictions are fully dynamic — actual match results update team Elo ratings and form in real-time, which directly influence all future match predictions and Monte Carlo simulations.

### Quick Start

```bash
# Clone and run (requires Python 3)
git clone https://github.com/roywongx/worldcup2026-predictor.git
cd worldcup2026-predictor
python3 server.py 9090

# Open in browser
# Local:   http://localhost:9090
# Network: http://<your-ip>:9090
```

Or download `index.html` and open directly in Chrome (some features require the proxy server).

### API Keys (Free, 2 minutes)

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **football-data.org** | Match results | 10 req/min | [Register](https://www.football-data.org/client/register) |
| **The-Odds-API** | Betting odds | 500 req/month | [Register](https://the-odds-api.com/) |

Both keys are entered in the **Data** tab. Use the **🔍 Test** button to verify your key works before fetching.

### How It Works

```
Actual Match Results ──→ Dynamic Elo Update (K=60)
                              ↓
                     Form Calculation (exp decay λ=0.15 + pre-tournament blend)
                              ↓
              getEffectiveElo() + getFormAdjustedLambdas()
                              ↓
         λ_home = BASE/2 + ΔElo/800 + Host + Form_adj
         λ_away = BASE/2 - ΔElo/800 + Form_adj
                              ↓
    Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
                              ↓                         ↑ ρ = -0.12 correction
    Monte Carlo 10,000 sims ──→ FIFA Annex C 495 bracket matrix
                              ↓
    Champion / Final / Semi / Quarter / R16 probabilities
```

### Model Details

**Core Model — Dixon-Coles (1997)**
- Bivariate Poisson with low-score correlation correction (ρ = -0.12)
- Fixes independent Poisson's systematic under-prediction of 0-0 and 1-1 draws
- Academic reference: Dixon, M.J. & Coles, S.G. (1997). *JRSS-C*, 46(2): 265-280

**Dynamic Elo System**
- 400 Elo points ≈ 1 goal supremacy (industry standard)
- K=60 (World Cup weight), goal-difference multiplier G=(11+N)/8 for N≥3
- Updates after each match via `updateElo(team1, team2, score1, score2)`
- Stored in `dynamicElo{}` object, persists across sessions

**Form-Adjusted Goal Expectancy**
- `getFormAdjustedLambdas(home, away)` combines Elo + form
- Form = exponential decay weighted results: `weight = exp(-0.15 × days_ago)` (tournament-tuned)
- Pre-tournament form blended with WC results: 1 match = 70% pre / 30% WC, converging to WC form by 3+ matches
- Adjustment range: ±15% of base lambda (form 0.5 = neutral)
- Recent matches weighted more heavily

**Knockout Bracket — FIFA Annex C**
- Complete 495-combination matrix parsed from FIFA Regulations
- R32 structure: 8 winner-vs-third + 4 winner-vs-runner-up + 4 runner-up-vs-runner-up
- No same-group matchups in R32 (FIFA rule)
- Third-place qualification: sorted by points → GD → GF → fair play

**Home Advantage**
- Host nations (Mexico/USA/Canada): +0.30 expected goals
- Neutral venues: no adjustment

**Proper Scoring Rules**
- **RPS** (Ranked Probability Score): the football standard for 3-outcome predictions
- **Brier Score**: mean squared error of probability vectors
- **Log Loss**: penalizes confident wrong predictions
- **ECE** (Expected Calibration Error): measures probability calibration

### Data Flow

```
1. User clicks "Fetch Results" → football-data.org API
2. Results stored in localStorage (persisted)
3. Dynamic Elo recalculated: updateElo() for each match
4. Dynamic Form recalculated: calculateDynamicForm()
5. runSimulation() uses getEffectiveElo() + getFormAdjustedLambdas()
6. Monte Carlo uses same dynamic functions
7. Predictions automatically reflect all actual results
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `getEffectiveElo(team)` | Returns dynamic Elo if available, else static |
| `getForm(team, formMap?)` | Dynamic form with optional explicit map |
| `getFormAdjustedLambdas(home, away, formMap?)` | Elo-based lambda + form adjustment |
| `matchProbs(home, away)` | Dixon-Coles win/draw/loss probabilities |
| `simMatch(home, away, formMap?)` | Poisson match simulation |
| `simKO(home, away, formMap?)` | Knockout simulation with ET/PSO |
| `calculateDynamicForm(results)` | Time-weighted form from recent results |
| `updateElo(team1, team2, s1, s2)` | Dynamic Elo update after match |
| `buildKOBracket(rankings, bestThirds, thirdPlaceGroups)` | FIFA Annex C bracket construction |
| `runMonteCarlo(actualMap, N, formMap?)` | N tournament simulations |

### Audit Log

**2026-06-13: Prediction accuracy optimization pass**

Bugs found and fixed:

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | 🔴 Critical | Third Place match used QF losers instead of SF losers — `losers = qfr.map(...)` iterated 4 QF matches, producing wrong teams | Changed to `sfLosers = sfr.map(m => m.ga > m.gb ? m.b : m.a)` — correctly identifies 2 semi-final losers |
| 2 | 🔴 Critical | `simKO` calls inside `runKORound` omitted `formMap` — knockout predictions used stale/null global form data | Added `formMap` parameter to all `simKO` calls in `runKORound`, Third Place, and Final |
| 3 | 🟡 Medium | Extra time expected goals factor 0.55 overestimated by 65% — ET is 30/90 min = 0.33, causing too few penalty shootouts | Changed from `lh * 0.55` to `lh * 0.33` (proportional to 30-minute duration) |
| 4 | 🟡 Medium | Penalty shootout model near coin-flip — Elo advantage capped at ±0.15 with divisor 2000 (400 Elo diff = only ±0.046) | Widened to ±0.25 with divisor 800, matching historical ~60-65% strong team PSO win rate |
| 5 | 🟡 Medium | Form decay λ=0.05 too slow for 14-day tournament window; 1 WC match completely overrode pre-tournament form | Increased λ to 0.15 (tournament-tuned); added pre-tournament form blending: `wcWeight = 1 - 0.7^n` |

**2026-06-14: Deep audit and comprehensive fix**

Bugs found and fixed:

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | 🔴 Critical | `getForm()` depended on `currentResults` which is `null` during Monte Carlo — form adjustments silently失效 | Added optional `formMap` parameter threaded through `simMatch` → `simKO` → `simulateOneTournament` → `runMonteCarlo` |
| 2 | 🔴 Critical | `getCalibrationStats` used post-match Elo to evaluate pre-match predictions — calibration scores虚高 | Now uses stored `r.probs` when available, falls back to recalculation only when stored probs missing |
| 3 | 🔴 Critical | Bracket runner-up pairings had same-group conflicts when matrix assigned third-place teams from those groups | Rewrote `buildKOBracket` with dynamic tracking of used groups, greedy cross-group assignment |
| 4 | 🟡 Medium | ECE calculation checked probability proximity instead of predicted-vs-actual class match | Rewrote to bin by confidence, measure accuracy within each bin |
| 5 | 🟡 Medium | Most-likely score calculation omitted Dixon-Coles τ correction — 0-0 and 1-1 underrepresented | Added `dixonColesTau()` to the score grid search |
| 6 | 🟡 Medium | `composite()` host bonus added on top of weights summing to 1.0 — could exceed 1.0 | Host bonus folded into base weights (sum ≤ 1.0) |
| 7 | 🟡 Medium | Form calculation used arbitrary 0.4 for draws | Changed to standard 0.33 (1/3 of available points) |
| 8 | 🟢 Low | `poissonSample` upper bound 15 could truncate extreme lambdas | Increased to 20 |
| 9 | 🟢 Low | `buildActualResultsMap` cache used reference equality (never matched) | Changed to length-based cache invalidation |

Design decisions documented:
- `dynamicElo` is intentionally NOT reset during Monte Carlo — all 10k sims share the same Elo state derived from actual results
- `formMap` is computed once before Monte Carlo and passed through, avoiding per-sim recalculation
- Bracket uses greedy cross-group assignment rather than hardcoded pairings, validated against FIFA's no-same-group rule

### Features

- **Dixon-Coles Poisson engine** with pre-computed factorial table
- **FIFA Annex C 495 bracket matrix** (compressed 11KB)
- **Monte Carlo 10,000** full tournament simulations
- **Dynamic predictions**: Elo + Form update from actual results
- **Prediction comparison**: shows predicted vs actual for each completed match
- **Accuracy dashboard**: RPS, Brier, ECE, win/draw/loss accuracy
- **Dynamic Elo**: K=60, goal-difference multiplier, updates after each match
- **Form momentum**: tournament-tuned exponential decay (λ=0.15), pre-tournament form blended for stability
- **Live data**: proxy server bypasses CORS for football-data.org and the-odds-api.com
- **Polymarket radar**: real-money prediction market comparison
- **Bilingual**: full Chinese/English toggle with technical terms preserved
- **localStorage persistence**: all data survives page refreshes
- **Calibration tracking**: model accuracy improves as results accumulate

### Tech Stack

- Pure HTML/CSS/JavaScript (zero dependencies)
- Python proxy server (`server.py`) for API CORS bypass
- Dixon-Coles Poisson engine with 495-entry bracket matrix
- localStorage for data persistence

### Academic References

- Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280
- Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco
- Karlis, D. & Ntzoufras, I. (2003). "Analysis of Sports Data by Using Bivariate Poisson Models." *JRSS-D*, 52(3): 381-393
- Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*
- FIFA. *Regulations for the FIFA World Cup 26*, Annex C

---

## 中文

### 这是什么？

一个**单文件 HTML 应用**，使用 **Dixon-Coles 双变量 Poisson 模型**（1997）预测 2026 FIFA 世界杯。内置完整的 **FIFA Annex C 495 种组合对阵矩阵**，精确模拟淘汰赛阶段。

**核心特点**：预测完全动态——实际比赛结果实时更新球队 Elo 评分和状态，直接影响所有未来比赛预测和蒙特卡洛模拟。

### 快速开始

```bash
# 克隆并运行（需要 Python 3）
git clone https://github.com/roywongx/worldcup2026-predictor.git
cd worldcup2026-predictor
python3 server.py 9090

# 浏览器打开
# 本机:   http://localhost:9090
# 局域网: http://<你的IP>:9090
```

或直接下载 `index.html` 用 Chrome 打开（部分功能需要代理服务器）。

### API Key 设置（免费）

| 服务 | 用途 | 免费额度 | 注册 |
|------|------|----------|------|
| **football-data.org** | 比赛结果 | 10 次/分钟 | [注册](https://www.football-data.org/client/register) |
| **The-Odds-API** | 博彩赔率 | 500 次/月 | [注册](https://the-odds-api.com/) |

在 **数据** 标签页输入 API Key，点击 **🔍 Test** 验证后再获取数据。

### 工作原理

```
实际比赛结果 ──→ 动态 Elo 更新 (K=60)
                      ↓
                状态计算 (指数衰减 λ=0.15 + 赛前状态混合)
                      ↓
          getEffectiveElo() + getFormAdjustedLambdas()
                      ↓
     λ_主 = BASE/2 + ΔElo/800 + 东道主 + 状态调整
     λ_客 = BASE/2 - ΔElo/800 + 状态调整
                      ↓
Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
                      ↓                              ↑ ρ = -0.12 修正
蒙特卡洛 10,000 次 ──→ FIFA Annex C 495 组合对阵矩阵
                      ↓
冠军 / 决赛 / 四强 / 八强 / 十六强 概率
```

### 模型详情

**核心模型 — Dixon-Coles (1997)**
- 双变量 Poisson + 低比分相关修正（ρ = -0.12）
- 修复独立 Poisson 对 0-0 和 1-1 平局的系统性低估
- 学术来源：Dixon, M.J. & Coles, S.G. (1997). *JRSS-C*, 46(2): 265-280

**动态 Elo 系统**
- 400 Elo 分 ≈ 1 进球优势（行业标准）
- K=60（世界杯权重），进球差乘数 G=(11+N)/8（N≥3）
- 每场比赛后通过 `updateElo()` 更新
- 存储在 `dynamicElo{}` 对象中，跨会话持久化

**状态调整的期望进球**
- `getFormAdjustedLambdas(home, away)` 组合 Elo + 状态
- 状态 = 指数衰减加权结果：`weight = exp(-0.15 × days_ago)`（赛会制调优）
- 赛前状态与 WC 结果混合：1 场 = 70% 赛前 / 30% WC，3+ 场后 WC 状态主导
- 调整范围：基础 lambda 的 ±15%（状态 0.5 = 中性）
- 近期比赛权重更高

**淘汰赛对阵 — FIFA Annex C**
- 从 FIFA 官方规程解析完整 495 种组合矩阵
- 32 强结构：8 场冠军 vs 第三名 + 4 场冠军 vs 亚军 + 4 场亚军 vs 亚军
- 同组球队不在 32 强相遇（FIFA 规则）
- 第三名晋级：按积分 → 净胜球 → 进球数 → 公平竞赛排序

**东道主加成**
- 东道主（墨西哥/美国/加拿大）：+0.30 期望进球
- 中立场地：无调整

**评分规则**
- **RPS**（排序概率分数）：足球三结果预测的行业标准
- **Brier 分数**：概率向量的均方误差
- **对数损失**：惩罚自信的错误预测
- **ECE**（期望校准误差）：衡量概率校准质量

### 数据流

```
1. 用户点击"获取赛果" → football-data.org API
2. 结果存储在 localStorage（持久化）
3. 动态 Elo 重新计算：每场比赛 updateElo()
4. 动态状态重新计算：calculateDynamicForm()
5. runSimulation() 使用 getEffectiveElo() + getFormAdjustedLambdas()
6. 蒙特卡洛使用相同的动态函数
7. 预测自动反映所有实际结果
```

### 核心函数

| 函数 | 用途 |
|------|------|
| `getEffectiveElo(team)` | 返回动态 Elo（如有），否则静态 |
| `getForm(team, formMap?)` | 动态状态，可传入显式 map |
| `getFormAdjustedLambdas(home, away, formMap?)` | Elo 基础 lambda + 状态调整 |
| `matchProbs(home, away)` | Dixon-Coles 胜/平/负概率 |
| `simMatch(home, away, formMap?)` | Poisson 比赛模拟 |
| `simKO(home, away, formMap?)` | 淘汰赛模拟（含加时/点球）|
| `calculateDynamicForm(results)` | 近期结果的时间加权状态 |
| `updateElo(team1, team2, s1, s2)` | 比赛后动态 Elo 更新 |
| `buildKOBracket(rankings, bestThirds, thirdPlaceGroups)` | FIFA Annex C 对阵构建 |
| `runMonteCarlo(actualMap, N, formMap?)` | N 次锦标赛模拟 |

### 审计日志

**2026-06-13：预测精度优化**

发现并修复的 Bug：

| # | 严重性 | 问题 | 修复 |
|---|--------|------|------|
| 1 | 🔴 严重 | 三四名决赛用 QF 负者而非 SF 负者 — `losers = qfr.map(...)` 遍历 4 场八强赛，产生错误球队 | 改为 `sfLosers = sfr.map(m => m.ga > m.gb ? m.b : m.a)`，正确识别 2 支半决赛负者 |
| 2 | 🔴 严重 | `simKO` 调用遗漏 `formMap` — 淘汰赛预测使用过期/空的全局状态数据 | 在 `runKORound`、三四名决赛、决赛的所有 `simKO` 调用中传入 `formMap` |
| 3 | 🟡 中等 | 加时赛期望进球系数 0.55 高估 65% — 加时 30/90 分钟 = 0.33，导致点球触发率偏低 | 从 `lh * 0.55` 改为 `lh * 0.33`（等比例缩放） |
| 4 | 🟡 中等 | 点球模型接近抛硬币 — Elo 优势上限 ±0.15，除数 2000（400 Elo 差仅 ±0.046） | 扩大至 ±0.25，除数 800，符合历史强队 ~60-65% 点球胜率 |
| 5 | 🟡 中等 | 状态衰减 λ=0.05 在 14 天赛会窗口过慢；1 场 WC 比赛完全覆盖赛前状态 | λ 提高至 0.15（赛会制调优）；引入赛前状态混合：`wcWeight = 1 - 0.7^n` |

**2026-06-14：深度审计与全面修复**

发现并修复的 Bug：

| # | 严重性 | 问题 | 修复 |
|---|--------|------|------|
| 1 | 🔴 严重 | `getForm()` 依赖 `currentResults`，蒙特卡洛时为 `null` — 状态调整静默失效 | 添加可选 `formMap` 参数，贯穿 `simMatch` → `simKO` → `simulateOneTournament` → `runMonteCarlo` |
| 2 | 🔴 严重 | `getCalibrationStats` 用赛后 Elo 重算历史预测 — 校准指标虚高 | 改用存储的 `r.probs`，仅在缺失时重算 |
| 3 | 🔴 严重 | Bracket runner-up 配对与矩阵分配的第三名存在同组冲突 | 重写 `buildKOBracket`，动态追踪已用组，贪心跨组分配 |
| 4 | 🟡 中等 | ECE 计算检查概率接近度而非预测类别匹配 | 重写：按置信度分 bin，计算每 bin 内准确率 |
| 5 | 🟡 中等 | 最可能比分计算缺少 Dixon-Coles τ 修正 — 0-0 和 1-1 被低估 | 在比分网格搜索中加入 `dixonColesTau()` |
| 6 | 🟡 中等 | `composite()` host 加成叠加在权重和 1.0 之上 — 可能超 1.0 | host 加成融入基础权重（总和 ≤ 1.0） |
| 7 | 🟡 中等 | 状态计算平局用任意的 0.4 分 | 改为标准 0.33（可用积分的 1/3） |
| 8 | 🟢 低 | `poissonSample` 上限 15 可能截断极端 lambda | 提高到 20 |
| 9 | 🟢 低 | `buildActualResultsMap` 缓存用引用比较（永远不命中） | 改为基于数组长度的缓存失效 |

设计决策记录：
- `dynamicElo` 在蒙特卡洛期间故意不重置 — 所有 10k 次模拟共享同一份基于实际结果的 Elo 状态
- `formMap` 在蒙特卡洛前计算一次并传递，避免每次模拟重复计算
- Bracket 使用贪心跨组分配而非硬编码配对，通过 FIFA 同组规则验证

### 功能特性

- **Dixon-Coles Poisson 引擎** + 预计算阶乘表
- **FIFA Annex C 495 组合矩阵**（压缩 11KB）
- **蒙特卡洛 10,000 次**完整锦标赛模拟
- **动态预测**：Elo + 状态从实际结果更新
- **预测对比**：每场已完成比赛显示预测 vs 实际
- **准确度仪表板**：RPS、Brier、ECE、胜平负准确率
- **动态 Elo**：K=60，进球差乘数，每场比赛后更新
- **状态动量**：赛会制调优指数衰减（λ=0.15），赛前状态混合保障稳定性
- **实时数据**：代理服务器绕过 CORS，对接 football-data.org 和 the-odds-api.com
- **Polymarket 雷达**：真金白银预测市场价格对比
- **中英文切换**：完整翻译，技术术语保留英文
- **localStorage 持久化**：数据刷新不丢失
- **校准追踪**：随着结果积累，模型准确度持续提升

### 技术栈

- 纯 HTML/CSS/JavaScript（零依赖）
- Python 代理服务器（`server.py`）解决 API CORS
- Dixon-Coles Poisson 引擎 + 495 条目对阵矩阵
- localStorage 数据持久化

### 学术依据

- Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280
- Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco
- Karlis, D. & Ntzoufras, I. (2003). "Analysis of Sports Data by Using Bivariate Poisson Models." *JRSS-D*, 52(3): 381-393
- Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*
- FIFA. *Regulations for the FIFA World Cup 26*, Annex C

### License

MIT License
