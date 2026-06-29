# 🔍 2026 FIFA World Cup Predictor — 综合代码审计报告

**审计日期**: 2026-06-29  
**审计范围**: `index.html`, `sw.js`, `clear.html`, `server.py`, `compute-server.js`, `mc-worker.js`, `mc-server.js`, `model/*.js`, `data/*.js`, 安装脚本, API key 管理, CORS, localStorage, 审计文件  
**前提假设**: **完全信任局域网（LAN）访问**。所有与“局域网内可被访问”相关的安全问题在此前提下降低优先级或视为可接受。本报告重点关注：模型正确性、数据一致性、进程稳定性、以及即使在 LAN 信任前提下仍可能触发的风险（如文件篡改、进程崩溃、UI 显示错误）。

---

## 0. 执行摘要

项目在功能层面已跑通，R32/R16 对阵、EV 淘汰赛、并行 Monte Carlo 等近期修复有效。但在 **LAN 信任前提** 下，仍需优先处理以下问题：

1. **模型/数学正确性 bug**（最高优先级）：MD3 日期阈值错误、`renderProbabilities` 决赛列显示错误、Isotonic 校准未实际应用、动态 form 未参与预测。
2. **进程稳定性**：`JSON.parse` 未捕获异常、POST body 无大小限制、`compute-server.js` stdout pipe 阻塞、`TEAMS` 全局状态污染。
3. **数据一致性**：日期 UTC/北京语义混乱、`actualResults` 导入不排重、`currentResults` 无版本绑定。
4. **设计债**：`eval()` 加载模型（在 LAN 信任下风险降低，但仍建议替换）、Service Worker 缓存策略、Polymarket 请求风暴。

---

## 1. 关键假设说明

> **本审计基于用户明确声明：完全信任局域网内的访问。**
>
> 因此，以下问题在此版本中**不再作为 Critical/High 处理**，但仍在文档中保留为“LAN 信任下的可接受项”供未来若开放公网时参考：
> - `server.py` 默认绑定 `0.0.0.0`。
> - `/api/keys` 无额外认证（LAN 内可信）。
> - `data/api-keys.json` 可被 LAN 内机器访问。
> - CORS 放行私有网段 / `compute-server.js` 使用 `*`。
> - 静态文件服务器未禁用目录列表。
>
> 如果未来服务需要暴露到公网或不可信网络，这些项需要重新提升为 Critical。

---

## 2. 仍需优先修复的问题

### 2.1 Critical / 最高优先级（模型正确性 & 进程崩溃）

#### P1. `renderProbabilities` 把“进入决赛”列错填为“夺冠”概率
- **位置**: `index.html:2433`
- **现象**: 第二列（Final）和第一列（Champion）都使用了 `cp`。
- **影响**: UI 上决赛概率永远等于夺冠概率，明显误导用户。
- **修复**: 决赛列改为 `fp.toFixed(1)%`。

#### P2. MD3 激励阈值日期写错
- **位置**: `model/monte-carlo.js:137,145`
- **现象**: `MD3_DATE = '2026-06-24'`，但 `data/matches.js` 中 MD3 实际从 `2026-06-25` 开始。
- **影响**: 2026-06-24 的 4 场 Matchday 2 比赛（葡萄牙-乌兹别克、英格兰-加纳等）被错误应用 MD3 激励因子，可能改变模拟比分和小组排名。
- **修复**: `const MD3_DATE = '2026-06-25';`

#### P3. Isotonic 校准只拟合不应用
- **位置**: `model/stats.js:331-345`, `model/dixon-coles.js:195-200`, `compute-server.js:291`
- **现象**: `runReevaluate` 调用 `fitAndCacheCalibration`，但 `getBlendedProbs` 流水线从未调用 `calibrateProbs`。
- **影响**: UI 显示“校准已激活”，但所有预测概率实际未经过校准，ECE/可靠性图只是装饰。
- **修复**: 在 `getBlendedProbs` 最后应用 `WC26.calibrateProbs(probs.win, probs.draw, probs.loss)`。

