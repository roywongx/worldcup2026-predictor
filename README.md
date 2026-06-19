# 🏆 2026 FIFA World Cup Predictor

**Dixon-Coles Poisson 模型 + 等保回归校准 + GBDT 集成 + Polymarket 三 API 整合**

[English](#english) · [中文](#中文)

---

## 中文

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                    数据层 (Data Layer)                        │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Elo 评分      │ WCQ xG       │ 俱乐部 xG    │ Polymarket     │
│ worldfootball │ FootyStats   │ Understat    │ gamma/clob/data│
│ rankings.com  │ (Exa搜索)    │ (Playwright) │ (API直连)      │
│ 48/48队       │ 43/48队      │ 119队×3赛季  │ 赛果+赔率+交易量│
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       │              │              │                │
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                  特征工程 (Feature Engineering)               │
├─────────────────────────────────────────────────────────────┤
│ Elo → eloMod (0.3 + 1.4 × expectedWin)                     │
│ ATK/DEF → atkMod ((myATK/oppDEF)^0.35)                      │
│ 动态大洲修正 → AFC/CAF头部ATK向1.0靠拢                        │
│ 交易量情绪 → volumeFactor 调整 market blend 权重               │
│ Polymarket blend → 时间衰减 20%→50%, 含平局概率               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  预测层 (Prediction Layer)                    │
├──────────────────────┬──────────────────────────────────────┤
│ Dixon-Coles 模型 (80%)│ GBDT 辅助模型 (20%)                  │
│ • Poisson 比分网格     │ • 15棵决策树, lr=0.08               │
│ • rho 修正 (-0.15/-0.12)│ • 特征: Elo差/ATK差/DEF差/状态     │
│ • 温度/等保校准        │ • ≥15场历史数据时激活                │
└──────────┬───────────┴──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                  校准层 (Calibration Layer)                   │
├─────────────────────────────────────────────────────────────┤
│ 等保回归 (PAVA) — 从历史预测+结果学习校准曲线                   │
│ 优先于温度缩放, 无数据时回退 T=1.15                            │
│ Log Loss + Brier Score 回测评估                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  输出层 (Output Layer)                        │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ 单场胜/平/负  │ 淘汰赛晋级率  │ 冠军概率      │ EV 分析        │
│ Dixon-Coles   │ 三段式       │ Monte Carlo   │ 模型 vs 市场   │
│ +GBDT+校准    │ 90min+ET+PK │ 10,000次      │ 正期望高亮     │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

### 数据源

| 数据 | 来源 | 覆盖 | 获取方式 |
|------|------|------|---------|
| Elo 评分 | worldfootballrankings.com | 48/48 队 | WebFetch |
| WCQ 预选赛 xG | FootyStats.com | 43/48 队 | Exa 搜索 |
| 俱乐部 xG | Understat | 五大联赛 3 赛季 119 队 | Playwright 抓取 |
| 赛果 + 比分 | Polymarket gamma-api | 自动同步 | API 直连 |
| 赛前赔率 | Polymarket gamma-api + clob-api | 65 场 | gamma 实时 + clob 价格历史 |
| 交易量 | Polymarket gamma-api | 每场交易额 | API 直连 |

### Polymarket 赔率处理策略

```
┌─────────────────────────────────────────────────────────────┐
│              Polymarket 赔率生命周期                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  赛前同步 ──→ gamma-api 获取当前赔率                         │
│     │        (active=true, closed=false)                    │
│     ▼                                                       │
│  价格验证 ──→ 过滤占位符 (0.9995/0.0005)                     │
│     │        过滤赛中赔率 (开球后 0-4h)                       │
│     ▼                                                       │
│  已结算比赛 ─→ 从 clob-api prices-history 获取赛前最后一刻赔率 │
│     │        以 gameStartTime 为截止点                       │
│     ▼                                                       │
│  合并存储 ──→ 新数据与已有数据 merge（不覆盖已冻结的赛前赔率）  │
│     │                                                       │
│     ▼                                                       │
│  预测冻结 ──→ 开赛后预测不再变化，使用赛前最后一刻赔率          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 平局预测策略

传统 "最高概率即结果" 方法会导致零平局（即使平局概率 27% 也从未被选中）。采用两项改进：

1. **概率加权 W/D/L** — 积分榜显示 `W += pWin, D += pDraw, L += pLoss`（小数），真实反映概率分布
2. **5% 阈值判定** — 当平局概率与最高概率差距 < 5% 时判定为平局（如 Brazil vs Morocco: W=33.4% D=32.7%）

### 模型参数

| 参数 | 值 | 来源 |
|------|-----|------|
| 基础 λ | 1.15 | FIFA 国际比赛统计 |
| Elo 标尺 | 400 | 标准 Elo |
| 攻防阻尼 | 0.35 | 调参（降低攻防影响力） |
| ρ 小组赛 | -0.15 | Dixon & Cole 1997 + 评估建议 |
| ρ 淘汰赛 | -0.12 | 同上 |
| 温度 T | 1.15 | Guo et al. 2017（等保回归无数据时回退） |
| Polymarket blend | 20%→50% | 时间衰减 + 交易量情绪调整 |
| ET 保守系数 γ | 0.70±0.05 | 历史世界杯数据 |
| PK 截断 | [0.40, 0.60] | 经验值 |
| GBDT blend | 20% | 梯度提升辅助模型 |

### 五项前沿改进（基于 2021-2026 研究报告）

1. **等保回归校准 (PAVA)** — 替代温度缩放，用历史预测+结果训练单调映射函数
2. **Log Loss + Brier Score 回测** — 金标准评估指标，替代 RPS
3. **Polymarket 交易量情绪** — 高交易量→市场更自信→增加 blend 权重
4. **EV 分析面板** — 模型概率 vs 市场赔率，高亮正期望投注
5. **GBDT 辅助模型** — 15 棵决策树，梯度提升，80% DC + 20% GBDT

### 赔率与预测策略改进

6. **CLOB 价格历史** — 已结算比赛从 clob-api 获取赛前最后一刻赔率，解决赛后赔率被结算价格覆盖的问题
7. **赛前赔率冻结** — 开赛后预测自动冻结，合并存储策略防止赔率丢失
8. **概率加权积分榜** — W/D/L 显示概率加权小数，真实反映不确定性
9. **平局阈值判定** — 5% 阈值解决 Poisson 模型中平局概率从未成为最高概率的数学特性

### 已知修复记录

#### Fix: Isotonic Calibration 退化导致所有比赛概率趋同

**问题**：`reevaluateResults()` 在页面初始化时被调用，内部 `fitAndCacheCalibration()` 会拟合等保回归校准表。当 localStorage 中积累了大量 Polymarket 同步数据后，PAVA 算法因输入 probs 分布过于集中而退化——所有 win/draw/loss bin 被合并为 1-2 个极端值（calP=0 或 calP=1），导致 `calibrateProbs()` 将所有比赛概率映射为 W80%/D20%/L0% 或类似极端值。

**根因**：`fitIsotonicCalibration()` 对退化数据缺少防护，`calibrateProbs()` 对退化校准结果缺少检测。

**修复**：在 `calibrateProbs()` 中增加双重安全检查：
1. 校准表每类别至少需要 3 个 bin，否则丢弃校准
2. 校准后任一概率 >95% 或 <5% 时丢弃校准，回退原始概率
3. 丢弃时自动将 `isotonicCalibration` 置 null，防止后续重复触发

**验证**：25 条模拟 Polymarket 同步数据注入后，修复前仅 5 种概率模式且极端值遍布全场；修复后 42 种概率模式，分布正常。

### 运行

```bash
python3 server.py
# 打开 http://localhost:9090
```

### 操作说明

- **🔄 Sync Polymarket** — 一键同步赛果 + 赔率 + 重新评估
- **🔁 Re-evaluate** — 用最新模型参数重算所有比赛（不联网）
- **EV 分析** — Radar 标签页显示正期望投注机会
- **回测** — Model 标签页显示 Log Loss、Brier Score、准确率

### 全面检查清单（供下一位 AI 参考）

以下为已知需要验证的模块和潜在风险点：

| 模块 | 检查项 | 风险等级 |
|------|--------|----------|
| `calibrateProbs()` | 退化校准表防护是否完备（已修） | 🟢 已修 |
| `queryWhatIf()` | 平局过滤逻辑错误（已修） | 🟢 已修 |
| `runSimulation` rankings sort | ExpPts→Pts 排序统一（已修） | 🟢 已修 |
| `buildKOBracket` thirdPlaceGroups | 原地 sort 污染参数（已修） | 🟢 已修 |
| `reevaluateResults()` | 被加入 init 序列，每次页面加载都触发，可能反复拟合校准表 | 🟡 待审 |
| `matchProbs()` → `getFormAdjustedLambdas()` | Polymarket blend 在极端赔率下可能过度推高 lambda | 🟡 中 |
| `simulateOneTournament()` | Monte Carlo 循环 10000 次，每次调用 `matchProbs`×72，性能瓶颈 | 🟡 中 |
| `fetchPolymarketResults()` | gamma-api 返回格式可能变化（outcomePrices JSON 解析） | 🟡 中 |
| `fitIsotonicCalibration()` | PAVA 算法对小样本（<20）直接返回 null，但 20-50 条时仍可能退化 | 🟡 中 |
| `getCalibrationStats()` | 使用 `preFormMap` 而非动态 form，可能低估模型实际表现 | 🟡 低 |
| `addResult()` / `importResults()` | 手动录入后不触发 `reevaluateResults()`，数据可能不同步 | 🟡 低 |
| `dynamicElo` 全局状态 | 同步函数已统一用 `withPreTournamentElo`（try/finally 异常安全）；async 函数（MC/Polymarket）保留手动 save/restore | 🟢 已修 |
| `simulationHistory` 内存 | 10k 次模拟移除 `rounds` 存储（节省 ~50MB） | 🟢 已修 |
| `_proxy_match_odds` 配额 | 加 sport key 缓存，避免重复 404 浪费配额 | 🟢 已修 |
| localStorage 版本兼容 | `dataVersion` 从旧版升级时可能触发种子数据重复写入 | 🟢 低 |
| Edge 兼容性 | 用户报告 Edge 不显示概率，可能与 CSS 或 JS 执行环境有关 | 🔴 待查 |

---

## English

### Architecture

Dixon-Coles Poisson model + Isotonic Regression Calibration + GBDT Ensemble + Polymarket 3 API Integration

### Data Sources

| Data | Source | Coverage | Method |
|------|--------|----------|--------|
| Elo ratings | worldfootballrankings.com | 48/48 teams | WebFetch |
| WCQ qualifying xG | FootyStats.com | 43/48 teams | Exa search |
| Club xG | Understat | Top 5 leagues, 3 seasons, 119 teams | Playwright |
| Match results | Polymarket gamma-api | Auto-sync | API |
| Pre-match odds | Polymarket gamma-api + clob-api | 65 matches | gamma live + clob price history |
| Trading volume | Polymarket gamma-api | Per-match | API |

### Polymarket Odds Lifecycle

```
Pre-match sync  →  Fetch current odds from gamma-api (active=true, closed=false)
       │
       ▼
Price validation →  Filter placeholders (0.9995/0.0005)
       │          Filter in-play odds (0-4h after kickoff)
       ▼
Resolved matches →  Fetch last pre-match price from clob-api prices-history
       │           Cutoff at gameStartTime
       ▼
Merge storage    →  New data merges with existing (never overwrite frozen odds)
       │
       ▼
Frozen prediction →  After kickoff, prediction stays fixed at last pre-match odds
```

### Draw Prediction Strategy

Traditional "highest probability wins" produces zero draws (even with ~27% draw probability). Two fixes:

1. **Probability-weighted W/D/L** — Standings show `W += pWin, D += pDraw, L += pLoss` (decimals), reflecting true probability distribution
2. **5% threshold** — Draw predicted when draw probability is within 5% of the highest (e.g., Brazil vs Morocco: W=33.4% D=32.7%)

### Five Frontier Improvements (2021-2026 Research)

1. **Isotonic Regression (PAVA)** — replaces temperature scaling with data-driven calibration
2. **Log Loss + Brier Score** — gold standard evaluation metrics
3. **Polymarket Volume Sentiment** — high volume → market more confident → increase blend weight
4. **EV Analysis Panel** — model probability vs market odds, highlight positive expected value
5. **GBDT Auxiliary Model** — 15 decision trees, gradient boosting, 80% DC + 20% GBDT

### Odds & Prediction Strategy Improvements

6. **CLOB Price History** — Resolved matches fetch last pre-match odds from clob-api prices-history, solving the problem of post-match settlement overwriting pre-match odds
7. **Pre-match Odds Freeze** — Predictions freeze after kickoff; merge storage prevents odds loss
8. **Probability-weighted Standings** — W/D/L shows weighted decimals, reflecting true uncertainty
9. **Draw Threshold** — 5% threshold solves the Poisson model property where draw probability is never the single highest

### Fix: Isotonic Calibration Degeneracy

**Bug**: When `reevaluateResults()` is called during init, `fitAndCacheCalibration()` fits isotonic regression on stored results. With accumulated Polymarket sync data where probs are concentrated (same model produces similar outputs), PAVA merges all bins into 1-2 degenerate values (calP=0 or calP=1), causing `calibrateProbs()` to map ALL match probabilities to extreme values like W80%/D20%/L0%.

**Fix**: Added dual safety checks in `calibrateProbs()`:
1. Require at least 3 bins per category; discard calibration if fewer
2. Discard calibration if any output prob >95% or <5%, falling back to raw probs
3. Sets `isotonicCalibration = null` on discard to prevent repeated triggering

### Full Audit Checklist (for next AI)

| Module | Check Item | Risk |
|--------|-----------|------|
| `calibrateProbs()` | Degenerate calibration guard (fixed) | 🟢 Fixed |
| `reevaluateResults()` | Added to init sequence — runs on every page load | 🟡 Review |
| `matchProbs()` → Polymarket blend | Extreme odds may over-blend lambda | 🟡 Medium |
| `simulateOneTournament()` | 10k MC loops × 72 `matchProbs` calls — perf bottleneck | 🟡 Medium |
| `fetchPolymarketResults()` | gamma-api format may change | 🟡 Medium |
| `fitIsotonicCalibration()` | PAVA degeneracy with 20-50 samples | 🟡 Medium |
| `dynamicElo` global state | Sync functions use `withPreTournamentElo` (try/finally); async keep manual save/restore | 🟢 Fixed |
| `simulationHistory` memory | Removed `rounds` from 10k stored sims (~50MB saved) | 🟢 Fixed |
| `_proxy_match_odds` quota | Added sport key cache to avoid repeat 404 calls | 🟢 Fixed |
| Edge browser compat | User reports predictions not displayed | 🔴 Investigate |

### Run

```bash
python3 server.py
# Open http://localhost:9090
```

---

## License

MIT
