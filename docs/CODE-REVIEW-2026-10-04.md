# media-mcp 代码审核报告

- 审核对象：`@avclabs.ai/media-mcp@0.3.0`，基线提交 `79e9885`（`Fix review findings and harden tool I/O paths`）
- 审核时间：2026-10-04
- 审核范围：`src/` 全部 7 个文件（1258 行）、`tests/` 3 个文件、`scripts/check-release.mjs`、`.github/workflows/ci.yml`、`package.json` / `server.json` / `config.json`、README 双语文档
- 审核方式：静态阅读 **+ 构建产物直接调用 + 本地 mock 后端 + 真实 MCP stdio 客户端实测**
- 基线：`npm run build` 通过；`npm test` 28 passed / 0 failed；`npm run check:release` 通过；`tools/list` 返回 9 个工具

## 结论

上一轮（`docs/CODE-REVIEW.md`，2026-09-25）的 21 项问题**已修掉 18 项**，且修法都对：`src/tos.ts` + `src/tooling.ts` 抽出来了、`isError` 统一了、数值约束加上了、`config.json` 不再从 cwd 加载、TOS 字段改白名单、SSRF 防护上线、CI 有了。这一轮是真正的复查，不是重复上一轮。

**剩余 3 个 P1 + 4 个 P2，全部是上一轮没覆盖到的路径**。核心结论：轮询主路径已经可靠，但**状态查询工具和 SAM3 这两条旁路没跟上**——同一个失败在 sync 工具和 status 工具上给 Agent 的信号不一致，SAM3 的错误信封被当成"未知状态"。

---

## 一、问题清单

| # | 级别 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| 1 | **P1** | 状态查询工具命中终态 `failed` 时不设 `isError`，sync 工具却设 —— 同一失败两种信号 | `video:168-177` / `image:212-221` | ✅ 实测 |
| 2 | **P1** | SAM3 鉴权/业务错误被伪装成 `Unrecognized task status: null`，真实 message 丢失 | `sam3:159-168` | ✅ 实测 |
| 3 | **P1** | SAM3 等待预算被静默截断到 45s，README 推荐配置完全失效且无提示 | `tooling:86-87` / `sam3:181` | ✅ 推算 |
| 4 | P2 | `isPrivateIp` 漏 `100.64.0.0/10`，`100.100.100.200`（阿里云元数据）可被拉取 | `tos:102-122` | ✅ 实测 |
| 5 | P2 | `sam3_predict` 下载结果失败时丢 `task_id`，P1-7 只修了轮询路径 | `sam3:197` | ✅ 实测 |
| 6 | P2 | 仓库里两份 CODE_REVIEW 结论冲突，根目录那份已完全过期 | 根 `CODE_REVIEW.md` | ✅ 确认 |
| 7 | P2 | `.workbuddy/`（含一次性验证脚本 + agent 私有日志）已提交进公开仓库 | `.gitignore` | ✅ 确认 |
| 8 | P3 | README 与代码的 timeout 数字全线不一致（12 处写 50，代码是 45） | `README.md` | ✅ 确认 |
| 9 | P3 | `--config` / `--image-base-url` / `IMAGE_API_BASE_URL` 零文档 | `server.ts` | ✅ 确认 |
| 10 | P3 | `server.ts` 两处解析同一份 `args`，`--config` 预扫描只认第一个 | `server.ts:78-83,116-118` | ✅ 确认 |
| 11 | P3 | `decodeBase64Image` 不做魔数校验，`checkLocalFile` 做 —— 同一判断两条路径不一致 | `tos:83-96` | ✅ 确认 |
| 12 | P3 | `SAM3_SUCCESS_CODES = Set([0])` 无测试覆盖，后端改返回 200 即全链路失败 | `sam3:16` | ✅ 确认 |
| 13 | P3 | `src/` 33 处 `any`，含 8 处 `error: any` | 全 `src/` | ✅ 确认 |

---

## 二、P1 详述

### 1. [P1] 状态查询工具的 `isError` 与 sync 工具不一致

`registerTool`（`tooling.ts:20`）判定失败的唯一依据是 `result.success === false`：

```ts
const failed = typeof result === 'object' && result !== null && (result as { success?: unknown }).success === false;
```

而 `getTaskStatus`（`video-enhancement.ts:168-177`）的返回体**根本没有 `success` 字段**：

```ts
return { task_id, status, progress, video_url, error_message, created_at, updated_at };
```

实测（mock 后端返回 `status: 'failed'`）：

```
[get_task_status / failed]     isError = undefined | {"task_id":"task-failed","status":"failed","progress":40,"error_message":"GPU worker exploded"}
[enhance_video_sync / failed]  isError = true      | {"success":false, ... "status":"failed"}
```