#### P4. 动态 form 计算出来但预测时未使用
- **位置**: `compute-server.js:100,132,228`
- **现象**: `calculateDynamicForm(actualResults)` 的结果 `formMap` 仅返回前端展示；`getBlendedProbs` 实际使用的是静态 `preFormMap`。
- **影响**: 近期比赛状态对预测无影响，模型准确性受损。
- **修复**: 预测时传入 `formMap`，或设置 `WC26._dynamicFormMap = formMap` 让 `getForm` 优先读取。

#### P5. `compute-server.js` `JSON.parse` 未捕获异常，非法请求导致崩溃
- **位置**: `compute-server.js:660-663`
- **现象**: `req.on('end', async () => { const input = JSON.parse(body); ... })` 在 try 块外。
- **影响**: 任何非 JSON body 都会抛出未捕获异常，Node 进程可能崩溃。
- **修复**: 加 try-catch，返回 400 `INVALID_JSON`。

#### P6. POST body 无大小限制
- **位置**: `compute-server.js:660-662`, `server.py:114-115,142-143,165-166`
- **影响**: 超大 JSON 可耗尽内存，造成 OOM/DoS。
- **修复**: Node 侧限制 1MB；Python 侧根据 `Content-Length` 上限拒绝。

---

### 2.2 High（状态污染 / 数据一致性 / 稳定性）

#### H1. `customOdds` 永久污染全局 `TEAMS`
- **位置**: `compute-server.js:82-85`
- **现象**: `runSimulation` 把 `customOdds` 写入 `TEAMS[team].odds` 后从不恢复。
- **影响**: 一次请求的自定义赔率泄漏到后续所有请求；并发时互相污染。
- **修复**: 在 `withPreTournamentElo` 前后保存/恢复 odds，或对 `TEAMS` 做深拷贝。

#### H2. `customOdds` 原型污染风险
- **位置**: `compute-server.js:82-85`, `index.html:3426,3434`
- **现象**: `if (TEAMS[team]) ...` 未使用 `Object.hasOwn()`，`__proto__` 等键会命中 `Object.prototype`。
- **影响**: 恶意赔率数据可污染所有对象原型。
- **修复**: 所有 `TEAMS` 键访问改用 `Object.hasOwn(TEAMS, team)`。

#### H3. 并行 Monte Carlo 路径忽略 `customOdds`
- **位置**: `compute-server.js:544-600`
- **现象**: `runMonteCarlo` 只传 `actualResults`、`marketOdds`、`savedElo`、`optimalT` 给 worker，未传 `customOdds`。
- **影响**: 大 N 并行 MC 与小 N 单线程结果不一致。
- **修复**: 把 `customOdds` 加入 `workerData`，worker 启动后按主进程逻辑应用。

#### H4. MC worker 缺失市场交易量融合
- **位置**: `mc-worker.js:21-29` vs `compute-server.js:103`
- **现象**: 主进程设置 `WC26._allMarketVolumes`，worker 没有。
- **影响**: 并行 MC 与单线程 MC 使用不同的市场赔率权重，概率可能不一致。
- **修复**: worker 初始化时计算 `_allMarketVolumes`。

#### H5. `runReevaluate()` 直接修改入参缓存
- **位置**: `compute-server.js:294-309`
- **现象**: 直接给 `actualResults` 数组元素添加 `predicted`、`correct`、`probs` 等字段。
- **影响**: 污染 `cachedActualResults`，后续请求看到旧预测标记。
- **修复**: 返回新数组，不修改原对象。

#### H6. 第三名分配手写回溯，极端场景可能失败
- **位置**: `model/monte-carlo.js:70-99`
- **现象**: 代码已维护 `WC26.TPM` 495 组合矩阵，但 `buildKOBracket` 使用手写 `slots3` + 回溯。
- **影响**: 多队同分同净胜球时可能 `console.warn` 并产生不合规对阵。
- **修复**: 用 `thirdPlaceGroups` 8 字母 key 查 `TPM[key]` 得到官方分配；补充单元测试。

