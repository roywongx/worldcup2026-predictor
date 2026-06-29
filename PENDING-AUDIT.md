# 🔍 待审计清单 — 供其他 AI 代理进一步检查

**创建时间**: 2026-06-29
**当前状态**: 核心功能已修复，以下问题需要更深入审查

---

## 架构级问题（需重构）

### A1. localStorage 无 TTL 机制
**文件**: `index.html:1817-1826` (loadState)
**问题**: localStorage 存储的市场赔率、概率趋势、校准数据无过期时间。用户数小时后返回仍显示旧数据，无任何提示。
**建议**: 给每个存储字段加时间戳，超时后显示 "数据可能过期" 警告。

### A2. currentResults 全局变量无版本绑定
**文件**: `index.html:1872`
**问题**: `currentResults` 是全局变量，缓存服务器计算结果。服务器代码更新后，旧的 `currentResults` 仍然有效，直到下次 `runSimulation()` 被调用。
**建议**: 给服务器返回值加 `_hash`（代码版本 + 数据 hash），前端检测变化时自动重算。

### A3. 前端有独立计算逻辑（可能与服务器分歧）
**文件**: `index.html:1386-1405` (composite), `index.html:1914-1923` (RPS), `index.html:1293` (predictOutcome)
**问题**: 前端定义了自己的 `composite()`、RPS 计算、`predictOutcome()`，可能与服务器的计算逻辑不一致。
**建议**: 删除前端独立计算，所有数值从服务器获取。

### A4. 7 处静默 catch(e){}
**文件**: `index.html` 多处
**问题**: 错误被吞掉，用户不知道操作失败。关键位置:
- `runSimulation()` (已修复，加了 showToast)
- `runMonteCarloUI()` line 2260
- `refreshData()` line 3335-3341
- Init IIFE line 3521-3523
- `fetchPolymarketMatchOdds()` line 3070
- `loadState()` line 1825
- `saveState()` line 1846
**建议**: 所有 catch 块加 `showToast('Error: '+e.message,'error')` 或 `console.error`。

---

## 数据一致性问题

### B1. 日期格式不统一
**问题**: 不同数据源使用不同日期格式:
- MATCHES 数组: `'2026-06-12'` (北京时间)
- 种子数据: `'2026-06-11T00:00:00Z'` (UTC)
- ALT API: `'2026-06-11'` (UTC 日期)
- Polymarket: `'2026-06-10T01:23:07.16103Z'` (ISO)
**当前处理**: `buildActualResultsMap` 存无日期回退 key。但日期特定查找仍可能失败。
**建议**: 统一所有日期为北京时间字符串 `'YYYY-MM-DD'`。

### B2. auto-fetch 存储结果缺少 date 字段
**文件**: `index.html:3510`
**问题**: 部分路径存储结果时没有 `date` 字段，导致 `buildActualResultsMap` 只能用无日期 key。
**当前处理**: 已修复，添加了 `date:m.date||''`。
**验证**: 确认所有存储路径都有 date 字段。

### B3. buildActualResultsMap 缓存可能过期
**文件**: `model/monte-carlo.js:367`
**问题**: 服务器端 `buildActualResultsMap` 有 hash 缓存。如果 hash 碰撞（理论上不太可能），会返回旧数据。
**建议**: 每次 `runSimulation` 调用时清除缓存，或用更强的 hash。

---

## 竞态条件

### C1. runSimulation 被调用 9 次
**文件**: `index.html` 多处
**调用点**:
1. Init IIFE (line 3520)
2. "New Simulation" 按钮 (line 1213)
3. Radar re-evaluate (line 2625)
4. fetchResults (line 2842)
5. syncPolymarketData (line 3293)
6. refreshData (line 3339)
7. addResult (line 3353)
8. importResults (line 3365)
9. applyCustomOdds (line 3375)
**当前处理**: `_simBusy` 锁防止并发。
**验证**: 确认锁在所有路径都有效（特别是 async/await 边界）。

### C2. Radar 按钮 fire-and-forget
**文件**: `index.html:2625`
**问题**: `onclick="reevaluateResults();mcResults=null;runSimulation();renderAll()"` — 不等待异步操作。
**当前处理**: 已修复为 `.then()` 链。
**验证**: 确认修复后不再有竞态。

---

## Service Worker 缓存

