# 🏆 2026 FIFA World Cup Predictor

**Dixon-Coles Poisson 模型 + 等保回归校准 + GBDT 集成 + Polymarket 数据整合**

English below · [中文](#中文)

---

## English

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Elo ratings  │ WCQ xG       │ Club xG      │ Polymarket     │
│ eloratings   │ FootyStats   │ Understat    │ gamma/clob API │
│ 48/48 teams  │ 43/48 teams  │ 119×3 seasons│ odds+results   │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                   Prediction Layer                           │
├──────────────────────┬──────────────────────────────────────┤
│ Dixon-Coles (80%)    │ GBDT Auxiliary (20%)                 │
│ • Poisson score grid │ • 15 trees, lr=0.08                 │
│ • ρ = -0.20/-0.15    │ • Features: Elo/ATK/DEF/form diff   │
│ • Isotonic calibrate │ • Activates with ≥15 historical     │
└──────────┬───────────┴──────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│                       Output Layer                           │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Match W/D/L  │ Knockout     │ Champion     │ EV Analysis    │
│ probabilities│ advancement  │ Monte Carlo  │ Model vs Market│
│              │ 90min+ET+PK  │ 10,000 sims  │ +EV highlight  │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

### Model Parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Base λ | 1.25 | Half of WC avg total goals (~2.5 per match) |
| Elo scale | 400 | Standard Elo |
| ATK/DEF damping | 0.35 | Tuned (reduces attack/defense impact) |
| ρ group stage | -0.20 | Dixon & Coles 1997, tuned for draw calibration |
| ρ knockout | -0.15 | Same |
| Temperature T | 1.15 | Guo et al. 2017 (fallback when no isotonic data) |
| Polymarket blend | 20%→50% | Time-decay + volume percentile sentiment |
| GBDT blend | 20% | Gradient boosting auxiliary |
| **NB overdispersion r** | **8.5** | **PELE 2026 (Negative Binomial replaces Poisson)** |
| **Match importance** | **1.60/1.76** | **PELE 2026 (Group/Knockout multiplier)** |
| **UEFA value correction** | **-30%** | **PELE 2026 (Transfermarkt European bias fix)** |

### Run

```bash
python3 server.py        # Start server on port 9090 (auto-launches compute-server.js)
# Open http://localhost:9090
```

### Recent Changes (2026-06-28)

**Bracket & Schedule:**
- FIFA R32 bracket — 16/16 matches verified correct against actual results
- R16 cross-pairing — Verified 8/8 correct against FIFA bracket
- Third-place assignment — Backtracking with FIFA Annex C constraints
- Beijing time — All knockout match times converted ET→UTC+8
- M83 fix — R(K) vs R(L) = Portugal vs Croatia (was incorrectly W(K))
- M88 fix — R(D) vs R(G) = Australia vs Egypt (was incorrectly 3rd(G))
- clear.html — Utility page to clear localStorage for data reset

**Predictions:**
- xG (expected goals) + W/D/L probabilities for all knockout matches
- Top-3 most probable scores with confidence percentages
- Deterministic Poisson sampling (seeded, same result per match)
- Extra time fatigue factor (ET_FATIGUE=0.85)
- Temperature auto-optimization via grid search (uses rawProbs, no double-calibration)
- MC workers receive optimalT from main process (consistent probabilities)

**Server:**
- Parallel Monte Carlo via worker_threads (up to 16 workers)
- Structured error responses with type/suggestion
- Rate limiting (20 req/10s window)
- Request logging with elapsed time and result size
- New API action `caldiag` for calibration diagnostics

**Bug Fixes:**
- EV Analysis knockout support — `runEV()` now iterates marketOdds for all unplayed matches (R32/R16/QF/SF/Final), not just group stage `MATCHES`
- Polymarket API field rename — `ev.eventDate` → `ev.startDate` (Polymarket removed `eventDate` field, odds sync was silently returning empty)

**Frontend cleanup:**
- Removed ~60 lines of dead stub functions
- All computation delegated to compute-server.js
- Fixed async race conditions (all operations properly awaited)

### Features

- **🔄 Sync Polymarket** — Fetch latest odds + results + re-evaluate
- **🔁 Re-evaluate** — Re-run model with current parameters (no network)
- **💰 EV Analysis** — Positive expected value opportunities
- **📊 Backtest** — Log Loss, Brier Score, accuracy on 2022 WC data
- **🔮 What-If** — Conditional Monte Carlo (lock match outcomes)
- **📈 Radar** — Model vs Polymarket real-money odds comparison

---

## 中文

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      数据层                                   │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Elo 评分      │ WCQ xG       │ 俱乐部 xG    │ Polymarket     │
│ eloratings   │ FootyStats   │ Understat    │ gamma/clob API │
│ 48/48队       │ 43/48队      │ 119队×3赛季  │ 赔率+赛果      │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                      预测层                                   │
├──────────────────────┬──────────────────────────────────────┤
│ Dixon-Coles (80%)    │ GBDT 辅助模型 (20%)                  │
│ • Poisson 比分网格    │ • 15 棵决策树, lr=0.08              │
│ • ρ = -0.20/-0.15    │ • 特征: Elo/ATK/DEF/状态差           │
│ • 等保回归校准        │ • ≥15 场历史数据时激活               │
└──────────┬───────────┴──────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│                       输出层                                  │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ 单场胜/平/负  │ 淘汰赛晋级率  │ 冠军概率      │ EV 分析        │
│ 概率          │ 90min+ET+PK │ Monte Carlo   │ 模型 vs 市场   │
│              │ 三段式       │ 10,000 次     │ 正期望高亮     │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

### 模型参数

| 参数 | 值 | 来源 |
|------|-----|------|
| 基础 λ | 1.25 | 每队期望进球（×2 ≈ WC 均场 2.5 球） |
| Elo 标尺 | 400 | 标准 Elo |
| 攻防阻尼 | 0.35 | 调参（降低攻防影响力） |
| ρ 小组赛 | -0.20 | Dixon & Coles 1997，针对平局校准优化 |
| ρ 淘汰赛 | -0.15 | 同上 |
| 温度 T | 1.15 | Guo et al. 2017（等保回归无数据时回退） |
| Polymarket blend | 20%→50% | 时间衰减 + 交易量排名百分位 |
| GBDT blend | 20% | 梯度提升辅助模型 |
| **NB 离散参数 r** | **8.5** | **PELE 2026（负二项分布替代 Poisson）** |
| **比赛重要性** | **1.60/1.76** | **PELE 2026（小组赛/淘汰赛乘数）** |
| **UEFA 估值修正** | **-30%** | **PELE 2026（Transfermarkt 欧洲偏见修正）** |

### 运行

```bash
python3 server.py        # 启动服务器（端口 9090，自动启动 compute-server.js）
# 打开 http://localhost:9090
```

### 近期更新 (2026-06-28)

**对阵与赛程：**
- R32 对阵图 — 16/16 场比赛验证正确（对照实际赛果）
- R16 交叉配对 — 验证 8/8 正确（对照 FIFA 官方）
- 第三名分配 — 回溯算法 + FIFA Annex C 约束
- 北京时间 — 所有淘汰赛时间 ET→UTC+8 转换
- M83 修正 — R(K) vs R(L) = 葡萄牙 vs 克罗地亚（原错误为 W(K)）
- M88 修正 — R(D) vs R(G) = 澳大利亚 vs 埃及（原错误为 3rd(G)）
- clear.html — 清除 localStorage 重置数据的工具页面

**预测功能：**
- xG（期望进球）+ W/D/L 胜率显示
- 每场比赛最可能的 3 个比分及概率
- 确定性 Poisson 采样（种子化，同一对阵结果固定）
- 加时赛疲劳因子（ET_FATIGUE=0.85）
- 温度参数自动优化（使用 rawProbs，避免双重校准）
- MC worker 接收主线程的 optimalT（概率一致性）

**服务器优化：**
- 并行 Monte Carlo（worker_threads，最多 16 个 worker）
- 结构化错误响应（error/type/action/suggestion）
- 请求限流（20次/10秒窗口）
- 请求日志（耗时、结果大小）
- 新增 `caldiag` API 用于校准诊断

**Bug 修复：**
- EV 分析支持淘汰赛 — `runEV()` 现在遍历 marketOdds 中所有未踢比赛（R32/R16/QF/SF/决赛），不再局限于小组赛 `MATCHES`
- Polymarket API 字段变更 — `ev.eventDate` → `ev.startDate`（Polymarket 移除了 `eventDate` 字段，赔率同步静默返回空数据）

**前端清理：**
- 删除 ~60 行死代码 stub 函数
- 所有计算委托给 compute-server.js
- 修复异步竞态条件

### 功能

- **🔄 Sync Polymarket** — 一键同步赛果 + 赔率 + 重新评估
- **🔁 Re-evaluate** — 用最新模型参数重算所有比赛（不联网）
- **💰 EV 分析** — 模型概率 vs 市场赔率，正期望高亮
- **📊 回测** — Log Loss、Brier Score、准确率（2022 WC 数据）
- **🔮 What-If** — 条件蒙特卡洛（锁定比赛结果）
- **📈 雷达** — 模型 vs Polymarket 真金白银价格对比

### 安全措施

- `esc()` HTML 转义防止 XSS（所有 innerHTML 路径）
- API Key 仅通过 header 传输（无 query param fallback）
- API Key 存储时显示安全警告
- 自动数据获取需用户确认
- 错误信息脱敏（仅 console.error 记录详情）
- importResults 校验队名必须在 TEAMS 字典中

### 性能优化

- `loadState()` 内存缓存，避免重复 JSON.parse
- `calculateEV()` 按市场赔率缓存
- `renderMatches()` 使用哈希查找替代线性搜索
- `getGroupStatus()` O(1) 团队→小组映射
- `withPreTournamentElo()` try/finally 异常安全的 Elo 状态管理
- Monte Carlo simulationHistory 仅存储轻量摘要（省 ~50MB）

### 平局预测策略

传统 "最高概率即结果" 方法会导致零平局（即使平局概率 27% 也从未被选中）。采用两项改进：

1. **概率加权 W/D/L** — 积分榜显示 `W += pWin, D += pDraw, L += pLoss`（小数）
2. **5% 阈值判定** — 当平局概率与最高概率差距 < 5% 时判定为平局

---

## License

MIT