#### H7. `ensure_compute_server()` stdout 管道不消费
- **位置**: `server.py:44-47`
- **现象**: `subprocess.Popen(..., stdout=subprocess.PIPE, stderr=subprocess.STDOUT)` 后没有线程读取。
- **影响**: pipe 缓冲区满后 compute server 阻塞，`/api/compute` 无响应。
- **修复**: `stdout=subprocess.DEVNULL` 或启动守护线程持续读取。

#### H8. Monte Carlo `N` 无上限
- **位置**: `compute-server.js:546`
- **影响**: 单个请求可触发数亿次模拟，CPU/内存被占满。
- **修复**: `const N = Math.min(Math.max(parseInt(params.N) || 50000, 100), 500000);`

#### H9. `MATCHES` 开幕战日期与 `validateData` 断言不一致
- **位置**: `data/matches.js:7`, `index.html:3457`
- **现象**: `MATCHES[0][0]` 是 `'2026-06-12'`，但 `validateData` 断言应为 `'2026-06-11'`。
- **影响**: 每次加载控制台打印虚假 validation warning，反映 UTC/北京日期语义不统一。
- **修复**: 统一内部日期语义；若 `MATCHES` 存 UTC 日期，则改为 `'2026-06-11'`；若存北京日期，则变量名、注释、`getRho` 阈值都应调整。

#### H10. 前端保留独立 `predictOutcome` / `composite()`，逻辑与服务器分歧
- **位置**: `index.html:1307-1324`, `1400-1419`
- **现象**: 前端 `predictOutcome` 的平局判断与 `model/dixon-coles.js` 不完全一致；`composite()` 仍被 Radar fallback 使用。
- **影响**: UI 标签/雷达图与服务器计算结果可能不一致。
- **修复**: 删除前端副本，或确保完全复用服务器返回的字段。

#### H11. Polymarket 请求风暴
- **位置**: `index.html:2956-3122,3353-3378`
- **现象**: 自动刷新每 5 分钟；分页最多 5×100 events；resolved markets 对每个 token 串行请求 `prices-history`。
- **影响**: 单次同步可能发出数百请求，易被封 IP；UI 长时间阻塞。
- **修复**: 增加并发上限（如 p-limit=5）、指数退避、Page Visibility 后台暂停。

#### H12. `importResults()` 不排重
- **位置**: `index.html:3411-3420`
- **影响**: 重复导入产生多条相同赛果，隐藏旧记录影响统计/校准。
- **修复**: push 前按 `team1|team2` 去重。

#### H13. `buildActualResultsMap` 使用弱 hash 缓存
- **位置**: `model/monte-carlo.js:366-367`
- **现象**: 缓存 key 是结果数组的字符串拼接。
- **影响**: 理论碰撞风险；缓存未主动失效。
- **修复**: 每次 `runSimulation` 开始时清空缓存，或改用 SHA256。

#### H14. `currentResults` 无版本绑定
- **位置**: `index.html:1872`, `compute-server.js:621`
- **现象**: 服务器返回 `_hash`，但前端未存储/比对。
- **影响**: 服务器模型更新后前端仍展示旧结果。
- **修复**: 保存 `_hash`，每次请求后比对，变化时自动重算。