### D1. Service Worker 文件本身被浏览器缓存
**问题**: 浏览器缓存 sw.js 文件，更新后可能数小时不生效。
**当前处理**: 改了缓存名 (v1→v2)，index.html 设为网络优先。
**验证**: 确认用户刷新后能加载最新代码。

### D2. 版本检测机制
**文件**: `index.html:3511-3522`
**问题**: 使用 `localStorage.wc26_code_ver` 检测代码版本。如果用户手动清除 localStorage，版本信息丢失。
**当前处理**: 首次加载时设置版本，后续检查。
**验证**: 确认清除 localStorage 后不会进入无限刷新循环。

---

## 计算正确性

### E1. Dixon-Coles τ 函数边界
**文件**: `model/stats.js:47`
**问题**: 当 `lh*la` 很大时（>5），τ(0,1) 或 τ(1,0) 可能为负数。虽然实际比赛中 λ 很少超过 2.5，但理论上存在。
**建议**: 添加 `Math.max(0, tau)` 保护。

### E2. Elo 回归均值参数
**文件**: `model/elo.js:70`
**问题**: `rebuildDynamicElo` 使用默认 `regressRate=0.0`。如果设为非零值，Elo 会向初始值回归。
**验证**: 确认当前使用 `regressRate=0.0`（不回归）是否符合预期。

### E3. 第三名分配算法
**文件**: `model/monte-carlo.js:70-99`
**问题**: 使用贪心算法 + 回溯。某些边缘情况下可能分配失败（console.warn）。
**验证**: 用极端分组结果测试（所有第三名 3 分、相同净胜球）。

### E4. GBDT 模型冷启动
**文件**: `model/gbdt.js`
**问题**: `trainAndBlendGBDT` 需要 ≥15 场实际结果才激活。前 14 场比赛时 GBDT 不参与预测。
**验证**: 确认冷启动时 DC 模型的预测质量。

---

## 安全问题

### F1. eval() 加载模型文件
**文件**: `compute-server.js:17-23`
**问题**: 使用 `eval(fs.readFileSync(...))` 加载 7 个模型文件。如果文件被篡改，任意代码执行。
**风险**: 低（本地服务器，文件由开发者控制）。
**建议**: 改用 `require()` 或 `import()`。

### F2. CORS 配置
**文件**: `server.py:109-113`
**问题**: 允许所有 Origin 的 CORS 请求。本地开发没问题，但如果暴露到公网有风险。
**建议**: 限制为 `localhost` 和 `127.0.0.1`。

### F3. POST 请求无 body 大小限制
**文件**: `compute-server.js:656`
**问题**: `req.on('data', chunk => body += chunk)` 无大小限制。恶意请求可发送巨大 body。
**风险**: 低（本地服务器）。
**建议**: 添加 1MB body 大小限制。

---

## 待验证的具体修复

### G1. simMatch/simKO 改用 getStoredMarketOdds
**修复**: `model/dixon-coles.js:239,247`
**验证**: 用不同日期格式的赔率数据测试，确认 MC 模拟能正确融合市场赔率。

### G2. runEV 支持淘汰赛
**修复**: `compute-server.js:388-436`
**验证**: 确认淘汰赛 EV 显示正确（小组赛已完赛后仍有数据）。

### G3. buildActualResultsMap 无日期回退 key
**修复**: `model/monte-carlo.js:380-385`
**验证**: 用 UTC 和北京时间两种格式的赛果测试，确认都能正确查找。

### G4. 淘汰赛 actual 标记
**修复**: `compute-server.js:234`
**验证**: 确认实际结果有 `actual:true`，预测结果没有。UI 显示绿色锁定。

### G5. API Key 服务端存储
**修复**: `server.py` + `index.html`
**验证**: 确认 key 保存在 `data/api-keys.json`，重启后仍有效，不上传到 GitHub。

---

## 审计方法建议

1. **数据流追踪**: 从 API 获取到 UI 显示，逐步追踪每个数据字段的转换
2. **边界条件测试**: 空数据、单条数据、全部完成、重复比赛
3. **竞态测试**: 快速点击多个按钮，观察数据一致性
4. **缓存测试**: 修改服务器代码后，确认前端自动更新
5. **计算验证**: 对比服务器和前端的计算结果，确认一致
6. **安全审查**: 检查 XSS、注入、敏感信息泄露