同一个后端失败、同一个 `pollUntilTerminal` 家族的结果，sync 工具正确标了 `isError`，status 工具没标。**后果**：Agent 用 `get_task_status` 轮询（README:226 推荐的做法）时，任务失败会被当成一次成功的查询，`success` 字段缺省，只能靠模型自己读 `status`——而模型对 `status` 的注意力远低于 `success`。

**修法**（`video-enhancement.ts:168` 与 `image-enhancement.ts:212`）：

```ts
const status = classifyStatus(result.status);
return {
  success: status !== 'failed' && status !== 'unknown',
  task_id: result.task_id,
  ...
};
```

`tooling.ts` 已经导出了 `classifyStatus`，直接复用，不需要新抽象。

### 2. [P1] SAM3 的错误信封被当成未知状态

`getSam3Result`（`sam3.ts:159-168`）只检查响应是不是 object，**不解包信封**：

```ts
const data = response.data;
if (!data || typeof data !== 'object' || Array.isArray(data)) { throw ... }
return data;
```

于是 SAM3 返回标准错误信封 `{code: 401, message: 'invalid api key'}` 时：`data.status` 是 `undefined` → `classifyStatus(undefined)` 返回 `'unknown'` → `normalizeSam3Status` 报 `Unrecognized task status: null`。

实测：

```
[get_sam3_task_status / 鉴权失败] isError = true
| {"success": false, "task_id": "whatever", "status": "unknown", "error": "Unrecognized task status: null"}
```

`invalid api key` 这个唯一有用的信息被丢掉了。Agent 拿到的是"后端返回了我不认识的状态"——**这是最容易误导人的一种错误**：真实原因是 key 无效/额度耗尽/网络不通，而提示说的是状态字段异常，Agent 很可能去反复重试。

`normalizeSam3Status` 走 `unwrapEnvelope` 就能解决。同一个仓库里 enhance 侧已经用了（`video:163`），SAM3 侧没有——这是上一轮 P2-9「三套 TOS 契约不一致」的残留：TOS 统一了，**信封没统一**。

**修法**：

```ts
async function getSam3Result(client: AxiosInstance, taskId: string): Promise<any> {
  const response = await client.get(`/predict/result/${encodeURIComponent(taskId)}`, {
    timeout: POLL_REQUEST_TIMEOUT_MS,
  });
  const unwrapped = unwrapEnvelope(response, SAM3_SUCCESS_CODES);
  if (!unwrapped.ok) throw new Error(unwrapped.error);
  if (typeof unwrapped.data?.status !== 'string') {
    throw new Error(`Task status response missing "status": ${JSON.stringify(unwrapped.data).slice(0, 200)}`);
  }
  return unwrapped.data;
}
```

注意：`unwrapEnvelope` 对**成功信封**会返回 `body.data`，所以要确认 `/predict/result` 成功时到底返回的是 `{code:0,data:{status:...}}` 还是裸 `{status:...}`。**这一点本轮没有线上后端可验证**，落地前需实测一次——这也正好把 P3-12 的测试补上。

### 3. [P1] SAM3 等待预算被静默截断，README 推荐配置无效

`pollUntilTerminal`（`tooling.ts:86-87`）硬性 clamp：

```ts
const timeoutSeconds = clampNumber(params.timeoutSeconds, 1, 45, 45);
const intervalMs = clampNumber(params.pollIntervalSeconds, 0.5, 30, 5) * 1000;
```

而 `sam3PredictTool`（`sam3.ts:181`）传入的是自己算的预算：

```ts
timeoutSeconds: (pollInterval * pollMaxAttempts) / 1000,
pollIntervalSeconds: pollInterval / 1000,
```

三个数字互不咬合，实测：

| 配置 | 声明预算 | 实际生效 |
|---|---|---|
| 默认（2000ms × 25） | 50s | **45s** |
| README:516 推荐的 `SAM3_POLL_MAX_ATTEMPTS=60` | 120s | **45s** |
| `SAM3_POLL_INTERVAL_MS=60000` | 60s | interval 被 clamp 到 **30s**，总预算仍 **45s** |

也就是说 **README 亲手推荐的调参姿势（`SAM3_POLL_MAX_ATTEMPTS=60`，理由是"SAM3 任务通常 10 秒内完成"）现在完全是空操作**——用户改完没有任何变化，也没有任何提示说参数被吃掉了。

45s 这个上限本身是对的（给 MCP 的 60s 线留返回余量），问题在于 **SAM3 的预算由两个 env 相乘得出，而 clamp 是单值的**，两者语义不匹配。

**修法**（二选一，推荐前者）：

