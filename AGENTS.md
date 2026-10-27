# worldcup2026-predictor — Agent 指南

足球预测台：Dixon-Coles 泊松模型 + Elo + 蒙特卡洛模拟，覆盖五大联赛与国家队赛事。`/` 是新的单页应用 `index.html`（内联 JS，zh/en 双语，读 `web/data/*.json`），`server.py` 提供静态文件和外部 API 代理，老世界杯页面的计算请求转给 Node 的 `compute-server.js`。
2026 世界杯已结束：那届的页面归档为 `/wc2026.html`（历史快照，不再维护），计算与数据引擎在 `engine/` 继续用。服务一直在 9090 运行。

## 运行事实
| 项 | 值 |
|---|---|
| 服务 | 网关托管进程（无 systemd，auto_restart 未设）；网关卡片 id `worldcup-predictor` |
| 地址 | `0.0.0.0:9090`（`server.py`）→ 计算服务 `127.0.0.1:9091`（`compute-server.js`，由 server.py 拉起） |
| 页面 | `/` = 新单页应用（赛事总览 / 赛事页 / 方法 / 归档）；`/wc2026.html` = 2026 世界杯归档页；`/tournaments.html` 只做跳转 |
| 启动 | `nohup python3 server.py 9090 > /tmp/worldcup.log 2>&1 &`（= `npm start`） |
| 停止 | `pkill -xf python3 server.py 9090` |
| 测试 | `npm test`（语法）；`npm run test:engine`（引擎契约）；`npm run test:ui`（`index.html` 的 UI-CORE 纯函数） |
| 每日刷新 | `scripts/refresh.sh`（cron 06:30，参数透传如 `--sims 2000`）：国家队 `fetch` + 在赛赛事 `simulate`，俱乐部 `fetch-clubs` + 在赛联赛 `simulate-league`，欧战 `fetch-euro` + `simulate-euro`，写 `web/data/`；国家队数据下载失败但本地 history 可读时只警告并沿用本地数据 |
| 新赛季 | `node engine/cli.js new-season --season 2728`（按当季数据生成七份联赛配置，已存在不覆盖，加 `--force`；队数少于模板 75% 直接拒绝，队数不同要 `--force`），再 `node engine/cli.js refresh` |
| 远端 | GitHub roywongx/worldcup2026-predictor；**推送需用户同意** |

## 红线
1. `sw.js` 是**注销开关**（install `skipWaiting`，activate 删光本域 cache 并 `self.registration.unregister()`），不要再往里加缓存逻辑；`index.html` 不注册 service worker。`/clear.html` 是一键清缓存页。
2. 单文件 HTML：`index.html` 的 JS 保持内联，不引入任何外部 JS/CSS/字体/CDN/图片（favicon 用 data: URI）；所有面向用户的文字都要有 zh/en 翻译，技术术语（API、RPS、Dixon-Coles）两种语言都保留英文。
3. 页面上的每个数字只能来自 `web/data/*.json`（概率、检验指标都一样），不得手抄或在前端改数；`tests/ui.test.js` 用 `// ==UI-CORE-BEGIN==` / `// ==UI-CORE-END==` 圈出的纯函数段不许出现 `document` / `window` / `localStorage`。
4. 旧页面的资源路径不能动：`data/`、`model/`、`api/`、`ui/` 仍按现在的位置给 `/wc2026.html` 服务。

## 验证要求
- 前端改版后跑 `node --test tests/engine.test.js tests/club.test.js tests/season.test.js tests/refresh.test.js tests/ui.test.js`，并在浏览器里用 375px 与 1280px 各看一遍：整页不能出现横向滚动（宽表格只能在自己的滚动容器里滚）。
- 改模型参数后按下面的「重大赛事引擎」重跑对应的回测，更新 `engine/model.json` / `engine/clubmodel.json` 的 test 数字，再看 `#/method` 与赛事页「可信度」是否跟着变。
- 以下浏览器内验证函数**只适用于归档页 `/wc2026.html`**，与新的单页应用无关：改归档页的球队数据或赛程后跑 `validateData()`（必须 0 错误，国旗代码 England=`gb-eng`、Scotland=`gb-sct`）；改归档页模型后跑 2022 世界杯回测 `runBacktest()`（应返回 30+ 场，最可能比分 1-1 占比 <40%，总 λ 均值 2.5~3.0，平局率 20%~28%），并确认 `runSimulation()` 与 `runMonteCarloUI()`（10,000 次）无报错。
- 先找根因再修，完成前用实际输出证明，不说"应该好了"。

## 代码地图
`index.html` 新单页应用（hash 路由、T 字典、UI-CORE 纯函数、渲染）· `web/data/*.json` 页面数据（`index.json` 是赛事清单，`engine/cli.js` 的 `writeIndex` 生成）· `wc2026.html` 2026 世界杯归档页（原 `index.html`）· `data/` 球队与赛程 · `model/` stats、elo、dixon-coles、gbdt、monte-carlo · `mc-worker.js` / `mc-server.js` 模拟 worker · `compute-server.js` 计算服务 · `server.py` 静态 + API 代理 · `api/`、`ui/` 辅助 · `openspec/` 需求规格与变更记录 · `docs/archive/wc2026/` 2026-06 的审计与评审记录 · `tests/ui.test.js` 前端纯函数测试。

