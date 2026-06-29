# 🔍 代码审查提示词

将以下内容复制给审查者（人类或 AI），配合 `git diff b5d168e..7b13153` 使用。

---

## 审查背景

这是 2026 世界杯预测器项目的一次全面审计修复。项目架构：

```
index.html (前端) → server.py (:9090) → compute-server.js (:9091) → mc-worker.js
```

**前提**：完全信任局域网访问，因此与 LAN 暴露相关的安全问题不在本次修复范围内。

---

## 审查重点（按优先级）

### 1. 模型正确性（最关键）

**P1 — renderProbabilities 决赛列**
- 文件：`index.html:2432-2433`
- 改动：决赛列从 `cp`（夺冠概率）改为 `fp`（决赛概率），末列从 `qp` 改为 `rp`
- 审查点：确认列顺序与表头 `[Champion, Final, Semi, Quarter, R16]` 一致

**P2 — MD3 日期阈值**
- 文件：`model/monte-carlo.js:137`
- 改动：`MD3_DATE` 从 `'2026-06-24'` 改为 `'2026-06-25'`
- 审查点：确认 `data/matches.js` 中 MD3 确实从 6月25日 开始

**P3 — Isotonic 校准应用**
- 文件：`model/gbdt.js:202-204`
- 改动：`getBlendedProbs` 温度缩放后增加 `calibrateProbs` 调用
- 审查点：
  - `calibrateProbs` 在 `WC26.isotonicCalibration` 未设置时是否安全跳过
  - `runSimulation` 中是否正确加载校准缓存

**P4 — 动态 form 参与预测**
- 文件：`compute-server.js:runSimulation`
- 改动：所有 `preFormMap` 替换为 `formMap`（动态计算的球队状态）
- 审查点：
  - `WC26.getForm` 是否有 fallback 到静态 form 的逻辑
  - KO 阶段（`runKORound`、`simKO`）是否也正确使用了 `formMap`

### 2. 进程稳定性

**P5/P6 — 请求防护**
- 文件：`compute-server.js:662-680`、`server.py` 多处
- 改动：
  - Node: 1MB body 限制 + `JSON.parse` try-catch
  - Python: 所有 POST 入口加 `Content-Length` 检查
- 审查点：
  - body 超限时 `req.destroy()` 后是否还会发送响应
  - Python 的 `413` 响应格式是否与 Node 一致

**H7 — stdout pipe 阻塞**
- 文件：`server.py:44-45`
- 改动：`stdout=subprocess.PIPE` → `stdout=subprocess.DEVNULL`
- 审查点：是否有地方需要读取 compute server 的 stdout

**H8 — MC N 上限**
- 文件：`compute-server.js`
- 改动：`Math.min(Math.max(parseInt(params.N) || 50000, 100), 500000)`
- 审查点：上限 500,000 是否合理（考虑内存和 CPU）

### 3. 状态污染

**H1 — customOdds TEAMS 污染**
- 文件：`compute-server.js:runSimulation`、`runMonteCarloSingle`
- 改动：应用 customOdds 前保存原值，finally 块中恢复
- 审查点：
  - `savedOdds` 是否覆盖所有被修改的 team
  - finally 块是否在异常时也能正确恢复

**H2 — 原型污染**
- 文件：`compute-server.js`、`index.html`
- 改动：`TEAMS[team]` → `Object.hasOwn(TEAMS, team)`
- 审查点：是否遗漏了某些 TEAMS 键访问点

**H3/H4 — MC worker 数据同步**
- 文件：`mc-worker.js`
- 改动：
  - `workerData` 增加 `customOdds`
  - worker 内应用 customOdds（含 save/restore）
  - worker 初始化 `_allMarketVolumes`
- 审查点：
  - worker 的 `savedCustomOdds` 恢复逻辑是否正确
  - `_allMarketVolumes` 计算是否与主进程一致

**H5 — runReevaluate 缓存污染**
- 文件：`compute-server.js:runReevaluate`
- 改动：`for (const r of actualResults) { r.xxx = ... }` → `actualResults.map(r => ({ ...r, xxx: ... }))`
- 审查点：返回的 `evaluated` 数组是否包含原数组所有字段

### 4. 数据一致性

**H6 — 第三名分配**
- 文件：`model/monte-carlo.js:buildKOBracket`
- 改动：手写 `slots3` + 回溯 → `WC26.TPM` 矩阵查找 + fallback
- 审查点：
  - `THIRD_INDICES = [1,3,5,6,7,9,11,13]` 是否正确映射 TPM 位置到 bracket 索引
  - fallback 逻辑是否保留了原有行为
  - `tpmKey` 排序是否正确（`qualified3.sort()`）

**H12 — importResults 去重**
- 文件：`index.html:importResults`
- 改动：push 前检查 `existing.has(key)`，key = `team1|team2`
- 审查点：是否应该也按 date 去重

**H15 — runFull 内容 hash**
- 文件：`compute-server.js:runFull`
- 改动：`Date.now()` → `SHA256(JSON.stringify(ar) + JSON.stringify(mo))`
- 审查点：
  - `JSON.stringify` 对相同内容是否保证相同输出（无循环引用时是的）
  - hash 截取前 16 字符是否足够避免碰撞

### 5. Polymarket 限速

**H11 — 请求限速**
- 文件：`index.html:rateLimitedFetch`
- 改动：
  - 最小间隔 300ms
  - 429 状态码指数退避（1s → 2s → 4s）
  - Page Visibility API 暂停
- 审查点：
  - `FETCH_DELAY_MS = 300` 是否过于保守或过于激进
  - Page Visibility 暂停后恢复是否有竞态条件

### 6. Medium 项

**M1 — τ 函数边界**
- 文件：`model/stats.js:dixonColesTau`
- 改动：所有 return 值加 `Math.max(0, ...)`
- 审查点：0-0 分支 `1 - lh*la*rho` 在极端参数下是否应该返回 0（而非负数）

**L4 — 静态文件访问限制**
- 文件：`server.py:_is_blocked_path`
- 改动：阻止 `.git`、`api-keys.json`、隐藏文件的静态访问
- 审查点：
  - 是否误伤了正常文件（如 `.css`、`.js`）
  - `do_HEAD` 是否也需要保护

---

## 快速验证命令

```bash
# 语法检查
npm test

# 启动服务器
python3 server.py &
sleep 3

# 测试 simulation
curl -s -X POST http://localhost:9091/compute \
  -H "Content-Type: application/json" \
  -d '{"action":"simulation","params":{}}' | jq '.ko.Champion'

# 测试 JSON 错误处理
curl -s -X POST http://localhost:9091/compute \
  -H "Content-Type: application/json" \
  -d 'invalid json' | jq '.type'

# 测试静态文件访问限制
curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/data/api-keys.json
curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/.git/config
curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/index.html
```

---

## diff 命令

```bash
git diff b5d168e..7b13153 --stat
git diff b5d168e..7b13153
```
