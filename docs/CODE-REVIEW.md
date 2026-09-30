# media-mcp 代码审核报告

- 审核对象：`@avclabs.ai/media-mcp@0.3.0`（未发布候选），工作区 `E:/PycharmProjects/avc.ai/media-mcp`
- 审核时间：2026-09-25
- 审核范围：`src/`（5 个文件 1083 行）、`scripts/`、`tests/`、`package.json` / `server.json` / `config.json`、`tsconfig.json`、README 双语文档
- 审核方式：静态阅读 **+ 本地 mock 后端 + 真实 MCP stdio 协议实测**（`npm ci` 构建通过，`tools/list` 9 个工具齐备）
- 代码健康度基线：`npm run check:release` 通过；`npm test` 3 passed / 0 failed（但仅覆盖 4 行逻辑）

---

## 一、结论摘要

整体架构是干净的：stdio MCP server + 后端 HTTP client，三个工具组按域拆分，职责边界清楚，错误信封统一，文档诚实。**但这个项目最核心的那个卖点——「规避 MCP 调用 60 秒超时」——在最坏路径上并不成立，而这一点在实测里可以直接量出来。**

按严重度排序的问题清单：

| # | 级别 | 问题 | 位置 | 实测状态 |
|---|---|---|---|---|
| 1 | **P0** | `--api-key` 传不到 SAM3，CLI 装法下 SAM3 两个工具 100% 不可用 | `server.ts:49` | ✅ 已复现 |
| 2 | **P0** | 所有工具失败都返回 `isError: false`，Agent 认为调用成功 | 9 个 tool 回调 | ✅ 已复现 |
| 3 | **P1** | 任务终态 `failed` 也返回 `success: true` | `video:303` / `image:356` | ✅ 已复现 |
| 4 | **P1** | 后端返回非 JSON 或缺 `message` 时，错误原因被完全吞掉，只剩 `{"success":false}` | `video:253,263` / `image:304,314` | ✅ 已复现 |
| 5 | **P1** | `poll_interval` 无校验 → `0` 时约 **66 req/s** 打自家后端 | `video:23` / `image:13` | ✅ 已复现 |
| 6 | **P1** | 50s 截断承诺不成立，最坏可撑到 ~115s，正好撞上它要躲的 60s 超时 | `video:298-317` | 代码推算 |
| 7 | **P1** | 轮询中一次网络抖动就丢掉 `task_id`，长任务彻底失联（计费照扣） | `video:299-302` | 代码确认 |
| 8 | P2 | `imageBase64` 不剥 `data:` 前缀 → 上传损坏图片；且一律命名 `image.png` | `sam3:187-189` | 代码确认 |
| 9 | P2 | SAM3 与 video/image 对同一 TOS 契约的容错/鉴权/字段映射四层不一致 | `sam3:124-217` | 代码确认 |
| 10 | P2 | `debug_*` 调试字段混进生产响应，轮询重复吐出签名 URL | `video:274-275` / `image:326-327` | 代码确认 |
| 11 | P2 | 错误信息里带出预签名 URL（含 TOS 凭据），进入 LLM 上下文 | `video:192-194` | 代码确认 |
| 12 | P2 | `config.json` 从 `cwd` 优先加载 → API Key 可被重定向到任意主机；配置解析失败静默回落生产 | `server.ts:20-38` | 代码确认 |
| 13 | P2 | 本地文件无类型校验；SAM3 的 `readFileSync` 连 100MB 上限都没有（OOM） | `sam3:182` | 代码确认 |
| 14 | P2 | 未知状态被当成「还在处理」，后端异常伪装成正常轮询 | `video:303` / `sam3:109` | ✅ 已复现 |
| 15 | P2 | 无 CI，`release:verify` 靠人手跑 | 缺 `.github/workflows` | 代码确认 |
| 16 | P3 | ~150 行逐字节重复（4 个函数 md5 相同）+ 9 段相同注册样板 | video/image/sam3 | ✅ 已量化 |
| 17 | P3 | 测试只覆盖 `service-config.ts`（4 行），~1000 行 0 覆盖 | `tests/` | ✅ 已量化 |
| 18 | P3 | `uploadToTos` 用黑名单筛字段，后端加字段就漏（SAM3 那边用的白名单更稳） | `video:168` | 代码确认 |
| 19 | P3 | SAM3 截断提示语让 Agent「retry later」，与 README 的「去轮询」矛盾 | `sam3:240` | 代码确认 |
| 20 | P3 | `SAM3_POLL_INTERVAL` 单位是毫秒，同名参数 `poll_interval` 是秒 | `server.ts:50` | 代码确认 |
| 21 | P3 | 其他一致性/卫生问题（见 §四） | — | 代码确认 |

