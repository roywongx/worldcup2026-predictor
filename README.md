# 🏆 2026 FIFA World Cup Predictor / 2026 FIFA 世界杯预测器

[English](#english) | [中文](#中文)

---

## English

### What is this?

A self-contained, single-file HTML application that predicts the 2026 FIFA World Cup using a **multi-factor composite model** with real-time data integration. No server, no build step — just open the file in your browser.

### Quick Start

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

# Or just download index.html and open in browser
```

### API Keys Setup (Free, 2 minutes)

The app works with built-in data, but **live updates require free API keys**:

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **football-data.org** | Match results | 10 req/min | [Register](https://www.football-data.org/client/register) |
| **The-Odds-API** | Betting odds | 500 req/month | [Register](https://the-odds-api.com/) |

**How to set up:**
1. Register at both sites (free)
2. Copy your API keys
3. Open the app → go to **Data** tab
4. Paste keys in the input fields → click **Save**

### Features

- **Dynamic Composite Model** — Elo (25%) + FIFA (15%) + Market Value (10%) + Bookmaker Odds (25%) + Form (10%) + Experience (5%) + Dynamic Elo (10%)
- **Auto-Fetch Results** — Pulls completed match results from football-data.org
- **Auto-Fetch Odds** — Pulls live betting odds from The-Odds-API
- **Polymarket Radar** — Real-money prediction market comparison
- **Dynamic Elo** — Updates after each match (K=60, World Cup weight)
- **Form Momentum** — Exponential decay (λ=0.05), recent matches weighted more
- **Poisson Goal Model** — Separate attack/defense ratings
- **Monte Carlo** — 10,000 iterations for probability distributions
- **Adaptive Calibration** — Model weights auto-adjust based on accuracy
- **Actual Results Lock** — Completed matches use real scores

### How It Works

```
Data Sources → Composite Rating Engine → Group Stage (Poisson) + Knockout (Deterministic) → Monte Carlo → Probabilities
```

### Tech Stack

- Pure HTML/CSS/JavaScript (zero dependencies)
- localStorage for persistence
- Fetch API for data retrieval

---

## 中文

### 这是什么？

一个**单文件 HTML 应用**，使用多因子复合模型预测 2026 FIFA 世界杯。无需服务器、无需构建步骤 —— 直接在浏览器中打开即可。

### 快速开始

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/roywongx/worldcup2026-predictor/main/install.ps1 | iex

# 或者直接下载 index.html 用浏览器打开
```

### API Key 设置（免费，2 分钟）

应用可以使用内置数据运行，但**实时更新需要免费的 API Key**：

| 服务 | 用途 | 免费额度 | 注册地址 |
|------|------|----------|----------|
| **football-data.org** | 比赛结果 | 10 次/分钟 | [注册](https://www.football-data.org/client/register) |
| **The-Odds-API** | 博彩赔率 | 500 次/月 | [注册](https://the-odds-api.com/) |

**设置步骤：**
1. 在两个网站注册（免费）
2. 复制你的 API Key
3. 打开应用 → 进入 **Data** 标签页
4. 粘贴 Key 到输入框 → 点击 **Save**

### 核心功能

- **动态复合模型** — Elo (25%) + FIFA (15%) + 球队市值 (10%) + 博彩赔率 (25%) + 状态动量 (10%) + 经验 (5%) + 动态 Elo (10%)
- **自动获取赛果** — 从 football-data.org 拉取已完成的比赛结果
- **自动获取赔率** — 从 The-Odds-API 拉取实时博彩赔率
- **Polymarket 雷达** — 真金白银预测市场价格对比
- **动态 Elo** — 每场比赛后自动更新（K=60，世界杯权重）
- **状态动量** — 指数衰减（λ=0.05），近期比赛权重更高
- **Poisson 进球模型** — 独立的进攻/防守评分
- **蒙特卡洛模拟** — 10,000 次迭代生成概率分布
- **自适应校准** — 模型权重根据预测准确率自动调整
- **实际结果锁定** — 已完成的比赛使用真实比分

### 工作原理

```
数据源 → 复合评分引擎 → 小组赛 (Poisson) + 淘汰赛 (确定性) → 蒙特卡洛 → 概率分布
```

### 技术栈

- 纯 HTML/CSS/JavaScript（零依赖）
- localStorage 持久化
- Fetch API 数据获取

### License

MIT License
