# 🏆 2026 FIFA World Cup Predictor

[English](#english) | [中文](#中文)

---

## English

### What is this?

A single-file HTML application predicting the 2026 FIFA World Cup using the **Dixon-Coles bivariate Poisson model** (1997) — the academic gold standard for football match prediction. No server, no build step — just open in your browser.

### Quick Start

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

# Or download index.html and open in browser
```

### API Keys (Free, 2 minutes)

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **football-data.org** | Match results | 10 req/min | [Register](https://www.football-data.org/client/register) |
| **The-Odds-API** | Betting odds | 500 req/month | [Register](https://the-odds-api.com/) |

### How It Works

```
Elo Ratings → λ = BASE/2 ± ΔElo/800 + Host Bonus
    ↓
Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
    ↓                                    ↑ ρ = -0.12 low-score correction
Monte Carlo 10,000 simulations (FIFA bracket)
    ↓
Champion/Final/Semi/Quarter/R16 probabilities
```

### Model Details

- **Dixon-Coles (1997)** — Bivariate Poisson with low-score correlation correction (ρ=-0.12). Fixes the standard Poisson's under-prediction of 0-0 and 1-1 draws.
- **Elo → λ** — 400 Elo points ≈ 1 goal supremacy. International average λ_base = 2.7 total goals.
- **Host advantage** — +0.30 expected goals for Mexico/USA/Canada (CONCACAF hosts).
- **Dynamic Elo** — K=60 (World Cup weight), updates after each match with goal-difference multiplier.
- **Monte Carlo** — 10,000 full tournament simulations with proper FIFA bracket structure.
- **Scoring rules** — RPS (Ranked Probability Score), Brier score, Log-loss, ECE (Expected Calibration Error).
- **Actual results locked** — Completed matches use real scores; Elo and form update dynamically.

### Academic Basis

- Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280.
- Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco.
- Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*.

### Tech Stack

- Pure HTML/CSS/JavaScript (zero dependencies)
- Dixon-Coles Poisson engine with pre-computed factorial table
- localStorage persistence
- Fetch API for live data

---

## 中文

### 这是什么？

一个**单文件 HTML 应用**，使用 **Dixon-Coles 双变量 Poisson 模型**（1997）预测 2026 FIFA 世界杯。这是学术界足球比赛预测的黄金标准。无需服务器、无需构建 —— 直接在浏览器中打开。

### 快速开始

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

# 或者直接下载 index.html 用浏览器打开
```

### API Key 设置（免费）

| 服务 | 用途 | 免费额度 | 注册 |
|------|------|----------|------|
| **football-data.org** | 比赛结果 | 10 次/分钟 | [注册](https://www.football-data.org/client/register) |
| **The-Odds-API** | 博彩赔率 | 500 次/月 | [注册](https://the-odds-api.com/) |

### 工作原理

```
Elo 评分 → λ = BASE/2 ± ΔElo/800 + 东道主加成
    ↓
Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
    ↓                                    ↑ ρ = -0.12 低比分修正
蒙特卡洛 10,000 次模拟（FIFA 固定对阵）
    ↓
冠军/决赛/四强/八强/十六强概率
```

### 模型详情

- **Dixon-Coles (1997)** — 双变量 Poisson + 低比分相关修正（ρ=-0.12）。修复独立 Poisson 对 0-0 和 1-1 平局的低估。
- **Elo → λ** — 400 Elo 分 ≈ 1 进球优势。国际比赛平均 λ_base = 2.7 总进球。
- **东道主加成** — 墨西哥/美国/加拿大 +0.30 期望进球。
- **动态 Elo** — K=60（世界杯权重），每场比赛后更新，含进球差乘数。
- **蒙特卡洛** — 10,000 次完整锦标赛模拟，使用 FIFA 固定对阵结构。
- **评分规则** — RPS（排序概率分数）、Brier 分数、对数损失、ECE（期望校准误差）。
- **实际结果锁定** — 已完成比赛使用真实比分；Elo 和状态动态更新。

### 学术依据

- Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280.
- Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco.
- Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*.

### 技术栈

- 纯 HTML/CSS/JavaScript（零依赖）
- Dixon-Coles Poisson 引擎 + 预计算阶乘表
- localStorage 持久化
- Fetch API 实时数据

### License

MIT License