---

## 二、实测环境与复现方法

不是读代码下的结论。搭建方式：本地 mock HTTP 后端（可切换故障模式）+ 真实 MCP stdio 客户端，直接向 `dist/server.js` 发 `initialize` / `tools/list` / `tools/call`。

```
node dist/server.js --api-key test-key \
  --base-url http://127.0.0.1:8799 \
  --sam3-base-url http://127.0.0.1:8799/sam
```

`tools/list` 返回 9 个工具：`create_task, get_task_status, enhance_video_sync, enhance_image_sync, colorize_image_sync, denoise_image_sync, get_image_task_status, sam3_predict, get_sam3_task_status` —— 与 README 一致。

### 原始观测记录

**A. 后端返回 HTML 错误页（网关 502，HTTP 200 + `text/html`）**

```json
{"content":[{"type":"text","text":"{\n  \"success\": false\n}"}]}
```
→ **`error` 字段整个消失**。原因：axios 把非 JSON 响应解析成字符串，`data.code` 为 `undefined`，判据 `undefined !== 0 && undefined !== 200` 成立，但 `data.message` 也是 `undefined`，`JSON.stringify` 直接丢掉 `error` 键。

**B. 后端返回 `{"code":500}`（无 `message`）** → 同样是 `{"success": false}`，一个字段不剩。

**C. `enhance_video_sync`，任务终态为 `failed`**

```json
{"success": true, "task_id": "task-1", "status": "failed", "progress": 40,
 "error_message": "GPU worker exploded"}
```
→ **`success: true`**。任务失败，接口报成功。

**D. `get_task_status`，后端返回未知状态 `canceled`**

```json
{"success": true, "task_id": "task-1", "status": "canceled", "progress": 10}
```
→ 无任何提示。同步工具会把这个状态一路轮询到超时截断。

**E. `sam3_predict`，同一把 key 分别用两种配置方式**

| 配置方式 | 实测结果 |
|---|---|
| `--api-key test-key`（README:153 推荐） | `SAM3 API Key not configured. Please set API_KEY environment variable or --api-key argument.` |
| `API_KEY=test-key` 环境变量 | 正常发起网络请求 |

→ 证明 `--api-key` 这条路径上 `sam3ApiKey` 是空串。

**F. `enhance_image_sync`，本地文件不存在** → `{"success": false, "error": "File does not exist: ..."}`，同时 `isError` 缺失。

**G. `poll_interval: 0, timeout: 3`（观察是否打爆后端）**

```
>>> 3 秒内向 /tasks/{id} 发了 198 次 GET，约 66 req/s
```

**所有 A–G 场景的 `isError` 均为 `false`（字段缺失）**。MCP 客户端会把 7 次失败全部显示为绿色成功调用。

---

## 三、详细问题与修复建议

### P0-1 `--api-key` 传不到 SAM3

`src/server.ts:47-49`：

```ts
let apiKey = process.env.API_KEY || '';
...
let sam3ApiKey = apiKey;        // ← 在这里就把值拷走了
```

CLI 参数解析在 `53-74` 行，只把结果写回 `apiKey`，`sam3ApiKey` 再没被赋值过。

