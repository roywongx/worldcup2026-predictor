# 🏆 2026 FIFA World Cup Predictor

**Dixon-Coles Poisson 模型 + GBDT 集成 + Polymarket 数据整合 + 服务端全量计算**

[English](#english) · [中文](#中文)

---

## English

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Browser (index.html ~3600 lines)              │
│  • UI rendering (standings, matches, bracket, probabilities, radar)  │
│  • localStorage: raw data only (actualResults, settings, odds)       │
│  • NO computation — all math delegated to server                     │
│  • Service Worker: network-only for index.html, cache for assets     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ POST /api/compute {action, params}
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   server.py (Python, port 9090)                      │
│  • Static file server (index.html, data/, model/, sw.js)             │
│  • API key storage: data/api-keys.json (server-side, gitignored)     │
│  • Proxies: /api/results → football-data.org                         │
│             /api/results-alt → openfootball (no key needed)           │
│             /api/odds, /api/match-odds → the-odds-api.com            │
│             /api/compute → compute-server.js                         │
│  • Key management: GET/POST /api/keys (masked read, full write)      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP POST /compute
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│               compute-server.js (Node.js, port 9091)                 │
│  • Pre-loads model files via eval() (teams, matches, stats, elo,     │
│    dixon-coles, gbdt, monte-carlo)                                   │
│  • Actions: full, simulation, reevaluate, calibration, caldiag,      │
│    ev, brier, backtest, montecarlo                                   │
│  • Returns: standings, matchResults, rankings, bestThirds,           │
│    ko (bracket), formMap, dynamicElo, probs, xG, top3, ev, etc.     │
│  • Parallel Monte Carlo via worker_threads (mc-worker.js)            │
│  • Rate limiting: 20 req/10s, structured errors, request logging     │
└──────────────────────────────────────────────────────────────────────┘
                                │ (optional fallback)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    mc-server.js (fallback)                            │
│  • Spawned by server.py when compute-server.js is unavailable        │
│  • Reads {actualResults, N, marketOdds} from stdin                   │
│  • Same model files, single-threaded Monte Carlo                     │
└──────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
worldcup2026-predictor/
├── index.html              # Single-page app (~3600 lines HTML/CSS/JS)
│   ├── <head> + CSS         # Styles, responsive layout
│   ├── <body>               # Tab navigation, section containers
│   └── <script>             # All frontend logic:
│       ├── State management  # loadState/saveState (localStorage)
│       ├── API layer         # apiCompute, fetchResults, fetchOdds
│       ├── Rendering         # renderStandings, renderMatches, renderBracket, renderProbabilities
│       ├── Market data       # Polymarket sync, EV analysis
│       ├── Monte Carlo UI    # runMonteCarloUI, What-If, probability trends
│       └── Init              # Version check, auto-fetch, reevaluate, simulate
│
├── server.py               # Python HTTP server (~300 lines)
│   ├── Static file serving   # Serves index.html, data/, model/ files
│   ├── API key management    # GET/POST /api/keys → data/api-keys.json
│   ├── External API proxies  # football-data.org, the-odds-api.com, openfootball
│   ├── Compute proxy         # POST /api/compute → compute-server.js
│   └── Monte Carlo fallback  # POST /api/montecarlo → mc-server.js
│
├── compute-server.js       # Node.js computation server (~700 lines)
│   ├── Model loading         # eval() of data/*.js and model/*.js
│   ├── Actions:
│   │   ├── full              # runSimulation + runCalibration + runEV + runBrier + runBacktest
│   │   ├── simulation        # Group standings + bracket construction
│   │   ├── reevaluate        # Re-compute predictions for actual results
│   │   ├── calibration       # Isotonic calibration, reliability diagram
│   │   ├── ev                # Expected Value analysis (model vs market)
│   │   ├── brier             # Brier score computation
│   │   ├── backtest          # 2022 WC validation
│   │   └── montecarlo        # Parallel MC via worker_threads
│   ├── Caching               # cachedActualResults, cachedMarketOdds (in-memory)
│   └── Rate limiting         # 20 req/10s window
│
├── mc-server.js            # Fallback Monte Carlo (~80 lines)
│   └── stdin/stdout JSON    # {actualResults, N, marketOdds} → {champ, finalist, ...}
│
├── mc-worker.js            # Worker thread for parallel MC (~50 lines)
│   └── workerData           # Receives batchSize, actualResults, marketOdds, savedElo
│
├── model/
│   ├── monte-carlo.js       # Bracket construction, tournament simulation (~470 lines)
│   │   ├── buildKOBracket   # FIFA R32 bracket with third-place assignment
│   │   ├── simulateOneTournament  # Full tournament sim (group + KO)
│   │   ├── buildActualResultsMap  # Result lookup with date-aware + dateless keys
│   │   └── getStoredMarketOdds    # 10-strategy fallback odds lookup
│   │
│   ├── dixon-coles.js       # Dixon-Coles Poisson model (~290 lines)
│   │   ├── simMatch         # Group stage match simulation
│   │   ├── simKO            # Knockout match with ET/PK
│   │   ├── koAdvanceProbs   # Knockout advancement probabilities
│   │   ├── getBlendedProbs  # DC + GBDT + market blend
│   │   └── getFormAdjustedLambdas  # λ calculation with form/Elo/market
│   │
│   ├── gbdt.js              # Gradient Boosted Decision Trees (~180 lines)
│   │   ├── trainAndBlendGBDT  # Train on actual results
│   │   └── gbdtPredict      # Feature-based probability adjustment
│   │
│   ├── elo.js               # Elo rating system (~120 lines)
│   │   ├── updateElo        # Single match Elo update
│   │   ├── rebuildDynamicElo  # Replay all results for dynamic ratings
│   │   └── withPreTournamentElo  # Save/restore for deterministic bracket
│   │
│   └── stats.js             # Statistical utilities (~100 lines)
│       ├── poissonPMF       # Poisson probability mass function
│       ├── negBinPMF        # Negative Binomial PMF
│       ├── dixonColesTau    # Dixon-Coles correlation factor
│       ├── isotonicCalibration  # PAVA algorithm
│       └── rankedProbabilityScore  # RPS metric
│
├── data/
│   ├── teams.js             # 48 team definitions (Elo, ATK, DEF, form, host)
│   ├── matches.js           # 72 group stage matches + venues
│   └── api-keys.json        # Server-side API keys (gitignored)
│
├── sw.js                    # Service Worker (network-only for index.html)
├── clear.html               # Utility: clear localStorage
├── AUDIT-2026-06-28.md      # Comprehensive audit report
└── README.md                # This file
```

### Data Flow

```
Page Load:
  1. Version check (CODE_VER) → clear stale localStorage if needed
  2. loadServerKeys() → GET /api/keys → cache key status
  3. Auto-fetch: GET /api/results-alt → store 73 results in localStorage
  4. fetchResults() (if football-data key exists) → verify/merge results
  5. reevaluateResults() → POST /api/compute {action:'reevaluate'}
  6. runSimulation() → POST /api/compute {action:'full'}
  7. renderAll() → standings + matches + bracket

Sync Polymarket:
  1. fetchPolymarketResults() → merge actual results
  2. fetchPolymarketMatchOdds() → store market odds
  3. fetchPolymarketData() → champion odds for Radar
  4. reevaluateResults() → update predictions
  5. runSimulation() → full recompute
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve index.html |
| GET | `/api/results-alt` | Proxy openfootball (no key needed) |
| GET | `/api/results` | Proxy football-data.org (key required) |
| GET | `/api/odds` | Proxy the-odds-api.com (key required) |
| GET | `/api/match-odds` | Proxy match-level odds (key required) |
| GET | `/api/test` | Test football-data.org key |
| GET | `/api/test-odds` | Test the-odds-api.com key |
| GET | `/api/keys` | Get masked API key status |
| POST | `/api/keys` | Save API keys to server |
| POST | `/api/compute` | Forward to compute-server.js |
| POST | `/api/montecarlo` | Fallback MC via mc-server.js |

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
| NB overdispersion r | 8.5 | PELE 2026 (Negative Binomial replaces Poisson) |
| Match importance | 1.60/1.76 | PELE 2026 (Group/Knockout multiplier) |
| UEFA value correction | -30% | PELE 2026 (Transfermarkt European bias fix) |

### Run

```bash
python3 server.py        # Start server on port 9090 (auto-launches compute-server.js)
# Open http://localhost:9090
```

### Features

- **🔄 Sync Polymarket** — Fetch latest odds + results + re-evaluate
- **🔁 Re-evaluate** — Re-run model with current parameters (no network)
- **💰 EV Analysis** — Positive expected value opportunities (group + knockout)
- **📊 Backtest** — Log Loss, Brier Score, accuracy on 2022 WC data
- **🔮 What-If** — Conditional Monte Carlo (lock match outcomes)
- **📈 Radar** — Model vs Polymarket real-money odds comparison
- **🔒 Locked Results** — Actual results shown with green border + ✓ indicator

---

## 中文

### 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│                     浏览器 (index.html ~3600 行)                      │
│  • UI 渲染（积分榜、全部比赛、对阵图、概率分析、雷达）                    │
│  • localStorage: 仅存原始数据（actualResults、设置、赔率）               │
│  • 零计算 — 所有数学运算委托给服务器                                    │
│  • Service Worker: index.html 网络优先，静态资源缓存                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ POST /api/compute {action, params}
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   server.py (Python, 端口 9090)                       │
│  • 静态文件服务（index.html、data/、model/、sw.js）                     │
│  • API Key 存储: data/api-keys.json（服务端，已 gitignore）             │
│  • 代理: /api/results → football-data.org                             │
│          /api/results-alt → openfootball（无需 key）                    │
│          /api/odds → the-odds-api.com                                 │
│          /api/compute → compute-server.js                             │
│  • Key 管理: GET/POST /api/keys（脱敏读取，完整写入）                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP POST /compute
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│               compute-server.js (Node.js, 端口 9091)                  │
│  • 通过 eval() 预加载模型文件（teams、matches、stats、elo、              │
│    dixon-coles、gbdt、monte-carlo）                                    │
│  • Actions: full、simulation、reevaluate、calibration、caldiag、       │
│    ev、brier、backtest、montecarlo                                     │
│  • 返回: standings、matchResults、rankings、bestThirds、               │
│    ko（对阵图）、formMap、dynamicElo、probs、xG、top3、ev 等           │
│  • 并行 Monte Carlo（worker_threads，mc-worker.js）                    │
│  • 限流: 20 次/10 秒，结构化错误，请求日志                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 文件结构

```
worldcup2026-predictor/
├── index.html              # 单页应用（~3600 行 HTML/CSS/JS）
│   ├── 状态管理             # loadState/saveState (localStorage)
│   ├── API 层              # apiCompute、fetchResults、fetchOdds
│   ├── 渲染                # renderStandings、renderMatches、renderBracket
│   ├── 市场数据             # Polymarket 同步、EV 分析
│   ├── Monte Carlo UI      # runMonteCarloUI、What-If、概率趋势
│   └── 初始化              # 版本检查、自动获取、重新评估、模拟
│
├── server.py               # Python HTTP 服务器（~300 行）
│   ├── 静态文件服务          # index.html、data/、model/
│   ├── API Key 管理         # GET/POST /api/keys → data/api-keys.json
│   ├── 外部 API 代理        # football-data.org、the-odds-api.com
│   ├── 计算代理             # POST /api/compute → compute-server.js
│   └── MC 回退             # POST /api/montecarlo → mc-server.js
│
├── compute-server.js       # Node.js 计算服务器（~700 行）
│   ├── full                # 模拟 + 校准 + EV + Brier + 回测
│   ├── simulation          # 小组积分榜 + 对阵图构建
│   ├── reevaluate          # 用最新模型重算已赛预测
│   ├── ev                  # 期望值分析（模型 vs 市场）
│   └── montecarlo          # 并行 MC（worker_threads）
│
├── model/
│   ├── monte-carlo.js      # 对阵图构建、锦标赛模拟（~470 行）
│   │   ├── buildKOBracket  # FIFA R32 对阵图 + 第三名分配
│   │   ├── buildActualResultsMap  # 日期感知 + 无日期回退 key
│   │   └── getStoredMarketOdds    # 10 种回退策略赔率查找
│   │
│   ├── dixon-coles.js      # Dixon-Coles Poisson 模型（~290 行）
│   │   ├── simMatch        # 小组赛模拟
│   │   ├── simKO           # 淘汰赛（含加时/点球）
│   │   ├── koAdvanceProbs  # 淘汰赛晋级概率
│   │   └── getBlendedProbs # DC + GBDT + 市场融合
│   │
│   ├── gbdt.js             # 梯度提升决策树（~180 行）
│   ├── elo.js              # Elo 评分系统（~120 行）
│   └── stats.js            # 统计工具（~100 行）
│
├── data/
│   ├── teams.js            # 48 队定义（Elo、ATK、DEF、状态）
│   ├── matches.js          # 72 场小组赛 + 场馆
│   └── api-keys.json       # 服务端 API Key（已 gitignore）
│
├── sw.js                   # Service Worker（index.html 网络优先）
├── AUDIT-2026-06-28.md     # 综合审计报告
└── PENDING-AUDIT.md        # 待审计清单（供其他 AI 检查）
```

### 数据流

```
页面加载:
  1. 版本检查 (CODE_VER) → 过期则清除 localStorage 并重载
  2. loadServerKeys() → GET /api/keys → 缓存 key 状态
  3. 自动获取: GET /api/results-alt → 存 73 条结果到 localStorage
  4. fetchResults()（如有 football-data key）→ 验证/合并结果
  5. reevaluateResults() → POST /api/compute {action:'reevaluate'}
  6. runSimulation() → POST /api/compute {action:'full'}
  7. renderAll() → 积分榜 + 比赛 + 对阵图

同步 Polymarket:
  1. fetchPolymarketResults() → 合并实际赛果
  2. fetchPolymarketMatchOdds() → 存储市场赔率
  3. fetchPolymarketData() → 冠军赔率（雷达用）
  4. reevaluateResults() → 更新预测
  5. runSimulation() → 完整重算
```

### 运行

```bash
python3 server.py        # 启动服务器（端口 9090，自动启动 compute-server.js）
# 打开 http://localhost:9090
```

### 功能

- **🔄 Sync Polymarket** — 一键同步赛果 + 赔率 + 重新评估
- **🔁 Re-evaluate** — 用最新模型参数重算所有比赛（不联网）
- **💰 EV 分析** — 模型概率 vs 市场赔率，正期望高亮（小组赛 + 淘汰赛）
- **📊 回测** — Log Loss、Brier Score、准确率（2022 WC 数据）
- **🔮 What-If** — 条件蒙特卡洛（锁定比赛结果）
- **📈 雷达** — 模型 vs Polymarket 真金白银价格对比
- **🔒 锁定结果** — 实际赛果有绿色边框 + ✓ 标记

---

## License

MIT
