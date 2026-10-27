# worldcup2026-predictor — Agent 指南

2026 世界杯预测器：Dixon-Coles 泊松模型 + Elo + GBDT + 蒙特卡洛模拟，对接 Polymarket 赔率。前端是单文件 `index.html`（内联 JS，zh/en 双语），`server.py` 提供静态文件和外部 API 代理，计算请求转给 Node 的 `compute-server.js`。
2026 世界杯已结束，`/` 是那届的历史页面；现在维护的是 `engine/`（`/tournaments.html`，国家队赛事 + 五大联赛）。服务一直在 9090 运行。

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
1. 改了 `sw.js` 或前端资源要同步 bump `CODE_VER`（Service Worker 曾因自缓存导致更新到不了浏览器；`/clear.html` 是一键清缓存页）。
2. 单文件 HTML：JS 保持内联，不引入外部依赖；所有面向用户的文字都要有 zh/en 翻译，技术术语（API、RPS、Dixon-Coles）两种语言都保留英文。

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
| 测试 | `npm run test:engine`（合成数据，不联网；含赛事配置校验与联赛配置校验）；只跑俱乐部用 `npm run test:club` |
| 复现指标 | `npm run engine:backtest`，应得出 `engine/model.json` 里 test 的数字 |
| 更新预测 | 先 fetch，再 `npm run engine:simulate -- <id>`，提交 `web/data/` |
| 俱乐部数据 | `npm run engine:fetch-clubs` → `data/clubs/<赛季>/<级别>.csv` + `data/clubs/fixtures.csv`（不入库） |
| 俱乐部调参 | `node engine/cli.js club-tune`（写 `engine/clubmodel.json` 的 params 与 tuning.train） |
| 俱乐部指标 | `npm run engine:club-backtest`，应得出 `engine/clubmodel.json` 里 tuning.test 的数字 |
| 赛季级调参 | `node engine/cli.js season-tune`（σ，写 `params.seasonSigma` 与 season.train） |
| 赛季级指标 | `node engine/cli.js season-backtest --from 1718 --to 2526 --sims 5000`（写 season.test） |
| 联赛预测 | `npm run engine:simulate-league -- <league-id>` → `web/data/<id>.json` + 更新 index |

红线：
1. **调参只用训练届次**（`engine/tune.js` 默认 2010–2016）；2017 年以后的届次只用来报告。改了模型结构或参数，必须重跑 `backtest` 并更新 `model.json` 的 test 数字，不得只报训练集成绩。
2. 回测里拟合只能用该场比赛日之前的数据（`dc.fit` 的 day 参数；有测试守住）。
3. 赛事配置（分组、东道主、对阵、第三名组合表）只从官方来源抄，写进 `sources`；第三名表要逐行核对，并在测试里钉住几行。拿不到官方表时用 `thirdAllowed` 约束近似，页面会标注。
4. 页面上的概率是模型输出，不得手工改数。
5. **俱乐部调参只用 1314–1617 赛季**（`engine/clubbacktest.js` 的 `clubTune` 默认值）；**1718–2526 只用来报告**（`club-backtest` 默认区间）。改了俱乐部模型结构或参数，必须重跑 `club-backtest` 并更新 `clubmodel.json` 的 test 数字。**σ 只在 1314–1617 上调（`season-tune`），测试赛季只用来报告（`season-backtest`）。**

代码地图：`data.js` 读数据、按 >150 天断档切届 · `elo.js` World Football Elo · `dc.js` Dixon-Coles 拟合与比分矩阵 · `metrics.js` RPS/log-loss/校准 · `backtest.js` 滚动回测 · `tune.js` 网格调参 · `simulate.js` 赛制蒙特卡洛 · `cli.js` 命令行 · `events/*.json` 赛事配置 · `clubdata.js` 读俱乐部 CSV 与赔率 · `league.js` 双循环赛程、各联赛同分规则排名、赛季蒙特卡洛 · `clubbacktest.js` 俱乐部回测/调参 · `seasonbacktest.js` 赛季级检验（名次区间 Brier）与 σ 调参 · `clubmodel.json` 俱乐部参数与测试集指标 · `leagues/*.json` 联赛配置。

俱乐部已知局限：同分规则按各联赛公开规则近似（法甲为近似、意甲附加赛按五五开）；队名用 football-data.co.uk 写法；市场概率来自 Pinnacle/Avg 收盘赔率去抽水；次级联赛只用来给升班马定级，不参与报告。

已知局限：数据集比分含加时、不含点球（淘汰赛平局按 90+30 分钟结果计）；无伤病/阵容信息；点球按五五开；小组排名未含纪律分。