**影响面比看上去大**：`package.json` 的 `mcpServer.env.API_KEY` 和 GUI 客户端配置走环境变量，**能正常工作**；只有 `npx ... --api-key xxx` 这种 README 主推的 CLI 姿势会 100% 失败。也就是说这个 bug 在文档示例、在开发者的自测路径上天然被掩盖，只在用户端爆发。而 README:44 的「懒人安装」让 AI 自己写配置，AI 大概率就写 `--api-key`。

**修复**：

```ts
// server.ts：把赋值挪到参数解析之后
let sam3ApiKey = '';              // 或干脆删掉这个变量，handler 直接用 apiKey
// ... 参数解析循环 ...
sam3ApiKey = apiKey;
```

---

### P0-2 所有工具失败都返回 `isError: false`

9 个 tool 回调统一长这样：

```ts
async (args) => {
  try { ... return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }; }
  catch (error) { return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }) }] }; }
}
```

MCP 协议里工具失败应当回 `{ content: [...], isError: true }`，或者干脆 `throw` 让 SDK 自己转换。这里把异常捕获后当**正常结果**返回，客户端和 Agent 都收不到失败信号。实测 7 个失败场景 `isError` 全部缺失。

这条和 P1-3 叠加起来的效果是：一个只看 `success` 的 Agent 会把「任务失败」读成「任务完成」，而一个只看 `isError` 的 Agent 会认为一切正常。

**修复**：抽一个注册包装，9 处套用，同时消灭 ~60 行重复：

```ts
function registerTool<S extends z.ZodRawShape>(
  server: McpServer, name: string, description: string, schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>
): void {
  server.tool(name, description, schema, async (args) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await handler(args as any), null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }], isError: true };
    }
  });
}
```

---

### P1-3 任务终态 `failed` 也返回 `success: true`

`src/video-enhancement.ts:303-305`（`image-enhancement.ts:356-358` 同）：

```ts
if (status.status === 'completed' || status.status === 'failed') {
  return status;                    // ← status 来自 getTaskStatus，其 success 恒为 true
}
```

`getTaskStatus` 的返回体在 `268-280` 行硬编码 `success: true`，`failed` 只是 `status` 的取值之一。实测 C 已确认：`{"success": true, "status": "failed", "error_message": "GPU worker exploded"}`。

这是最容易被 LLM 误读的一种形态——模型对 `success` 的注意力远高于 `status`。

**修复**：二选一，建议前者。

```ts
if (status.status === 'completed' || status.status === 'failed') {
  return { ...status, success: status.status === 'completed' };
}
```

或保留 `success` 表示「请求本身成功」的语义，但把字段改名为 `ok`/`request_ok`，并在 README 显式写「终态判定以 `status` 为准」。当前的两义性必须消除。

---

### P1-4 非 JSON / 缺 `message` 时错误原因被吞掉

`src/video-enhancement.ts:253-255`、`263-265`（image 版 `304-306`、`314-316`）四处同构：

```ts
if (data.code !== 0 && data.code !== 200) {
  return { success: false, error: data.message };      // data 可能是字符串，message 为 undefined
}
```

三个缺陷叠在一起：

1. 没有类型守卫。`data` 是 HTML 字符串时，`data.code` 为 `undefined`，判据成立，`data.message` 也是 `undefined` → `error` 键被 `JSON.stringify` 丢弃。
2. 只看 body 不看 HTTP 状态码。网关返回的 502/504 HTML 页被当成业务响应处理。
3. 后端返回 `{code: 500}` 而没带 `message` 时同样丢原因（实测 B）。

**修复**：

```ts
function unwrap(response: AxiosResponse): { ok: true; data: any } | { ok: false; error: string } {
  const body = response.data;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const code = (body as any).code;
    if (code === 0 || code === 200) return { ok: true, data: (body as any).data };
    return { ok: false, error: (body as any).message ?? (body as any).error ?? `API code=${code}` };
  }
  const preview = String(body).slice(0, 200).replace(/\s+/g, ' ');
  return { ok: false, error: `Non-JSON response (HTTP ${response.status}): ${preview}` };
}
```

---

### P1-5 `poll_interval` 无校验 → 66 req/s 打自家后端

