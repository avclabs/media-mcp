# media-mcp — 项目长期笔记

## 身份
- `@avclabs.ai/media-mcp`（npm），MCP registry 名 `io.github.avclabs/media-mcp`，当前 v0.3.0。
- 公司产品线：AVCLabs 面向海外市场的影音增强服务；本仓库是把托管 API 包成 MCP server（stdio）。
- 上游端点：`https://mcp.avc.ai/enhance`（图/视频增强）+ `https://mcp.avc.ai/sam`（SAM3 分割）。
  两个 host 路径不同、**认证头也不同**（`Authorization: Bearer` vs `X-API-Key`）。
- 对外语言策略：README 与源码注释已统一英文，英文为默认。**新增代码不要再写中文注释**。
  已知的中文残留（2026-09-20 复查，勿当成漏翻随手改掉）：
  `package.json:mcpServer.description`；`src/image-enhancement.ts` 三个 tool 的 description 尾部
  带中文同义词（如「图片增强/放大/超分辨率」）—— 大概率是为了提升中文意图的工具路由，改前先确认。

## 跨仓库拓扑（2026-09-24 核实）
本项目是四仓之一，单独看会误判：
| 仓库 | 角色 | 位置 |
|---|---|---|
| `media-mcp` | npm stdio MCP server（本仓） | 用户本地 |
| `mcp-portal-web` | 前端门户（Vue 3 + vite-ssg，营销/控制台/后台） | `~/Projects/mcp-portal-web`，部署在 Nginx |
| `media-mcp-api-http-server` | FastAPI + JobServer，**真正的上游** | 生产机 `/opt/ai/avc-mcp/http-server/current`；**本机不存在** |
| SAM3 API / Worker | 外部依赖 | `/opt/ai/sam3` |

- 两个公开前缀：`/enhance`（视频 + 图片 + 账户/TOS/积分，同一 FastAPI）+ `/sam`（SAM3）。
- **`mcp-portal-web` 不是本项目的上游**，两者无调用关系，只是同域静态门户。查后端行为要去
  `media-mcp-api-http-server`，不要拿 portal 当答案。
- 权威文档在 portal 仓：`docs/FOUR-PROJECT-ROLLOUT.md`（四仓状态与发布顺序）、
  `docs/PROJECT-REVIEW.md`（职责 + P0/P1）、`docs/API-SERVER-REMEDIATION-PLAN.md`（后端整改）。
- 发布门禁：npm `latest` 仍是 `0.2.1`（仅视频 3 + SAM3 2）；本仓 `0.3.0` 九工具是**未发布候选**，
  被"真实图片 AI/TOS E2E"与"SAM3 JSON health"两道门禁阻断。

## 结构约定与坑
> ⚠️ 本节已于 2026-10-04 按 `79e9885` 重写。上一版描述的 `src/upload.ts` /
> `SignatureTransport` / `SignatureAdapter` / `dist-test/` 机制**全部已不存在**，别再照用。

- 一个媒体类型 = 一个文件 + 一个 `setupXxxTools(server, baseUrl, apiKey)`。
  注意第三个参数 `upload`（`MediaUploader`）已在 `79e9885` 移除 —— 上传改由各模块直接调
  `tos.ts` 的三步（`getXxxSignature` → `parseTosSignature` → `uploadToTos`）。
- **`src/tos.ts`** = 上传与外部 IO 的全部关注点：`checkLocalFile`（扩展名 + 魔数 + 100MB）、
  `decodeBase64Image`、`assertPublicHttpUrl`/`downloadToBuffer`（SSRF 防护）、
  `unwrapEnvelope`（后端信封）、`formatRequestError`、`parseTosSignature`、`uploadToTos`。
  新增外部调用先想一遍能不能落在这里，别在媒体模块里手写 axios。
- **`src/tooling.ts`** = 工具层公共设施：`registerTool`（注册 + 统一 isError）、
  `pollUntilTerminal`（deadline 感知轮询）、`classifyStatus`、`clampNumber`、`remainingSleepMs`。
- **`registerTool` 的隐式契约（P1，2026-10-04 实测）**：isError 只看 `result.success === false`。
  handler 返回体**不带 `success` 字段 → 失败永远不标 isError**。`get_task_status` /
  `get_image_task_status` 现在就踩这个坑（返回体没有 `success`）。新增工具必须记得带。
- **`clampNumber` 的 max 是静默的（P1）**：`pollUntilTerminal` 把 timeout 硬 clamp 到 `[1,45]`，
  而 SAM3 传的是 `(pollInterval*pollMaxAttempts)/1000` = 默认 50 → 实际 45；README 推荐的
  `SAM3_POLL_MAX_ATTEMPTS=60`（声明 120s）被吃到 45s，**完全空转且无提示**。
  凡"用户配了值但系统改了"的场景，必须在 `console.error` 里说出来。
- 上传顺序是**先拿签名再开流**（`79e9885` 修的竞态）：`uploadToTos` 内的 axios/form-data
  会接住 `createReadStream` 的 ENOENT，包装成 `TOS upload failed: ENOENT...`，进程存活。
  别把开流提到拿签名之前。
