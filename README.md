# 🏆 2026 FIFA World Cup Predictor

**一个预测 2026 世界杯的单文件网页应用 | A single-file web app predicting the 2026 FIFA World Cup**

[English](#english) · [中文](#中文)

---

## English

### What Is This?

A single HTML file that predicts every match of the 2026 FIFA World Cup using the **Dixon-Coles statistical model** (1997) — the academic gold standard for football prediction. No server needed, no build step, no dependencies. Just open `index.html` in your browser.

**What it does:**
- Predicts win/draw/loss probabilities for all 72 group stage matches
- Simulates the entire tournament 10,000 times (Monte Carlo)
- Shows champion, finalist, semi-final, quarter-final probabilities
- Tracks actual results and compares them to predictions
- Auto-updates Elo ratings and team form as the tournament progresses

### Quick Start (2 minutes)

```bash
# 1. Clone the repo
git clone https://github.com/roywongx/worldcup2026-predictor.git
cd worldcup2026-predictor

# 2. Start the server (needed for API data fetching)
python3 server.py 9090

# 3. Open in browser
# Local:   http://localhost:9090
# Network: http://<your-ip>:9090
```

Or just download `index.html` and double-click to open in Chrome (some features need the server).

### How It Works (Simple Explanation)

```
Step 1: Rate every team
  └─ Elo rating (like chess, but for football)
  └─ 400 Elo points ≈ 1 goal advantage

Step 2: Predict each match
  └─ Dixon-Coles model (1997 academic paper)
  └─ Uses Poisson distribution for goal scoring
  └─ Adds correction for low-score draws (0-0, 1-1)
  └─ Attack/defense ratings differentiate team styles

Step 3: Simulate the tournament
  └─ Run 10,000 complete tournaments
  └─ Each uses real results where available
  └─ Count how often each team wins/loses

Step 4: Show probabilities
  └─ "Spain wins 16% of simulations" → Spain is the favorite
```

### API Keys (Optional, Free)

The app works with built-in data. For live updates during the tournament:

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **football-data.org** | Match results | 10 req/min | [Register](https://www.football-data.org/client/register) |
| **The-Odds-API** | Betting odds | 500 req/month | [Register](https://the-odds-api.com/) |

Enter keys in the **Data** tab. Use the **🔍 Test** button to verify they work.

### Features

- **Dixon-Coles Poisson engine** — academic gold standard for football prediction
- **Elo-Market blending** — 70% Elo + 30% market odds (captures injuries, tactics, morale)
- **Temperature scaling** — reduces overconfidence (T=1.15, probability clipping)
- **FIFA Annex C 495-combination bracket** — correct knockout stage pairings
- **Monte Carlo 10,000** — full tournament simulations with chunked progress
- **Conditional Monte Carlo (What-If)** — lock match results, see instant probability changes
- **Probability trend tracking** — sparkline charts showing probability evolution
- **Isotonic regression calibration** — PAVA algorithm for probability calibration
- **2022 WC backtest** — out-of-sample validation on historical data (48 matches)
- **Dynamic Elo** — updates after each match (K=60 group, K=80 knockout)
- **Attack/defense ratings** — differentiates Brazil (high attack) from Morocco (high defense)
- **De-vig normalization** — removes bookmaker margin from odds
- **Brier Score tracker (打脸榜)** — model vs market accuracy comparison
- **Prediction comparison** — shows predicted vs actual for each completed match
- **Reliability diagram** — visual calibration chart
- **Bilingual** — full Chinese/English toggle
- **Proxy server** — bypasses CORS for API data fetching

### Model Parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Base goals (λ) | 1.15 per team (2.30 total) | Calibrated for realistic distribution |
| Elo → λ | Logistic mapping: `0.3 + 1.4 × W_H` | Physically bounded [0.3, 1.7] |
| Market blending | 70% Elo + 30% odds | Captures soft information |
| Dixon-Coles ρ | -0.13 | Calibrated for international cups |
| Temperature T | 1.15 | Reduces overconfidence |
| Attack/defense | Power 0.45 damping | Prevents extreme amplification |
| Host advantage | ×1.30 (multiplicative) | Mexico/USA/Canada |
| Knockout factor | ×0.88 | Teams play more conservatively |
| Form decay | λ=0.15 (14-day window) | Tournament-tuned |
| Elo K factor | 60 (group) / 80 (knockout) | FIFA standard |
| ET factor | 0.40 (fatigue-adjusted) | Historical ~38-42% of regular time |
| PSO model | 50/50 ± 20% (Elo/1500) | Historical ~55/45 at 200 Elo diff |

### Scoring Rules

| Metric | What It Measures | Our Target |
|--------|-----------------|------------|
| **Log Loss** | Penalizes confident wrong predictions | < 0.90 (good) |
| **Brier Score** | Mean squared error of probabilities | < 0.25 (good) |
| **RPS** | Ranked probability score | < 0.20 (good) |
| **ECE** | Expected calibration error | < 5% (well-calibrated) |
| **Accuracy** | % of correct outcome predictions | > 55% |

### Tech Stack

- Pure HTML/CSS/JavaScript (zero dependencies)
- Python proxy server (`server.py`) for API CORS bypass
- Dixon-Coles Poisson engine with pre-computed factorial table
- 495-entry FIFA Annex C bracket matrix (compressed 11KB)
- localStorage for data persistence

### Academic References

1. Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280
2. Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco
3. Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*
4. Bunker, R. et al. (2024). "Machine Learning for Soccer Match Result Prediction." *arXiv:2403.07669*
5. Karlis, D. & Ntzoufras, I. (2003). "Analysis of Sports Data by Using Bivariate Poisson Models." *JRSS-D*, 52(3): 381-393

### Data Sources

| Data | Source | Last Verified |
|------|--------|---------------|
| Elo ratings | eloratings.net | June 2026 |
| FIFA rankings | FIFA.com | June 2026 |
| Market values | Transfermarkt | 2026 |
| Bookmaker odds | DraftKings | June 10, 2026 |
| Match schedule | FIFA official (cross-verified NDTV/ESPN) | June 13, 2026 |
| Bracket matrix | FIFA Regulations Annex C (via Wikipedia) | June 2026 |
| Attack/defense | Composite of Elo + FIFA + recent form | Estimated |

---

## 中文

### 这是什么？

一个**单文件 HTML 应用**，使用 **Dixon-Coles 统计模型**（1997）预测 2026 FIFA 世界杯全部比赛。这是学术界足球预测的黄金标准。无需服务器、无需构建步骤、无依赖，直接在浏览器打开 `index.html` 即可。

**功能**：
- 预测 72 场小组赛的胜/平/负概率
- 模拟整个锦标赛 10,000 次（蒙特卡洛）
- 显示冠军、决赛、四强、八强概率
- 追踪实际结果并与预测对比
- 随比赛进展自动更新 Elo 评分和球队状态

### 快速开始（2 分钟）

```bash
# 1. 克隆仓库
git clone https://github.com/roywongx/worldcup2026-predictor.git
cd worldcup2026-predictor

# 2. 启动服务器（API 数据获取需要）
python3 server.py 9090

# 3. 浏览器打开
# 本机:   http://localhost:9090
# 局域网: http://<你的IP>:9090
```

或直接下载 `index.html` 双击用 Chrome 打开（部分功能需要服务器）。

### 工作原理（简单版）

```
第一步：给每支球队评分
  └─ Elo 评分（类似国际象棋，但用于足球）
  └─ 400 Elo 分 ≈ 1 进球优势

第二步：预测每场比赛
  └─ Dixon-Coles 模型（1997 年学术论文）
  └─ 用泊松分布建模进球
  └─ 低比分平局修正（0-0、1-1）
  └─ 进攻/防守评分区分球队风格

第三步：模拟锦标赛
  └─ 运行 10,000 次完整锦标赛
  └─ 已完成的比赛使用真实结果
  └─ 统计每支球队的夺冠/淘汰次数

第四步：显示概率
  └─ "西班牙在 16% 的模拟中夺冠" → 西班牙是头号热门
```

### API Key（可选，免费）

应用使用内置数据即可运行。如需实时更新：

| 服务 | 用途 | 免费额度 | 注册 |
|------|------|----------|------|
| **football-data.org** | 比赛结果 | 10 次/分钟 | [注册](https://www.football-data.org/client/register) |
| **The-Odds-API** | 博彩赔率 | 500 次/月 | [注册](https://the-odds-api.com/) |

在 **数据** 标签页输入 Key，点击 **🔍 Test** 验证。

### 功能特性

- **Dixon-Coles Poisson 引擎** — 学术界足球预测黄金标准
- **Elo-Market 混合评级** — 70% Elo + 30% 市场赔率（捕获伤病、战术、士气）
- **温度收缩** — 降低过度自信（T=1.15，概率裁剪）
- **FIFA Annex C 495 组合矩阵** — 正确的淘汰赛对阵
- **蒙特卡洛 10,000 次** — 完整锦标赛模拟（分块处理带进度条）
- **条件蒙特卡洛 (What-If)** — 锁定比赛结果，即时查看概率变化
- **概率走势追踪** — 迷你图显示概率随比赛结果变化
- **等保回归校准** — PAVA 算法（优于 Platt Scaling）
- **2022 WC 回测** — 历史数据样本外验证（48 场）
- **动态 Elo** — 每场比赛后更新（小组赛 K=60，淘汰赛 K=80）
- **进攻/防守评分** — 区分巴西（高进攻）和摩洛哥（高防守）
- **去水归一化** — 去除博彩公司抽水
- **Brier Score 追踪（打脸榜）** — 模型 vs 市场准确度对比
- **预测对比** — 每场已完成比赛显示预测 vs 实际
- **可靠性图表** — 可视化校准图
- **中英文切换** — 完整双语支持
- **代理服务器** — 绕过 CORS 获取 API 数据

### 模型参数

| 参数 | 值 | 来源 |
|------|-----|------|
| 基础进球 (λ) | 每队 1.15（总 2.30） | 校准以获得合理分布 |
| Elo → λ | 逻辑映射: `0.3 + 1.4 × W_H` | 物理有界 [0.3, 1.7] |
| 市场混合 | 70% Elo + 30% 赔率 | 捕获软信息 |
| Dixon-Coles ρ | -0.13 | 国际杯赛校准 |
| 温度 T | 1.15 | 降低过度自信 |
| 攻防阻尼 | Power 0.45 | 防止极端放大 |
| 东道主加成 | ×1.30（乘法） | 墨西哥/美国/加拿大 |
| 淘汰赛因子 | ×0.88 | 球队更保守 |
| 状态衰减 | λ=0.15（14 天窗口） | 赛会制调优 |
| Elo K 因子 | 60（小组赛）/ 80（淘汰赛） | FIFA 标准 |
| 加时赛因子 | 0.40（含疲劳） | 历史数据 ~38-42% |
| 点球模型 | 50/50 ± 20%（Elo/1500） | 历史 ~55/45（200 Elo 差） |

### 评分规则

| 指标 | 衡量什么 | 目标 |
|------|---------|------|
| **Log Loss** | 惩罚自信的错误预测 | < 0.90（好） |
| **Brier Score** | 概率均方误差 | < 0.25（好） |
| **RPS** | 排序概率分数 | < 0.20（好） |
| **ECE** | 期望校准误差 | < 5%（校准良好） |
| **准确率** | 正确预测结果的百分比 | > 55% |

### 学术依据

1. Dixon, M.J. & Coles, S.G. (1997). "Modelling Association Football Scores and Inefficiencies in the Football Betting Market." *JRSS-C*, 46(2): 265-280
2. Elo, A.E. (1978). *The Rating of Chessplayers, Past and Present*. Arco
3. Walsh, C. & Joshi, A. (2023). "Machine learning for sports betting: should model selection be based on accuracy or calibration?" *arXiv:2303.06021*
4. Bunker, R. et al. (2024). "Machine Learning for Soccer Match Result Prediction." *arXiv:2403.07669*
5. Karlis, D. & Ntzoufras, I. (2003). "Analysis of Sports Data by Using Bivariate Poisson Models." *JRSS-D*, 52(3): 381-393

### 数据来源

| 数据 | 来源 | 最后验证 |
|------|------|----------|
| Elo 评分 | eloratings.net | 2026年6月 |
| FIFA 排名 | FIFA.com | 2026年6月 |
| 球队市值 | Transfermarkt | 2026年 |
| 博彩赔率 | DraftKings | 2026年6月10日 |
| 赛程 | FIFA 官方（经 NDTV/ESPN 交叉验证） | 2026年6月13日 |
| 对阵矩阵 | FIFA 规程 Annex C（经 Wikipedia） | 2026年6月 |
| 进攻/防守 | Elo + FIFA + 近期表现综合 | 估算 |

---

## 审计指南 / Audit Guide (For AI Reviewers)

### 已修复的关键 Bug 历史

| 日期 | Bug | 修复 |
|------|-----|------|
| 06-13 | 1-1 比分预测占 82%（现实 11%） | 线性 λ → log-linear λ (β=0.002) |
| 06-13 | 苏格兰/英格兰用英国旗 🇬🇧 | 改为 gb-sct/gb-eng |
| 06-13 | 赛程日期全部错误（MD1 压缩到 4 天） | 对照 FIFA 官方修正 |
| 06-14 | 淘汰赛 bracket 同组对阵 | 动态追踪已用组 |
| 06-14 | getForm() 蒙特卡洛时为 null | formMap 参数贯穿调用链 |
| 06-14 | 校准用赛后 Elo 重算 | 改用存储的预测概率 |
| 06-14 | Ensemble 模型不一致（7.8pp 差异） | 移除，使用单一 Dixon-Coles |
| 06-14 | PSO 被回退到过度激进参数 | 恢复 eloDiff/1500 ±20% |

### 必须验证的检查项

- [ ] `validateData()` 在控制台无警告
- [ ] 总 λ 平均 2.5-2.7（不是 3.0+）
- [ ] 1-1 最可能比分占比 <40%（不是 80%+）
- [ ] 平局概率 20-28%（不是 5% 或 50%）
- [ ] PSO 200 Elo 差 ~55/45（不是 75/25）
- [ ] ET 因子 ~0.40（不是 0.33 或 0.55）
- [ ] matchProbs 一致性（不同参数调用结果相同）
- [ ] Bracket 无同组对阵
- [ ] 赛程日期对照 FIFA 官方
- [ ] 英格兰 = gb-eng，苏格兰 = gb-sct

### 常见回归模式（给下一个 AI）

1. **不要回退已修复的参数** — PSO 和 ET 被修复后又被回退。修改前检查 `git log`。
2. **检查聚合分布，不只看单点** — 1-1 的单场概率 ~13% 看起来合理，但在 72 场中出现 82% 就不正常。
3. **不要添加 ensemble/混合模型** — 已证明产生不一致。用单一模型。
4. **不要添加 fatigueMap 到 lambda** — 双方等罚无意义。ET 因子已含疲劳。
5. **审计数据，不只是代码** — 赛程、国旗、Elo 等事实数据需要对照外部来源验证。

### License

MIT License