- **A**：`pollUntilTerminal` 的 `timeoutSeconds` 上限提到 60（SAM3 单独走一个上限更高的入口，或加 `maxTimeoutSeconds` 参数），让 `pollInterval × pollMaxAttempts` 真正生效；
- **B**：SAM3 不再自己乘，改成显式传 `timeoutSeconds: 45`，并在 `parsePositiveInt` 那层就对 `pollMaxAttempts` 做**乘积感知**的 clamp——即 `sam3PollMaxAttempts = min(userValue, floor(45000 / sam3PollInterval))`，超限时在 `console.error` 打一行说明。

B 更符合这个项目「不让静默截断」的既定风格，改动也小。

---

## 三、P2 详述

### 4. [P2] SSRF 防护漏 `100.64.0.0/10`

`tos.ts:102-122` 的 `isPrivateIp` 覆盖了 loopback / RFC1918 / link-local / `a >= 224`，但漏了 CGNAT 段。实测：

```
100.100.100.200 -> private? false     ← 阿里云 ECS 元数据服务
100.64.0.1      -> private? false     ← CGNAT / Tailscale / 部分云内部
198.18.0.1      -> private? false     ← 网络基准测试段
```

`assertPublicHttpUrl('http://100.100.100.200/latest/meta-data/')` **放行**。这个 MCP server 跑在用户机器上，被 Agent 用它拉内网/元数据端点是一条真实的探测链。

顺带两点：
- **IPv6 是歪打正着挡住的**。`URL.hostname` 对 IPv6 字面量保留方括号（`[::1]`），`net.isIP('[::1]')` 返回 `0`，于是走 `dns.lookup('[::1]')` → `ENOTFOUND` → 报错。**结果是对的，机制是错的**——加一条 IPv6 记录或换个 DNS 解析方式就会漏。应在 `net.isIP` 前先 `hostname.replace(/^\[|\]$/g, '')`。
- `198.18.0.0/15` 和 `192.0.0.0/24`（IETF 协议保留）也漏了。

### 5. [P2] `sam3_predict` 下载结果失败时丢 `task_id`

P1-7 修了轮询路径（`pollUntilTerminal` 的三个失败出口都带 `task_id`），但 `sam3PredictTool` 最后一跳没跟上（`sam3.ts:193-198`）：

```ts
const resultJson = await downloadSam3Result(taskResult.result_url);
return JSON.stringify(resultJson, null, 2);
```

`downloadSam3Result` 抛错 → 冒泡到 `registerTool` → 包装成 `{success:false, error:'Invalid URL'}`，`task_id` 消失。实测：

```
pollUntilTerminal 返回: {"success":true,"task_id":"task-abc","status":"completed"}
downloadSam3Result 抛错 -> Invalid URL
registerTool 包装成: {"success":false,"error":"Invalid URL"}
>>> task_id 丢失，Agent 无法继续查询已完成的 task-abc
```

触发条件：SAM3 返回 `status: 'completed'` 但 `result` 字段为空或非 URL。任务**已经完成并计费**，Agent 却拿到一个"失败"且无句柄的响应。修法：把 task_id 带进 catch，或在 `downloadSam3Result` 前显式检查 `result_url` 非空并给出带 task_id 的错误。

### 6. [P2] 两份 CODE_REVIEW 结论冲突

- 根目录 `CODE_REVIEW.md`（**未提交**，2026-10-03）：针对的是 `src/upload.ts` 架构，那个文件在 `79e9885` 已被 `tos.ts` 取代。文中所有行号、文件引用全部失效。
- `docs/CODE-REVIEW.md`（已提交，2026-09-25）：针对上一轮，21 项里已修 18 项。

现在根目录那份既不过时也不完整，和 `docs/` 那份并存会让下一个读代码的人（或 agent）拿到错的结论。**建议删除根目录那份**，后续 review 统一追加到 `docs/CODE-REVIEW.md` 的「历次审核」小节，或按日期命名归档。

### 7. [P2] `.workbuddy/` 混进了公开仓库

`79e9885` 提交了两个文件：

```
.workbuddy/e2e-check.mjs          一次性 E2E 验证脚本（mock 后端 + stdio 客户端）
.workbuddy/memory/2026-09-25.md   agent 私有工作日志
```

`e2e-check.mjs` 本身是**好代码**（值得保留并纳入 `tests/`），但它现在藏在 `.workbuddy/` 下，CI 不跑、`.npmignore` 没提、`files` 白名单没提。而 `memory/*.md` 是 agent 的工作记忆，属于内部笔记，不该进 npm 公开仓库（`files` 白名单挡住了打包，但 **git 历史里已经在了**）。

`.gitignore` 加一行 `.workbuddy/`。`e2e-check.mjs` 挪到 `scripts/` 或 `tests/e2e/` 并挂进 CI。

---

## 四、P3 清单