- 测试：`tests/*.test.mjs`（**不是 `.ts`**，直接 import `../dist/*.js`），`npm test` =
  `npm run build && node --test "tests/**/*.test.mjs"`。28 个用例，覆盖 `tos.ts` / `tooling.ts` /
  `service-config.ts`，**`video/image/sam3` 三个模块 0 覆盖**。
  写 mock 后端时注意本机有 `HTTP_PROXY`，请求会是 absolute-form，路由要先归一化 pathname。
- CI：`.github/workflows/ci.yml` 跑 `npm run release:verify`
  = `check:release` + `audit --omit=dev --audit-level=high` + `test` + `pack --dry-run`。
  `check-release.mjs` 校验 6 处版本号（package/lock×2/server×2/server.ts 硬编码）。
- ⚠️ `.workbuddy/` 已被 `79e9885` 提交进仓库（含 `e2e-check.mjs` 和 `memory/2026-09-25.md`），
  尚未被 `.gitignore` 排除。`e2e-check.mjs` 本身是好代码（mock 后端 + 真实 stdio 客户端），
  应该挪进 `scripts/` 并挂进 CI。

## 对外契约（改动时不可破坏）
- 9 个 tool 名、描述、参数 schema 记在 `README.md:119` 与各 `#### tool` 小节。改动后可这样自查：
  用 `git archive HEAD` 检出基线编译，dump 两边 `tools/list` 后 diff。
- 文档化的 env：`API_KEY` / `HTTP_API_BASE_URL` / `IMAGE_API_BASE_URL` / `SAM3_API_BASE_URL` /
  `SAM3_POLL_INTERVAL_MS`（`SAM3_POLL_INTERVAL` 是废弃别名，两者都是**毫秒**）/
  `SAM3_POLL_MAX_ATTEMPTS`。CLI：`--base-url` / `--image-base-url` / `--api-key` /
  `--sam3-base-url` / `--sam3-poll-interval` / `--sam3-poll-max-attempts` / `--config`。
  ⚠️ 后三个（`--image-base-url` / `IMAGE_API_BASE_URL` / `--config`）**README 里零文档**。
- `config.json` **只读包内那份**（`__dirname/../config.json`），不再探测 cwd —— 这是刻意的
  安全修复（cwd 劫持可把 API Key 导向任意主机）。要换配置必须显式 `--config <path>`，
  解析失败 fail-closed 非零退出。
- **上游模型名是硬编码的，调用方不可选**（2026-09-24 核实）：`src/video-enhancement.ts:160` 写死
  `model: 'avc-enhance'`，`src/image-enhancement.ts` 的 `getModelByTaskType` 写死三个 `avc-image-*`。
  没有 tool 参数、env、CLI、`config.json` 任何入口。"选模型"的唯一途径是选 tool。
  model 名也从未出现在 README 里 —— 项目把它当上游实现细节，不是契约。
- 参数校验风格：`resolution` 是枚举白名单；`scale` 是 `int().min(1).max(4)`；
  `poll_interval` 是 `min(0.5).max(30)`；`timeout` 是 `min(1).max(45)`（**不是 50**，README 12 处
  仍写 "50 seconds"，文档与代码不一致）；`prompt` 是 `min(1).max(500)`；`model` 写死。
- 认证信封**未统一**（2026-10-04 确认）：`unwrapEnvelope` 在 video/image 用了，
  SAM3 的 `/predict/result` **没走**（`getSam3Result` 只检查是不是 object），导致 SAM3 的
  `{code:401,message:'invalid api key'}` 被报成 `Unrecognized task status: null`，真实原因丢失。
  修它之前**必须先实测确认 `/predict/result` 成功时是否带 `{code,data}` 信封** —— 无本地后端可验。
- **项目不做横竖版 / 朝向识别**（2026-09-24 全仓库核实：无 aspect/orientation/portrait/width/height
  任何逻辑）。`resolution` 是唯一画幅相关参数，对竖版素材的语义（按短边还是按高度解释）**代码与文档
  均未定义** —— 只能靠实测上游定论，别在没测之前改代码。

## 评审约定
- 架构评审走 `improve-codebase-architecture` skill（deepening opportunities + HTML 报告），
  它的词汇表来自 `codebase-design`（module / interface / seam / adapter / leverage / locality）。
  领域词汇在 `CONTEXT.md`（已建，英文，**尚未提交 git**）；尚无 `docs/adr/`。
- 在无测试的代码上做等价重构，走 `behavior-equivalence-refactor` skill。
- 审核报告放 `docs/CODE-REVIEW-<日期>.md`。⚠️ 根目录那个 `CODE_REVIEW.md` 是 10-03 的
  过期产物（针对已删除的 `src/upload.ts`），**建议删掉**，别让它和 `docs/` 那份并存误导下一个人。
- ⚠️ **开工前先 `git log -1` + `git status`**：2026-10-04 审核期间就被人 `git pull --ff-only`
  换掉了基线（`6c03aa5` → `79e9885`，架构整个变），IDE 注入的 workspace 快照是过时的。