## 重大赛事引擎（engine/，2026-10-24 起）
| 项 | 值 |
|---|---|
| 页面 | `/`（赛事总览）与 `#/e/<id>`，读 `web/data/<赛事>.json`（已提交，克隆即可看） |
| 数据 | `npm run engine:fetch` → `data/history/`（不入库） |
| 测试 | `npm run test:engine`（合成数据，不联网；含赛事配置校验与联赛配置校验）；只跑俱乐部用 `npm run test:club`；前端纯函数用 `npm run test:ui` |
| 复现指标 | `npm run engine:backtest`，应得出 `engine/model.json` 里 test 的数字 |
| 更新预测 | 先 fetch，再 `npm run engine:simulate -- <id>`，提交 `web/data/` |
| 俱乐部数据 | `npm run engine:fetch-clubs` → `data/clubs/<赛季>/<级别>.csv` + `data/clubs/fixtures.csv`（不入库） |
| 俱乐部调参 | `node engine/cli.js club-tune`（写 `engine/clubmodel.json` 的 params 与 tuning.train） |
| 俱乐部指标 | `npm run engine:club-backtest`，应得出 `engine/clubmodel.json` 里 tuning.test 的数字 |
| 赛季级调参 | `node engine/cli.js season-tune`（σ，写 `params.seasonSigma` 与 season.train） |
| 赛季级指标 | `node engine/cli.js season-backtest --from 1718 --to 2526 --sims 5000`（写 season.test） |
| 联赛预测 | `npm run engine:simulate-league -- <league-id>` → `web/data/<id>.json` + 更新 index |
| 欧战数据 | `node engine/cli.js fetch-euro CL`（或 `CLI`）→ `data/uefa/<code>-<season>.json`（不入库，6 小时缓存）；key 在 `data/api-keys.json` 的 `football-data`，该文件 gitignore |
| 欧战预测 | `node engine/cli.js simulate-euro ucl-2026-27 --sims 10000` / `copa-libertadores-2026` → `web/data/<id>.json`（index 的 kind 为 `swiss` / `groups2leg`） |
| 欧战测试 | `npm run test:euro`（`tests/euro.test.js`，合成数据、不联网） |

红线：
1. **调参只用训练届次**（`engine/tune.js` 默认 2010–2016）；2017 年以后的届次只用来报告。改了模型结构或参数，必须重跑 `backtest` 并更新 `model.json` 的 test 数字，不得只报训练集成绩。
2. 回测里拟合只能用该场比赛日之前的数据（`dc.fit` 的 day 参数；有测试守住）。
3. 赛事配置（分组、东道主、对阵、第三名组合表）只从官方来源抄，写进 `sources`；第三名表要逐行核对，并在测试里钉住几行。拿不到官方表时用 `thirdAllowed` 约束近似，页面会标注。
4. 页面上的概率是模型输出，不得手工改数。
5. **欧战（欧冠/解放者杯）免费档没有赔率**：页面市场列只能显示「—」，不得伪造赔率；赛程只信 API，不自己造对阵。
6. 欧战赛事配置放 `engine/events/euro/`，不要放进 `engine/events/`：那里的 `*.json` 是「小组+淘汰」通用赛制，`tests/engine.test.js` 会逐个校验（分组、第三名表、首轮槽位），欧战赛制不同。
7. **俱乐部调参只用 1314–1617 赛季**（`engine/clubbacktest.js` 的 `clubTune` 默认值）；**1718–2526 只用来报告**（`club-backtest` 默认区间）。改了俱乐部模型结构或参数，必须重跑 `club-backtest` 并更新 `clubmodel.json` 的 test 数字。**σ 只在 1314–1617 上调（`season-tune`），测试赛季只用来报告（`season-backtest`）。**

代码地图：`data.js` 读数据、按 >150 天断档切届 · `elo.js` World Football Elo · `dc.js` Dixon-Coles 拟合与比分矩阵 · `metrics.js` RPS/log-loss/校准 · `backtest.js` 滚动回测 · `tune.js` 网格调参 · `simulate.js` 赛制蒙特卡洛 · `cli.js` 命令行（含 `writeIndex`、`new-season`、`refresh`）· `season.js` 新赛季推导（id/队数/区间/notes）与刷新判定 · `scripts/refresh.sh` 每日刷新入口 · `events/*.json` 赛事配置 · `clubdata.js` 读俱乐部 CSV 与赔率 · `league.js` 双循环赛程、各联赛同分规则排名、赛季蒙特卡洛 · `clubbacktest.js` 俱乐部回测/调参 · `seasonbacktest.js` 赛季级检验（名次区间 Brier）与 σ 调参 · `clubmodel.json` 俱乐部参数与测试集指标 · `leagues/*.json` 联赛配置 · `eurodata.js` 欧战数据（football-data.org v4：缓存/限流/解析，点球不计入比分）· `euro.js` 欧战赛制（联赛阶段排名、两回合淘汰、小组+两回合、签位近似）· `events/euro/*.json` 欧战配置。

俱乐部已知局限：同分规则按各联赛公开规则近似（法甲为近似、意甲附加赛按五五开）；队名用 football-data.co.uk 写法；市场概率来自 Pinnacle/Avg 收盘赔率去抽水；次级联赛只用来给升班马定级，不参与报告。

欧战已知局限：免费档只有比分（没有赔率）；附加赛/16 强配对与 8 强、4 强首回合主场按官方固定结构随机近似（真实是抽签）；总比分平按点球五五开（不单独建模加时）；南美俱乐部没有国内联赛数据，只靠解放者杯比赛定级；球队强弱来自同一个单池拟合（见 README 的「单池结论」）。

已知局限：数据集比分含加时、不含点球（淘汰赛平局按 90+30 分钟结果计）；无伤病/阵容信息；点球按五五开；小组排名未含纪律分。
