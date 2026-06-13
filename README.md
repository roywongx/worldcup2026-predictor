# 🏆 2026 FIFA World Cup Predictor

[English](#english) | [中文](#中文)

---

## English

### What is this?

A single-file HTML application that predicts the 2026 FIFA World Cup using the **Dixon-Coles bivariate Poisson model** (1997) — the academic gold standard for football match prediction. Features the complete **FIFA Annex C 495-combination bracket matrix** for accurate knockout stage simulation.

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
Elo Ratings ──→ λ = BASE/2 ± ΔElo/800 + Host Bonus
                    ↓
Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
                    ↓                              ↑ ρ = -0.12 correction
Monte Carlo 10,000 simulations ──→ FIFA Annex C 495 bracket matrix
                    ↓
Champion / Final / Semi / Quarter / R16 probabilities
```

### Model Details

**Core Model — Dixon-Coles (1997)**
- Bivariate Poisson with low-score correlation correction (ρ = -0.12)
- Fixes independent Poisson's systematic under-prediction of 0-0 and 1-1 draws
- Academic reference: Dixon, M.J. & Coles, S.G. (1997). *JRSS-C*, 46(2): 265-280

**Elo → Goal Expectancy**
- 400 Elo points ≈ 1 goal supremacy (industry standard)
- International average: λ_base = 2.7 total goals per match
- Dynamic Elo: K=60 (World Cup weight), updates after each match

**Knockout Bracket — FIFA Annex C**
- Complete 495-combination matrix parsed from FIFA Regulations
- R32 structure: 8 winner-vs-third + 4 winner-vs-runner-up + 4 runner-up-vs-runner-up
- No same-group matchups in R32 (FIFA rule)
- Third-place qualification: sorted by points → GD → GF → fair play

**Home Advantage**
- Host nations (Mexico/USA/Canada): +0.30 expected goals
- Neutral venues: no adjustment

**Scoring Rules**
- **RPS** (Ranked Probability Score): the football standard for 3-outcome predictions
- **Brier Score**: mean squared error of probability vectors
- **Log Loss**: penalizes confident wrong predictions
- **ECE** (Expected Calibration Error): measures probability calibration

### Features

- **Dixon-Coles Poisson engine** with pre-computed factorial table
- **FIFA Annex C 495 bracket matrix** (compressed 11KB)
- **Monte Carlo 10,000** full tournament simulations
- **Prediction comparison**: shows predicted vs actual for each completed match
- **Accuracy dashboard**: RPS, Brier, ECE, win/draw/loss accuracy
- **Dynamic Elo**: updates after each match with goal-difference multiplier
- **Form momentum**: exponential decay (λ=0.05), recent matches weighted more
- **Live data**: proxy server bypasses CORS for football-data.org and the-odds-api.com
- **Polymarket radar**: real-money prediction market comparison
- **Bilingual**: full Chinese/English toggle with technical terms preserved
- **localStorage persistence**: all data survives page refreshes

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
Elo 评分 ──→ λ = BASE/2 ± ΔElo/800 + 东道主加成
                ↓
Dixon-Coles Poisson: P(h,a) = Poisson(h;λH) × Poisson(a;λA) × τ(h,a)
                ↓                                    ↑ ρ = -0.12 修正
蒙特卡洛 10,000 次 ──→ FIFA Annex C 495 组合对阵矩阵
                ↓
冠军 / 决赛 / 四强 / 八强 / 十六强 概率
```

### 模型详情

**核心模型 — Dixon-Coles (1997)**
- 双变量 Poisson + 低比分相关修正（ρ = -0.12）
- 修复独立 Poisson 对 0-0 和 1-1 平局的系统性低估
- 学术来源：Dixon, M.J. & Coles, S.G. (1997). *JRSS-C*, 46(2): 265-280

**Elo → 期望进球**
- 400 Elo 分 ≈ 1 进球优势（行业标准）
- 国际比赛平均：λ_base = 2.7 总进球
- 动态 Elo：K=60（世界杯权重），每场比赛后更新

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

### 功能特性

- **Dixon-Coles Poisson 引擎** + 预计算阶乘表
- **FIFA Annex C 495 组合矩阵**（压缩 11KB）
- **蒙特卡洛 10,000 次**完整锦标赛模拟
- **预测对比**：每场已完成比赛显示预测 vs 实际
- **准确度仪表板**：RPS、Brier、ECE、胜平负准确率
- **动态 Elo**：每场比赛后更新，含进球差乘数
- **状态动量**：指数衰减（λ=0.05），近期比赛权重更高
- **实时数据**：代理服务器绕过 CORS，对接 football-data.org 和 the-odds-api.com
- **Polymarket 雷达**：真金白银预测市场价格对比
- **中英文切换**：完整翻译，技术术语保留英文
- **localStorage 持久化**：数据刷新不丢失

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