`z.number().default(5)`，没有 `.positive()`、没有上限（`video:23` / `image:13,20,27` / `scale` 同样，`sam3` 的 `prompt` 之外也没有长度约束）。

`poll_interval` 为 `0` 或负数时 `setTimeout(0)` 立即返回，循环退化成无节流轮询。实测 G：**3 秒 198 次 GET ≈ 66 req/s**。

关键在于这个入参是 LLM 直接生成的——模型填 `0` 完全不会有戒心（"不要等待"是个很自然的理解），而每一次都是用户自己的配额和后端资源。同一颗雷还有 `timeout: 0`（立刻截断）和 `scale: -1 / 1e9`。

**修复**：

```ts
const PollInterval = z.number().positive().min(0.5).max(30).default(5);
const SyncTimeout  = z.number().positive().min(1).max(45).default(45);
const Scale        = z.number().int().min(1).max(4).default(2);
```

服务端在 `enhanceVideoSync` / `processImageSync` 里再 clamp 一次（不要只信 schema，这也是给未来非 MCP 入口留的防线）。

---

### P1-6 50 秒截断承诺不成立（这个项目的核心卖点）

`src/video-enhancement.ts:298-317`：

```ts
while (true) {
  const status = await getTaskStatus(client, taskId);   // 单次请求最长可挂 60s（client timeout: 60000，见 34 行）
  ...
  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed >= timeout) { return /* 截断 */ }
  await sleep(pollInterval * 1000);                     // 到期判定在 sleep 之前，且不感知剩余时间
}
```

最坏墙钟 = `timeout` + `pollInterval` + **单次请求耗时**。`timeout` 默认 50、`pollInterval` 默认 5、单个轮询请求的 axios 超时是 60s，于是：

```
50 + 5 + 60 = 115 秒
```

README 说「50 秒内未完成就提前返回 task_id」，实际最坏能到 115 秒。**而 115 秒正好会触发这个项目要规避的 ~60 秒客户端超时**——工具还没来得及把 `task_id` 交回去，连接就被掐了，于是长任务丢失任务句柄。这不是边角情况：单个轮询请求挂住 10 秒以上（弱网、后端 GC 停顿）就已经足够越过 60s 线。

`sam3_predict` 是另一套（25 次 × 2s），但也同样没有「剩余时间」概念，且最后一次失败尝试后还会白睡一个周期（`sam3.ts:225-235`）。

**修复**：

```ts
const POLL_TIMEOUT_MS = 10_000;                  // 轮询请求单独用短超时
const deadline = Date.now() + timeout * 1000;
while (Date.now() < deadline) {
  const status = await getTaskStatus(client, taskId);   // 内部用 POLL_TIMEOUT_MS + 2 次退避重试
  if (isTerminal(status.status)) return normalize(status);
  await sleep(Math.min(pollInterval * 1000, deadline - Date.now()));   // 不越过截止时间
}
return truncated(taskId, timeout);
```

配套：把 `timeout` 的 schema 上限压到 45，给同步工具留出返回时间。

---

### P1-7 一次网络抖动丢掉 `task_id`

`src/video-enhancement.ts:299-302`：

```ts
const status = await getTaskStatus(client, taskId);
if (!status.success) { return status; }        // 这个对象里没有 task_id
```

场景：任务已经创建成功、后端正在跑、计费已经开始，只是某次 GET 超时/5xx。此时返回给 Agent 的只有 `{success: false, error: "..."}`——**`task_id` 没了，任务永远找不回来**。用户看到的是「失败」，实际任务还在跑完并计费。

**修复**（两层）：

```ts
// 1) 网络类错误退避重试，不要一次抖动就放弃
// 2) 无论如何都把 task_id 带上
if (!status.success) {
  return { ...status, task_id: taskId, note: '任务已创建，请用 get_task_status(task_id) 继续跟进。' };
}
```

---

### P2-8 `imageBase64` 不剥 `data:` 前缀

`src/sam3.ts:187-189`：

```ts
} else if (imageBase64) {
  buffer = Buffer.from(imageBase64, 'base64');
  fileName = 'image.png';
}
```

