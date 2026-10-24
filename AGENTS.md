# worldcup2026-predictor — Agent 指南

2026 世界杯预测器：Dixon-Coles 泊松模型 + Elo + GBDT + 蒙特卡洛模拟，对接 Polymarket 赔率。前端是单文件 `index.html`（内联 JS，zh/en 双语），`server.py` 提供静态文件和外部 API 代理，计算请求转给 Node 的 `compute-server.js`。
**2026-06-30 之后没有提交，2026-07-07 之后没有改动；赛事已结束，当前不在运行。**

## 运行事实
| 项 | 值 |
|---|---|
| 服务 | 网关托管进程（无 systemd，auto_restart 未设）；网关卡片 id `worldcup-predictor` |
| 地址 | `0.0.0.0:9090`（`server.py`）→ 计算服务 `127.0.0.1:9091`（`compute-server.js`，由 server.py 拉起） |
| 启动 | `nohup python3 server.py 9090 > /tmp/worldcup.log 2>&1 &`（= `npm start`） |
| 停止 | `pkill -xf python3 server.py 9090` |
| 测试 | `npm test`（只做语法检查）；模型正确性靠下面的浏览器内验证函数 |
| 远端 | GitHub roywongx/worldcup2026-predictor；**推送需用户同意** |

## 红线
1. 工作区有 2026-07 的未提交改动（`compute-server.js`、`index.html`、`model/monte-carlo.js`、`data/matches.js`、`sw.js`），来源与是否可用未核实——**不要丢弃，也不要直接提交**，先问用户。
2. 改了 `sw.js` 或前端资源要同步 bump `CODE_VER`（Service Worker 曾因自缓存导致更新到不了浏览器；`/clear.html` 是一键清缓存页）。
3. 单文件 HTML：JS 保持内联，不引入外部依赖；所有面向用户的文字都要有 zh/en 翻译，技术术语（API、RPS、Dixon-Coles）两种语言都保留英文。

## 验证要求
- 改球队数据或赛程后跑 `validateData()`，必须 0 错误；赛程日期对照 FIFA 官方，国旗代码 England=`gb-eng`、Scotland=`gb-sct`。
- 改模型参数后跑 2022 世界杯回测 `runBacktest()`（应返回 30+ 场），并检查：最可能比分中 1-1 占比 <40%，总 λ 均值 2.5~3.0，平局率 20%~28%。
- `runSimulation()` 无报错；`runMonteCarloUI()` 能跑完 10,000 次模拟。
- 先找根因再修，完成前用实际输出证明，不说"应该好了"。

## 代码地图
`index.html` 前端全部逻辑 · `data/` 球队与赛程 · `model/` stats、elo、dixon-coles、gbdt、monte-carlo · `mc-worker.js` / `mc-server.js` 模拟 worker · `compute-server.js` 计算服务 · `server.py` 静态 + API 代理 · `api/`、`ui/` 辅助 · `openspec/` 需求规格与变更记录 · `AUDIT-*.md` / `PENDING-AUDIT.md` / `AUDIT-FIX-LOG.md` 2026-06 的审计记录。

## 重大赛事引擎（engine/，2026-10-24 起）
| 项 | 值 |
|---|---|
| 页面 | `/tournaments.html`，读 `web/data/<赛事>.json`（已提交，克隆即可看） |
| 数据 | `npm run engine:fetch` → `data/history/`（不入库） |
| 测试 | `npm run test:engine`（合成数据，不联网；含赛事配置校验） |
| 复现指标 | `npm run engine:backtest`，应得出 `engine/model.json` 里 test 的数字 |
| 更新预测 | 先 fetch，再 `npm run engine:simulate -- <id>`，提交 `web/data/` |

红线：
1. **调参只用训练届次**（`engine/tune.js` 默认 2010–2016）；2017 年以后的届次只用来报告。改了模型结构或参数，必须重跑 `backtest` 并更新 `model.json` 的 test 数字，不得只报训练集成绩。
2. 回测里拟合只能用该场比赛日之前的数据（`dc.fit` 的 day 参数；有测试守住）。
3. 赛事配置（分组、东道主、对阵、第三名组合表）只从官方来源抄，写进 `sources`；第三名表要逐行核对，并在测试里钉住几行。拿不到官方表时用 `thirdAllowed` 约束近似，页面会标注。
4. 页面上的概率是模型输出，不得手工改数。

代码地图：`data.js` 读数据、按 >150 天断档切届 · `elo.js` World Football Elo · `dc.js` Dixon-Coles 拟合与比分矩阵 · `metrics.js` RPS/log-loss/校准 · `backtest.js` 滚动回测 · `tune.js` 网格调参 · `simulate.js` 赛制蒙特卡洛 · `cli.js` 命令行 · `events/*.json` 赛事配置。

已知局限：数据集比分含加时、不含点球（淘汰赛平局按 90+30 分钟结果计）；无伤病/阵容信息；点球按五五开；小组排名未含纪律分。