#### H15. `runFull` 的 `_hash` 不是内容 hash
- **位置**: `compute-server.js:621`
- **现象**: `_hash = `${ar.length}|${Object.keys(mo).length}|${Date.now()}` ``。
- **影响**: 同内容每次 hash 不同，无法用于版本比对；不同内容也可能 collision。
- **修复**: 对 `actualResults` 与 `marketOdds` 做稳定 JSON + SHA256。

---

### 2.3 Medium（设计债 / 可维护性）

| # | 问题 | 位置 | 建议修复 |
|---|---|---|---|
| M1 | Dixon-Coles τ 函数极端 λ 下可能为负 | `model/stats.js:46-52` | 所有 τ 分支加 `Math.max(0, tau)` |
| M2 | 日期字符串比较 | `model/elo.js:18`, `model/dixon-coles.js:42` | 统一封装 `parseMatchDate()` 用 Date 对象比较 |
| M3 | GBDT 冷启动前 14 场不参与 | `model/gbdt.js:170` | 在 UI 提示“GBDT 校准待激活”，或提供预训练 fallback |
| M4 | Elo 回归率默认 0.0 | `model/elo.js:70` | 确认业务决策，在 Model tab 明确标注 |
| M5 | `simulationHistory` 内存未受控 | `compute-server.js:527-531`, `mc-worker.js:46-50` | What-If 关闭时不存储详细历史，或限制长度 |
| M6 | `CODE_VER` 隐私模式循环刷新 | `index.html:3526-3538` | 使用 `sessionStorage` 或仅在有旧数据时才 reload |
| M7 | Service Worker 仍缓存 `/index.html` | `sw.js:3-7` | 从 `ASSETS` 移除 `/` 和 `/index.html`；给 `sw.js` 响应加 `Cache-Control: no-cache` |
| M8 | `clear.html` 清空全部 localStorage | `clear.html:5` | 只清除本项目相关 key，保留 `wc26_code_ver` 和 `wc2026_lang` |
| M9 | 魔法数字遍布 | `model/*.js`, `index.html` | 集中到 `WC26.CONFIG` |
| M10 | 前端 `WC26.buildActualResultsMap` 是死代码 | `index.html:1317-1324` | 删除，或直接使用服务器返回的 actualMap |
| M11 | `fetchMatchOdds()` h2h 解析错误 | `index.html:2918-2923` | 按 event home/away 把 outcomes 映射为 `{win,draw,loss}` |
| M12 | `showToast` 忽略 `type` 参数 | `index.html:1809` | 支持 error/success 样式或移除参数 |
| M13 | 长函数/巨型文件 | `index.html:2555-2658` | 拆分 `renderData` 为子函数 |
| M14 | 无单元测试 | `package.json:9` | 用 `node:test` 或 Jest 覆盖核心函数 |

---

### 2.4 Low（细节优化）

- `index.html:2517` 显示 Elo K=60/80，但 `CONFIG.ELO_K_BASE=30`、`ELO_K_KO_BONUS=15`（实际 30/45），文案与配置不一致。
- 多处死代码桩函数：`runBacktest()`、`computeBrierScores()`、`getCalibrationStats()` 直接返回 `window._xxx`。
- 生产环境遗留大量 `console.log`。
- 缺少 CSP / SRI。
- `package.json` 测试脚本未覆盖 `compute-server.js` 语法检查。

---

## 3. LAN 信任下的可接受项（若未来开放公网需重新评估）

以下问题在“完全信任 LAN”前提下，安全影响可被接受，但仍建议作为硬ening 项记录：

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| L1 | `server.py` 默认绑定 `0.0.0.0` | `server.py:21` | LAN 内可接受；公网需改为默认 `127.0.0.1` |
| L2 | `/api/keys` 无认证 | `server.py:96-124` | LAN 内可接受；公网需加 token |
| L3 | `data/api-keys.json` 明文存储 | `data/api-keys.json`, `server.py:229-240` | LAN 内可接受；建议设置 `chmod 600` |
| L4 | `data/api-keys.json` 可被静态访问 | `server.py` | 见顶部“今天做”的止血项；即使 LAN 信任也建议限制 |
| L5 | CORS 放行私有网段 / `*` | `server.py:378-389`, `compute-server.js:646-648` | LAN 内可接受 |
| L6 | 静态服务器未禁用目录列表 | `server.py` | LAN 内可接受 |
| L7 | `the-odds-api` key 在 URL query 中 | `server.py:242-247` | 主要风险是日志/历史泄露，与 LAN/公网无关，建议改为 header |

---

## 4. 与 `PENDING-AUDIT.md` 的对照

| 编号 | 问题 | PENDING 标记 | 本报告结论 |
|---|---|---|---|
| A1 | localStorage TTL | ✅ 已修复 | 基本修复（仅 UI 警告） |
| **A2** | `currentResults` 无版本绑定 | 未修复 | ❌ 仍未修复（H14） |
| **A3** | 前端独立计算逻辑 | 部分修复 | ⚠️ 仍残留（H10） |
| A4 | 静默 catch | ✅ 已修复 | ⚠️ 部分残留 |
| B1/B2 | 日期格式 | ✅ 已修复 | ⚠️ UTC/北京语义仍混乱（H9） |
| **B3** | `buildActualResultsMap` hash 缓存 | 建议 | ❌ 未修复（H13） |
| C1 | `runSimulation` 9 次调用 | ✅ 已修复 | ✅ 已修复 |
| **C11** | Polymarket 请求无限速 | ❌ | ❌ 未修复（H11） |
| **E1** | τ 函数边界 | ❌ | ❌ 未修复（M1） |
| **E2** | Elo 回归参数 | 验证 | ⚠️ 仍为 0.0（M4） |
| **E3** | 第三名分配算法 | 验证 | ⚠️ 未加测试（H6） |
| **E4** | GBDT 冷启动 | 设计如此 | ⚠️ 文档需明确（M3） |
| **F1** | `eval()` 加载模型 | ❌ | ⚠️ LAN 信任下降低优先级，但仍建议替换 |
| **F2** | CORS 配置 | ❌ | ⚠️ LAN 信任下可接受 |
| **F3** | POST body 无大小限制 | ❌ | ❌ 未修复（P6） |
| **G5** | API Key 服务端存储 | 修复+验证 | ⚠️ 已实现但 localStorage 仍有 fallback |

---

## 5. 建议修复顺序

### 第一步：今天完成（止血 + 模型正确性）
1. 修复 `renderProbabilities` 决赛列显示（P1）。
2. 修复 MD3 日期阈值（P2）。
3. 应用 Isotonic 校准到预测流水线（P3）。
4. 让动态 form 参与预测（P4）。
5. 给 `compute-server.js` 加 body 大小限制和 `JSON.parse` 异常处理（P5/P6）。
6. 限制静态文件访问 `data/api-keys.json`（即使 LAN 信任，也是良好实践）。

### 第二步：本周完成
7. 修复 `customOdds` 原型污染与 `TEAMS` 全局污染（H1/H2）。
8. 修复并行 MC 路径忽略 `customOdds`（H3）。
9. 同步 MC worker 市场交易量（H4）。
10. 修复 `runReevaluate` 修改入参缓存（H5）。
11. 第三名分配改用 TPM 矩阵 + 单元测试（H6）。
12. 修复 compute server stdout pipe 阻塞（H7）。
13. 限制 MC `N` 上限（H8）。
14. 统一日期语义（H9）。

### 第三步：近期完成
15. 删除/同步前端独立计算逻辑（H10）。
16. Polymarket 请求限速与可见性控制（H11）。
17. `importResults()` 排重（H12）。
18. 修复 `buildActualResultsMap` 缓存与 `currentResults` 版本绑定（H13/H14）。
19. 把 `runFull` `_hash` 改为内容 hash（H15）。
20. 处理 Medium/Low 项，补充单元测试。

---

## 6. 给下一个 AI 的交接说明

- 本审计基于 **LAN 信任前提**；修复时不应引入影响 LAN 可用性的过度安全限制（如默认 127.0.0.1、强制认证）。
- 优先修复 **P1-P6**（模型正确性 + 进程稳定性），这些与 LAN 假设无关。
- `eval()` 替换为 `require()` 是长期改进项，当前不阻塞功能，但能提升供应链安全。
- 所有修复应补充最小测试或手动验证步骤；建议优先为 `buildKOBracket`、`buildActualResultsMap`、`dixonColesTau`、`getBlendedProbs` 增加单元测试。