Agent 传 base64 时最常见的写法是完整 Data URL：`data:image/jpeg;base64,/9j/4AAQ...`。`Buffer.from(..., 'base64')` 会把 `data:image/jpeg;base64,` 这段前缀按 base64 字母表强行解码出若干垃圾字节贴在文件头，**上传的是一张损坏的图片**，错误发生在远端推理环节，排查成本极高。

同时 `fileName` 恒为 `image.png`——真实格式是 JPEG 时扩展名撒谎，后端若按扩展名判类型就会走错分支。

**修复**：

```ts
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;
let b64 = imageBase64;
let ext = 'png';
const m = DATA_URL.exec(imageBase64.trim());
if (m) { ext = MIME_EXT[m[1]] ?? 'png'; b64 = m[2]; }
buffer = Buffer.from(b64, 'base64');
fileName = `image.${ext}`;
```

---

### P2-9 SAM3 与 video/image 对同一 TOS 契约四层不一致

同一个后端、同一个 `origin_policy` 字段，两套假设：

| 维度 | video / image | SAM3 |
|---|---|---|
| `origin_policy` 格式兼容 | 兼容 base64 变体（`startsWith('{')` 判断后编码） | 直接 `JSON.parse` → base64 必抛 `Unexpected token`（`sam3:205`） |
| 业务码判据 | `code !== 0 && code !== 200` | 只认 `code !== 0`（`sam3:130`） |
| 鉴权头 | `Authorization: Bearer` | `X-API-Key`（`sam3:29`） |
| 表单字段构造 | 黑名单排除（`skipKeys`） | 白名单逐个 append（`sam3:138-144`） |

而 README 说三套服务**共用同一把 API Key**。同一把 key、同一个 TOS、同一份签名响应，四种不同的处理假设，意味着任何一处后端契约微调都只会打坏其中一条链路，而且很难在联调时同时发现。

另外 `sam3:152` 的 `if (response.status >= 400) throw` 是**死代码**——axios 默认对 4xx/5xx 直接抛异常，这行永远走不到。

**修复**：抽 `src/tos.ts`，统一「签名解析 + 字段映射 + 上传 + 错误格式化」，video/image/sam3 三处共用；鉴权头差异用参数区分并写进文档。

---

### P2-10 `debug_*` 调试字段混进生产响应

`src/video-enhancement.ts:274-275`：

```ts
debug_video_url_length: result.video_url?.length,
debug_video_url_full: result.video_url,
```

`image-enhancement.ts:326-327` 同样。这两行把带签名的 URL **再输出一遍**，而 README 完全没提这两个字段。带签名的 URL 通常几百到上千字符，一次 `get_task_status` 就多吐一份；长任务轮询十几次，累计是几千 token 的纯浪费——而且它们看起来就是临时排查时留下的痕迹。

附带：`getImageTaskStatus` 还同时返回 `video_url`（`image:325`），图片任务里的这个字段永远无意义。

**修复**：删掉 4 个 `debug_*`；`getImageTaskStatus` 只返回 `image_url`。

---

### P2-11 错误信息带出预签名 URL（含 TOS 凭据）

`src/video-enhancement.ts:191-196`（image 版 `211-216`、Step 2 分支 `229-232`）：

```ts
const detail = error.response
  ? `status=${...} statusText=${...} data=${...} url=${signatureData.url?.substring(0, 80)}...`
```

`signatureData.url` 是 TOS 的**预签名上传地址**，query 里一般带 `x-tos-credential` 和 `x-tos-signature`。前 80 字符足以覆盖到凭据部分。这段字符串会进入工具返回值 → 进入 LLM 上下文 → 可能进入客户端日志与用户截图。

**修复**：只输出 `new URL(url).host + pathname`，绝不含 query。

---

### P2-12 `config.json` 从 `cwd` 优先加载（凭据可被重定向）

`src/server.ts:19-39`：

```ts
const configPaths = [
  path.resolve(process.cwd(), 'config.json'),          // ← 用户工作目录
  path.resolve(__dirname, '..', 'config.json'),        // ← 包内
];
```

