# 🔧 审计修复日志

**修复日期**: 2026-06-29  
**修复 commit**: `7b13153`  
**审计报告**: [AUDIT-2026-06-29-LAN-TRUSTED.md](./AUDIT-2026-06-29-LAN-TRUSTED.md)

---

## 第一步：模型正确性 + 进程稳定性（全部完成 ✅）

| # | 问题 | 修复方案 | 文件 | 行号 |
|---|------|----------|------|------|
| P1 | `renderProbabilities` 决赛列错用 `cp` | 改为 `fp`，末列改为 `rp` | `index.html` | 2432-2433 |
| P2 | MD3 日期阈值错误 | `'2026-06-24'` → `'2026-06-25'` | `model/monte-carlo.js` | 137 |
| P3 | Isotonic 校准未应用 | `getBlendedProbs` 末尾调用 `calibrateProbs` | `model/gbdt.js` | 202-204 |
| P4 | 动态 form 未参与预测 | `preFormMap` → `formMap` | `compute-server.js` | runSimulation |
| P5 | `JSON.parse` 未捕获异常 | try-catch 返回 400 | `compute-server.js` | 665-670 |
| P6 | POST body 无大小限制 | 1MB 限制，超限返回 413 | `compute-server.js` + `server.py` | 多处 |

---

## 第二步：状态污染 + 数据一致性（全部完成 ✅）

| # | 问题 | 修复方案 | 文件 |
|---|------|----------|------|
| H1 | `customOdds` 污染全局 `TEAMS` | 保存/恢复 odds（finally 块） | `compute-server.js` |
| H2 | 原型污染风险 | 所有 `TEAMS` 键访问改用 `Object.hasOwn` | `compute-server.js` + `index.html` |
| H3 | 并行 MC 忽略 `customOdds` | `workerData` 加 `customOdds`，worker 内应用 | `compute-server.js` + `mc-worker.js` |
| H4 | MC worker 缺失 `_allMarketVolumes` | worker 初始化时计算 | `mc-worker.js` |
| H5 | `runReevaluate` 修改入参缓存 | `.map()` 返回新数组，不修改原对象 | `compute-server.js` |
| H6 | 第三名分配手写回溯 | 改用 `WC26.TPM` 矩阵 + fallback | `model/monte-carlo.js` |
| H7 | stdout pipe 不消费阻塞 | `stdout=subprocess.DEVNULL` | `server.py` |
| H8 | Monte Carlo `N` 无上限 | `Math.min(Math.max(N, 100), 500000)` | `compute-server.js` |
| H9 | `validateData` 虚假 warning | 开幕战日期修正为 `2026-06-12`（北京时间） | `index.html` |

---

## 第三步：前端同步 + Polymarket + 数据一致性（全部完成 ✅）

| # | 问题 | 修复方案 | 文件 |
|---|------|----------|------|
| H10 | 前端独立 `predictOutcome` | 已确认与服务器逻辑一致，保留 | `index.html` |
| H11 | Polymarket 请求风暴 | `rateLimitedFetch`：300ms 间隔 + 429 指数退避 + Page Visibility 暂停 | `index.html` |
| H12 | `importResults()` 不排重 | 按 `team1\|team2` 去重 | `index.html` |
| H13 | `buildActualResultsMap` 弱 hash 缓存 | 每轮 simulation 开始时清空缓存 | `compute-server.js` |
| H14 | `currentResults` 无版本绑定 | 存储 `_hash`，变化时 console.log | `index.html` |
| H15 | `runFull` `_hash` 不是内容 hash | 改为 `SHA256(JSON.stringify(ar) + JSON.stringify(mo))` | `compute-server.js` |

---

## Medium 项（已完成 ✅）

| # | 问题 | 修复方案 | 文件 |
|---|------|----------|------|
| M1 | τ 函数极端 λ 下可能为负 | 所有分支加 `Math.max(0, ...)` | `model/stats.js` |
| L4 | 静态文件可访问敏感路径 | `_is_blocked_path` 阻止 `.git`/`api-keys.json`/隐藏文件 | `server.py` |

---

## 未处理项（需后续决策）

| # | 问题 | 原因 |
|---|------|------|
| M2 | 日期字符串比较 | 需统一 UTC/北京语义，涉及全局重构 |
| M3 | GBDT 冷启动前 14 场不参与 | 设计如此，需产品决策 |
| M4 | Elo 回归率默认 0.0 | 需确认业务决策 |
| M5 | `simulationHistory` 内存未受控 | 需 What-If 功能设计 |
| M6 | `CODE_VER` 隐私模式循环刷新 | 需产品决策 |
| M7-M9 | SW 缓存 / clear.html / 魔法数字 | 设计债，非紧急 |
| M10 | 前端 `buildActualResultsMap` 死代码 | 可安全删除 |
| M11-M14 | h2h 解析 / showToast / 长函数 / 单元测试 | 需补充 |
| Low | Elo K 值文案 / 死代码 / console.log / CSP | 细节优化 |

---

## 验证结果

```
✓ server.py syntax OK
✓ All JS modules syntax OK
✓ compute-server.js syntax OK
✓ /compute simulation endpoint works
✓ Invalid JSON → 400 INVALID_JSON
✓ /data/api-keys.json → 403
✓ /.git/config → 403
✓ /index.html → 200
```