| 项 | 位置 | 说明 |
|---|---|---|
| README timeout 数字 | `README.md:177-179,183-185,260,266,276,310,330,351,455,510,512` | 12 处写 "50 seconds"，代码 schema 是 `min(1).max(45).default(45)`。文档承诺比代码能力大 5 秒以上，且 SAM3 实际只有 45s。README 是给 Agent 读的契约文件，这里的偏差会直接导致 Agent 给出错误预期。 |
| 新配置项零文档 | `server.ts:79,93,101,116` | `--config`、`--image-base-url`、`IMAGE_API_BASE_URL` 在 README 里 grep 不到任何匹配。`docs/RELEASE.md` 专门提了 `IMAGE_API_BASE_URL`「已新增」，但用户从 README 找不到。`config.json` 又是 `files` 白名单成员（会打包发布），用户改它需要知道有 `--config` 存在。 |
| `args` 双重解析 | `server.ts:78-83` + `97-119` | 第一个循环 `break` 找 `--config`，第二个循环再走一遍全量参数。功能正确但两处解析同一份数组，加参数时容易只改一处。合并成一个循环即可。 |
| base64 不校验魔数 | `tos:83-96` | `checkLocalFile` 做扩展名 + 魔数双校验，`decodeBase64Image` 只解码不校验。同一个「这是不是合法图片」的判断，路径 A 严路径 B 松。补 4 行 `MAGIC_SIGNATURES` 复用即可。 |
| `SAM3_SUCCESS_CODES` 无覆盖 | `sam3:16` | `Set([0])` 是硬编码的协议假设，13 个 `unwrapEnvelope` 测试全用默认 `{0,200}`。哪天 SAM3 改成返回 200，`sam3_predict` 全链路静默失败。补一条 `unwrapEnvelope(x, SAM3_SUCCESS_CODES)` 的断言成本极低。 |
| 类型松散 | 全 `src/` | 33 处 `any`：8 处 `error: any`（靠鸭子类型读 `.response`）、`PollParams.handler: (args: any)`、`parseTosSignature(signatureData: any)`。`tsconfig` 已开 `strict` 但没开 `noUncheckedIndexedAccess`。不阻塞发布，但下一个人加字段时没有任何类型兜底。 |

---

## 五、这轮没做但值得排期的

1. **`get_task_status` 的 `progress` 语义**：`result.progress ?? 0` 把"后端没返回 progress"和"进度 0"混为一谈。README:222 声明了 progress 字段，但没说什么是 0、什么是缺失。
2. **`uploadToTos` 的流清理**：现在签名先拿、再 `createReadStream`，`uploadToTos` 内部 axios/form-data 会接住流错误（实测 ENOENT 被正常包装成 `TOS upload failed: ENOENT...`，进程存活）——**上一轮的 P2 流竞态已修复**。但流在失败路径上是否被显式 destroy 仍未验证，Node 会等 GC。
3. **`npm pack` 内容未核对**：`files` 白名单是 5 项，但 `scripts/` 被 `.gitignore` 排除（只保留 `check-release.mjs`）而 `files` 又没包含它——发布包里没有 `check-release.mjs`，那 `release:verify` 在 tarball 里跑不了。`release:verify` 里含 `npm pack --dry-run`，建议在 CI 里加一步「解包 tarball 后在其中跑 `npm test`」，验证发布物自洽。

---

## 六、审核范围外

- 后端 `media-mcp-api-http-server`、外部 SAM3 服务、Portal 三仓库不在本次范围。
- 未做线上联调（无有效 API Key），网络行为均以本地 mock 验证。**因此 P1-2 的修法依赖一个未验证的前提**：`/predict/result` 成功时是否返回 `{code:0,data:{status}}` 信封。落地前必须实测。
- 未审计 npm 依赖供应链（`npm audit` 在 `release:verify` 里）。

## 七、建议修复顺序

**第 1 批（都是小改动，1-3 行）**

1. P1-1 状态工具加 `success` 字段（2 处，复用 `classifyStatus`）
2. P1-2 `getSam3Result` 解包信封 —— **先实测确认成功响应的形状**
3. P1-3 SAM3 预算改成乘积感知 clamp（`server.ts` 的 `parsePositiveInt` 调用处）
4. P2-5 `sam3_predict` 最后一跳带上 `task_id`

**第 2 批（安全与卫生）**

5. P2-4 `isPrivateIp` 补 `100.64.0.0/10` / `198.18.0.0/15`；IPv6 去括号
6. P2-7 `.gitignore` 加 `.workbuddy/`；`e2e-check.mjs` 挪进 `scripts/` 并挂 CI
7. P2-6 删根目录 `CODE_REVIEW.md`
8. P3 README timeout 数字 50 → 45；补三个新配置项文档；合并 `args` 双重解析
9. P3 `decodeBase64Image` 补魔数校验；补 `SAM3_SUCCESS_CODES` 测试