两个问题：

**(1) 配置劫持路径。** stdio MCP server 的 `cwd` 是 MCP 客户端启动它的目录，也就是用户的项目目录。**任何一份躺在用户工作目录里的 `config.json`，都能把 `baseUrl` 重指到攻击者控制的服务器**，此后每次调用都会带着 `Authorization: Bearer <用户的 API Key>` 发过去。配合 SAM3 的 `imagePath`（读任意本地文件并上传到签名地址），就构成了一条完整的「读本地文件 → 外传」链路。风险来源包括：克隆他人项目、`npm create` 模板、任何一份随仓库分发的示例配置。

**(2) 配置解析失败 fail-open 到生产。**

```ts
} catch {
  continue;                                            // ← 静默吞掉
}
```

用户在 `config.json` 里写错一个逗号，脚本不报错、不警告，**静默回落到 `https://mcp.avc.ai`**。用户以为在测自建环境，实际把 key 和真实请求打到了生产。配置加载失败属于「必须立刻知道」的错误，却用了最安静的失败方式。

**修复**：

- 删掉 `cwd` 探测，或改为仅在显式传入 `--config <path>` 时读取；
- 解析失败必须 `console.error` 具体路径与原因，并以非零码退出（fail-closed）；
- 若确实需要 cwd 覆盖，至少打印一行「正在使用 <path>，注意该文件不在包内」。

---

### P2-13 本地文件无类型校验、SAM3 无大小限制

- `checkLocalFile`（`video:129-139` / `image:149-159`）只检查「存在」和 100MB，**不校验扩展名、不校验魔数**。`image_source` / `video_source` 是 Agent 自由填的任意路径，任何可读文件都会被读取并上传到 TOS。
- `src/sam3.ts:182` 的 `fs.readFileSync(imagePath)` **连 100MB 上限都没有**，全量同步读进内存。单线程的 MCP server 遇到一个大文件直接 OOM，整个会话的工具全部失效。
- `src/sam3.ts:184` 的 `imageUrl` 分支：`axios.get` 无超时、`maxContentLength` 未设（默认不限），既是不受限的内存放大，也是标准的 SSRF 面（可探内网元数据端点）。

**修复**：
```ts
const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
// 扩展名 + 魔数双校验；SAM3 同样套 100MB；imageUrl 用 maxContentLength: 100MB + timeout: 15s
// 且限定 http(s)、拒绝私网/环回/链路本地地址段
```

---

### P2-14 未知状态被当成「还在处理」

`video:303` / `image:356` 只把 `completed` / `failed` 视作终态，其余一律继续轮询。后端若引入 `canceled` / `expired` / `rejected`（实测 D 传了 `canceled`），同步工具会一路轮询到截断，Agent 拿到的是「还在处理」——**后端异常被伪装成了正常等待**。

`src/sam3.ts:109` 更糟：`status: data.status || 'processing'`，用 `||` 把 `undefined` 兜成 `processing`。若 `/predict/result` 出错时返回的是 `{code, message}` 而不是 `{status}`，Agent 会拿到「仍在处理」，**无限期轮询一个早已失败的任务，永远看不出真相**。

**修复**：
```ts
const TERMINAL_OK = new Set(['completed', 'succeeded', 'success']);
const TERMINAL_FAIL = new Set(['failed', 'canceled', 'cancelled', 'expired', 'rejected']);
// 未知状态：连续 N 次（如 3 次）仍不认识 → 按错误上报，附原始 status 字符串
```

---

### P2-15 无 CI

仓库没有 `.github/workflows`。而这个项目的发布风险**恰好全部集中在 CI 最擅长拦住的类型**上：4 处版本号漂移、后端未就绪就发 npm、`audit` 出高危依赖。`release:verify` 写得很好，但完全依赖人记得跑。

**修复**：约 20 行 YAML，在 `push` / `pull_request` 上跑 `npm ci && npm run release:verify`。这是本次审核里性价比最高的一条。

---

### P3 清单

