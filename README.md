# 🏆 2026 FIFA World Cup Predictor

**Dixon-Coles Poisson 模型 + Polymarket 真实赔率 + 三轨 xG 数据融合**

[English](#english) · [中文](#中文)

---

## 中文

### 核心特性

- **Dixon-Coles 泊松模型**：基于 Elo 评分 + 攻防系数 + 动态 rho（小组赛/淘汰赛分阶段）
- **三轨 xG 数据融合**：WCQ 预选赛 xG (70%) + Understat 俱乐部 xG (30%)
- **Polymarket 三 API 整合**：赛果自动更新、实时赔率 blend、赛前赔率回测
- **淘汰赛三段式**：90 分钟 + 加时赛（γ 保守系数）+ 点球（Elo 微调）
- **Monte Carlo 模拟**：10,000 次模拟计算冠军/四强/八强概率
- **中英双语 UI**

### 数据源

| 数据 | 来源 | 覆盖 |
|------|------|------|
| Elo 评分 | worldfootballrankings.com | 48/48 队 |
| WCQ 预选赛 xG | FootyStats.com (Exa 搜索) | 43/48 队 |
| 俱乐部 xG | Understat (Playwright 抓取) | 五大联赛 3 赛季 119 队 |
| 赛果 + 比分 | Polymarket gamma-api | 自动同步 |
| 实时赔率 | Polymarket gamma-api | 65 场未开始比赛 |
| 赛前赔率 | Polymarket clob-api | prices-history |
| 比赛结果 | Polymarket gamma-api | Exact Score 市场 |

### 模型参数

| 参数 | 值 | 来源 |
|------|-----|------|
| 基础 λ | 1.15 | FIFA 国际比赛统计 |
| Elo 标尺 | 400 | 标准 Elo |
| 攻防阻尼 | 0.35 | 调参（降低攻防影响力） |
| ρ 小组赛 | -0.15 | Dixon & Cole 1997 + 评估建议 |
| ρ 淘汰赛 | -0.12 | 同上 |
| 温度 T | 1.15 | Guo et al. 2017 |
| Polymarket blend | 20%→50% | 时间衰减（赛前7天→临场） |
| ET 保守系数 γ | 0.70±0.05 | 历史世界杯数据 |
| PK 截断 | [0.40, 0.60] | 经验值 |

### 运行

```bash
python3 server.py
# 打开 http://localhost:9090
```

### 预测示例（小组赛）

| 对比 | 胜 | 平 | 负 |
|------|----|----|-----|
| 巴西 vs 摩洛哥 | 33.4% | 32.7% | 33.9% |
| 阿根廷 vs 西班牙 | 31.2% | 32.2% | 36.6% |
| 法国 vs 英格兰 | 37.8% | 32.3% | 30.0% |
| 德国 vs 日本 | 44.1% | 31.6% | 24.3% |

---

## English

### Features

- **Dixon-Coles Poisson model**: Elo ratings + attack/defense coefficients + dynamic rho (group/knockout stages)
- **Triple xG data fusion**: WCQ qualifying xG (70%) + Understat club xG (30%)
- **Polymarket 3 API integration**: auto-update results, live odds blend, pre-match odds backtesting
- **Knockout 3-stage model**: 90min + extra time (γ fatigue factor) + penalties (Elo-adjusted)
- **Monte Carlo simulation**: 10,000 runs for champion/semi/quarter probabilities
- **Bilingual UI** (Chinese/English)

### Data Sources

| Data | Source | Coverage |
|------|--------|----------|
| Elo ratings | worldfootballrankings.com | 48/48 teams |
| WCQ xG | FootyStats.com (Exa search) | 43/48 teams |
| Club xG | Understat (Playwright scraping) | Top 5 leagues, 3 seasons, 119 teams |
| Match results | Polymarket gamma-api | Auto-sync |
| Live odds | Polymarket gamma-api | 65 upcoming matches |
| Pre-match odds | Polymarket clob-api | prices-history |

### Run

```bash
python3 server.py
# Open http://localhost:9090
```

---

## License

MIT