**P3-16｜~150 行逐字节重复。** 实测 `checkLocalFile` / `uploadToTos` / `parseFileIdFromUrl` / `sleep` 四个函数在 video 与 image 两个文件里 **md5 完全相同**；再叠加 9 段一模一样的 try/catch 注册样板、3 份结构相同的截断返回体，重复量约 200 行。抽 `src/tos.ts`（签名+上传+file_id）与 `src/tooling.ts`（注册包装 + 截断构造）可砍掉大半，也让 P0-2 / P1-4 / P1-6 的修复只需改一处。

**P3-17｜测试几乎为空。** `tests/` 只有 3 个断言，全部打在 `service-config.ts` 的 4 行逻辑上；其余约 1000 行 0 覆盖。讽刺的是，**本次实测证明有 bug 的地方恰好都是最好测的纯逻辑**：`parseFileIdFromUrl`、`uploadToTos` 的字段映射与 `origin_policy` 分支、截断的截止时间计算、`data.code` 判据函数。补这四组测试不需要网络（mock 掉 axios / 注入假时钟即可），成本极低，收益是把 §三 里 6 个 P0/P1 全部钉死在回归里。

**P3-18｜`uploadToTos` 用黑名单筛字段。** `skipKeys` 是排除法，`for...Object.entries(signatureData)` 会把后端将来新增的任何字段都当 TOS 表单域发出去；嵌套对象经 `String(value)` 变成 `"[object Object]"` 直接发给对象存储。SAM3 那边的 `uploadImageToTos` 用的白名单（逐个 append 已知字段）更稳——统一到白名单。

**P3-19｜SAM3 截断提示语与文档矛盾。** `sam3.ts:240` 告诉 Agent：「Please retry later or record this task_id for manual follow-up.」——**没有指向 `get_sam3_task_status`**。而 README:462 和 FAQ:512 都明确说应该去轮询。一个听话的 Agent 会直接放弃，把一个还能救的任务丢掉。改成和 video/image 同一句话。

**P3-20｜`SAM3_POLL_INTERVAL` 单位是毫秒（默认 2000），而同名参数 `poll_interval` 在 video/image 里是秒（默认 5）。** 一个用户按后者的习惯设 `SAM3_POLL_INTERVAL=5`，得到的是 5ms 轮询 → 400 req/s（同 P1-5 的后果）。建议改名 `SAM3_POLL_INTERVAL_MS`，或统一成秒并加校验。

**P3-21｜其他一致性与卫生问题。**

| 项 | 位置 | 说明 |
|---|---|---|
| 死代码 | `sam3:48-50`、`sam3:70-72` | `if (!apiKey) throw` 在 handler 里，但启动时 `server.ts:76-79` 已 `process.exit(1)`，永远不可达 |
| 冗余变量 | `server.ts:49` | `sam3ApiKey` 若非为绕开 P0-1，本身就无必要 |
| 版本检查脆弱 | `check-release.mjs:15` | 正则取 `server.ts` 里**第一个** `version:`；现在正好是 `McpServer` metadata，但加一行含 `version:` 的注释就会静默错位。应锚定 `new McpServer({...})` 块 |
| 第三份配置源 | `package.json.mcpServer` | 非 npm 规范的自定义字段，与 `config.json` / `server.json` 内容重复，且无同步门禁 |
| 双套忽略规则 | `files` + `.npmignore` | `files` 白名单已覆盖 `.npmignore` 的意图，两者同时维护容易打架 |
| 跨平台 glob | `package.json:25` | `node --test tests/*.test.mjs` 在 Windows cmd 下 shell 不展开 glob，靠 node 自行处理才没炸。改为 `node --test tests/` |
| 类型松散 | 全 `src/` | 25 处 `any`（image 13 / video 12 / sam3 6）；错误处理全靠 `error: any` + `error.response`；`sourceType` / `taskType` 在内部函数签名里退化成 `string`，zod 的 enum 类型没往下传。建议用 `z.infer<typeof X>` 贯穿，并开启 `noUncheckedIndexedAccess` |
| 无重试退避 | 全 `src/` | 429 / 5xx 直接失败；P1-7 尤其需要 |
| 无请求超时 | `video:186`、`image:206`、`sam3:146` | TOS 上传用的裸 `axios.post` 没有 `timeout`，上传挂住会无限期等待 |

---

## 四、做得好的地方（不要在这次修改中弄坏）

这些都是有意识的设计，值得在重构时保留：

1. **日志走 stderr，没有污染 stdout 的 JSON-RPC 通道。** 这是 stdio MCP server 最经典的致命错误，这个项目一次都没犯。
2. **工具描述写得很好。** `enhance_image_sync` / `colorize_image_sync` / `denoise_image_sync` 三个天然易混的工具，描述里都加了 `Use this tool ONLY for ...` 的强约束，还带中文关键词（`图片增强/放大/超分辨率`）。这显著降低模型选错工具的概率，比多数 MCP server 强。
3. **超时截断的方向是对的。** 返回 `task_id` + 明确的 next-step 提示、把长任务交回 Agent，是正确的架构选择——问题只在实现细节（P1-6）而不在思路。
4. **版本一致性门禁是真的能用的。** `check:release` 覆盖 4 处版本位置，实测通过；`release:verify` 串了 `audit --audit-level=high` + build + `pack --dry-run`，思路完整。
5. **发布面收得住。** `files` 白名单 + `.gitignore` 覆盖 `.env` / `*.tgz` / registry token 文件。
6. **文档态度诚实。** README 主动写明「npm `latest` 是 0.2.1，只有 5 个工具，且运行时 metadata 错误地报告 0.3.0」「图片工具在 9 工具冒烟通过前不是生产能力」「`0.3.0` 不得发布」，还点名了历史事故。这种文档在开源项目里是少数派，应当保留。
7. **`check-release.mjs` 本身写得干净**：`Map` + 差异列表 + 非零退出，没有花活。

---

## 五、建议的修复顺序

**第 1 批（能立刻止血，改动都很小）**

1. P0-1 `sam3ApiKey` 赋值时机（1 行）
2. P0-2 统一 `isError: true`（抽 1 个包装 + 9 处套用）
3. P1-3 终态 `success` 语义（2 处）
4. P1-5 三个 schema 加数值约束（3 处）
5. P2-10 删 4 个 `debug_*` 字段

**第 2 批（重构 + 补测试，为后续打底）**

6. 抽 `src/tos.ts` + `src/tooling.ts`，消掉 P3-16 的重复
7. P1-4 加 `unwrap()` 类型守卫，四条判据统一
8. P1-6 / P1-7 重写轮询循环（deadline 感知 + 短超时 + 退避重试 + 保留 `task_id`）
9. P3-17 补四组纯函数测试（`parseFileIdFromUrl`、`uploadToTos` 映射、截断截止时间、`unwrap`），把这批 bug 钉进回归
10. P2-15 加 CI workflow 跑 `release:verify`

**第 3 批（安全与契约）**

11. P2-12 `config.json` 解析 fail-closed、去掉 cwd 隐式覆盖
12. P2-13 文件类型/大小校验 + SSRF 防护
13. P2-8 `data:` 前缀剥离；P2-9 三套 TOS 契约统一；P2-11 错误信息去凭据；P2-14 未知状态处理
14. P3 清单逐项清理

---

## 附：本次审核未覆盖的范围

- 后端 `media-mcp-api-http-server`、外部 SAM3 服务、Portal 三个仓库均不在本次审核范围（README 已说明图片路由尚未部署、`/sam/health` 未提供）。
- 未做真实的 avc.ai 线上联调（无有效 API Key），所有网络行为均以本地 mock 验证。
- 未审计 npm 依赖供应链（`npm audit` 在 `release:verify` 里，本次单独运行时未发现 high 及以上）。
- MCP SDK 的 `server.tool(...)` 4 参数重载在 `@modelcontextprotocol/sdk@1.29.0` 下编译通过，但若上游废弃该重载，9 个工具注册点需要一次性迁移到 `registerTool`；这属于未来兼容性提示，不是当前缺陷。
