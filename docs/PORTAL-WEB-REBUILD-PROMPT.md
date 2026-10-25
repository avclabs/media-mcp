# 给 Kimi 的提示词：mcp-portal-web 对齐 media-mcp 拆包

> 用法：把下面「提示词正文」整段复制给 Kimi。方括号 `[[ ]]` 内是你要按实际情况替换的占位。
>
> 写作前提（已核实，2026-10-22）：
> - `media-mcp` 仓库已拆为 `core` + `video-mcp` + `image-mcp` + `sam3-mcp` + 兼容旧配置的 `media-mcp`（commit `6fed953`，后续两次 review 修复）。
> - npm 上只有 `@avclabs.ai/media-mcp@0.3.0` 可安装；`video-mcp` / `image-mcp` / `sam3-mcp` / `core` 查询均为 404，**尚未发布**。
> - 现有前端 `mcp-portal-web` 是 Vue 3 + Vite + vite-ssg 的 SSG 站点，不是 React，也不是纯 SPA。
>
> 因此「重做」建议限定为「信息架构 + 文档/营销页重构」，保留认证、支付、后台管理、SEO 管线、部署脚本。若确实要全量重建，见文末「如果真要推倒重来」。

---

## 提示词正文（从这里开始复制）

你是这个前端项目的负责人。项目：`mcp-portal-web`，面向海外用户的 AVCLabs Media MCP 门户站（生产域名 `https://mcp.avc.ai`），技术栈 Vue 3 `<script setup>` + Vite 6 + vite-ssg（SSG 预渲染）+ Tailwind + Pinia + vue-i18n + radix-vue。仓库路径 `[[/Users/hohbandlee/Projects/avc.ai/mcp-portal-web]]`。

上游 MCP server 仓库 `media-mcp` 刚刚完成了一次架构拆分：原来一个全量包 `@avclabs.ai/media-mcp` 提供 9 个工具，现在拆成 3 个按功能划分的包 + 1 个共享库，全量包保留仅为兼容存量配置。**你的任务是把本站的信息架构、文档、营销文案与这个新事实对齐。** 站点现在对外讲的是「一个包、9 个工具、图片功能尚未发布」，这三句全是错的。

先读完本文再动手。下面的「事实基线」是我从源码逐个核对的，视为唯一可信来源；不要用你记忆里的版本、不要从旧页面复制参数、不要自行编造参数名。

---

### 一、事实基线：包与工具矩阵

| npm 包 | 功能 | 工具 | bin | 版本 | npm 已发布 |
|---|---|---|---|---|---|
| `@avclabs.ai/video-mcp` | 视频增强 | `create_task`、`get_task_status`、`enhance_video_sync` | `video-mcp` | 0.1.0 | **否** |
| `@avclabs.ai/image-mcp` | 图片增强 / 上色 / 降噪 | `enhance_image_sync`、`colorize_image_sync`、`denoise_image_sync`、`get_image_task_status` | `image-mcp` | 0.1.0 | **否** |
| `@avclabs.ai/sam3-mcp` | SAM3 图像分割 | `sam3_predict`、`get_sam3_task_status` | `sam3-mcp` | 0.1.0 | **否** |
| `@avclabs.ai/media-mcp` | 旧版全量（9 工具） | 以上全部 | `media-mcp` | 0.3.0 | 是 |
| `@avclabs.ai/media-mcp-core` | 内部共享库，**不是 MCP server** | — | — | 0.1.0 | 否 |

拆分的产品价值（营销页要讲这个，不是讲「我们重构了」）：
1. **上下文更小**：MCP 客户端会把每个已配置 server 的全部工具定义注入会话，只要图片功能的客户端不再为视频和 SAM3 的 schema 付费。
2. **工具歧义更少**：会话里只剩一个 `get_*_task_status` 变体时，模型选错工具的概率显著下降。
3. **按需启用**：可以只给某类用户或某个团队暴露一个功能。

**发布状态是硬门禁。** 三个新包当前在 npm 上不存在。站点是生产站，任何「复制即装」的安装命令写错，用户执行就是 404。所以：
- 包名、版本、bin、发布状态、安装命令模板必须收敛到**唯一一个模块**（见任务 1），页面只允许从它取值，**禁止在模板或 i18n 里手写包名字符串**。
- 未发布的包，安装区块必须显式渲染「Coming soon / 即将发布」状态，并给出可用替代（旧全量包），不能让人复制到一条会失败的 npx 命令。
- 是否展示未发布包，由一个环境变量控制（建议 `VITE_SHOW_UNRELEASED_PACKAGES`），默认关闭。这样包一发布，改配置即可全站切换，不用改页面。

### 二、事实基线：工具参数契约

默认值、取值范围、返回字段都必须按这里写，一个都不能凭印象改。

**video-mcp**

`create_task`
- `video_source` string 必填 — 视频 URL 或本地文件路径；URL 必须公网可访问，带登录态或签名的链接不支持
- `type` `"url" | "local"` 默认 `"url"`
- `resolution` `"480p" | "540p" | "720p" | "1080p" | "2k"` 默认 `"720p"`
- 返回 `{ success, task_id, status }`，异步，需轮询

`get_task_status`
- `task_id` string 必填
- 返回 `{ task_id, status, progress, video_url, error_message, created_at, updated_at, success, message? }`
- `status` 取值 `processing | completed | failed`；`processing` 时 `message` 为 "Task is still processing, please check again later"

`enhance_video_sync`
- `video_source` / `type` / `resolution` 同上
- `poll_interval` number 默认 `5`，范围 `0.5–30`，单位秒
- `timeout` number 默认 `45`，范围 `1–45`，单位秒 —— **不是 50，上限就是 45**
- 超时则提前返回 `{ success: true, status: "processing", task_id, message, note }`，任务不会取消，用 `get_task_status` 续查

**image-mcp**

`enhance_image_sync`
- `image_source` string 必填
- `type` `"url" | "local"` 默认 `"url"`
- `scale` integer 默认 `2`，范围 `1–4`（2 表示 2 倍，4 表示 4 倍）
- `poll_interval` 默认 5 / `timeout` 默认 45（同上）

`colorize_image_sync`、`denoise_image_sync`
- `image_source`、`type`、`poll_interval`、`timeout`，**没有 `scale`**

`get_image_task_status`
- `task_id` 必填
- 返回 `{ task_id, status, progress, image_url, error_message, created_at, updated_at, success, message? }`

**sam3-mcp**

`sam3_predict`
- `imagePath` string 可选 — 本地绝对路径
- `imageUrl` string(url) 可选 — 公网图片地址
- `imageBase64` string 可选 — base64 或 data URL
- 三者**至少提供一个**；同时提供时的优先级为 `imagePath` > `imageUrl` > `imageBase64`
- `prompt` string 必填，长度 `1–500`，**必须英文**（中文要先翻译）
- 完成时返回分割结果 JSON（`masks` / `boxes` / `scores`）；未完成则返回 `{ success: true, status: "processing", task_id, message, note }`
- 同步等待上限约 **50 秒**（`SAM3_POLL_INTERVAL_MS` 2000 × `SAM3_POLL_MAX_ATTEMPTS` 25）

`get_sam3_task_status`
- `task_id` 必填
- 完成返回 `{ success: true, task_id, status, result_url }`；失败返回 `{ success: false, task_id, status, error }`

> 注意区分：视频/图片同步工具是 **45 秒**截断，SAM3 是 **50 秒**。现有站点全站统一写「50 秒」，是错的。

### 三、事实基线：环境变量按包归属

| 变量 | video-mcp | image-mcp | sam3-mcp | media-mcp（旧全量） | 默认值 |
|---|---|---|---|---|---|
| `API_KEY` | 必填 | 必填 | 必填 | 必填 | — |
| `HTTP_API_BASE_URL` | 可选 | 可选 | — | 可选 | `https://mcp.avc.ai/enhance` |
| `IMAGE_API_BASE_URL` | — | 可选 | — | 可选 | 未设时**回落到解析后的 video 基础地址** |
| `SAM3_API_BASE_URL` | — | — | 可选 | 可选 | `https://mcp.avc.ai/sam` |
| `SAM3_POLL_INTERVAL_MS` | — | — | 可选 | 可选 | `2000`（规范名；`SAM3_POLL_INTERVAL` 为已弃用别名） |
| `SAM3_POLL_MAX_ATTEMPTS` | — | — | 可选 | 可选 | `25` |

CLI flag 覆盖（优先级 高→低：CLI > 环境变量 > 包内 config.json > 内置默认）：
`--base-url`、`--image-base-url`、`--sam3-base-url`、`--api-key`、`--sam3-poll-interval`、`--sam3-poll-max-attempts`

**不要再把 6 个变量平铺成一张表。** 用户装 `image-mcp` 时看到 `SAM3_POLL_MAX_ATTEMPTS` 只会困惑。

### 四、必须修正的既有缺陷（逐条确认后改）

这些是我核对源码时发现的实际错误，不是风格建议：

1. `src/views/docs/useDocsShared.js`：`npmPackage` 从 `VITE_NPM_PACKAGE` 读，全站配置样例共用同一个包名与 `video-enhancement` 这个 server 名。拆包后模型失效。
2. `src/i18n/locales/zh-CN.json:455`：写着「npm latest 为 0.2.1……图片 4 工具属于尚未发布的 0.3.0 候选」。实际 npm latest 已是 0.3.0，图片工具已是生产能力。**这句在自降转化。**
3. `src/i18n/locales/zh-CN.json:680`：`imageEnhancementTitle` = 「图片增强（尚未发布的 0.3.0 候选）」，同上，过期。
4. 全站文案把同步工具的截断写成「50 秒」（`zh-CN.json` 556/558/559/560/594/625/642-644/655 等）。视频与图片实际是 **45 秒**，只有 SAM3 约 50 秒。
5. `src/views/docs/DocsToolsVideo.vue:197` 参数表里 `timeout` 默认值写 `50`，实际 `45`。
6. `src/views/docs/useDocsShared.js:86-92`：`enhanceSyncReq` 示例 `timeout: 50`（超出 schema 上限），且 `enhanceSyncTruncated` 的 `message` 是中文「任务仍在处理中（已等待 50 秒）」，而后端实际返回英文模板 `Task is still processing (waited 45 seconds, N status queries)`。
7. `useDocsShared.js:77-84`：`getStatusResp` 示例同时出现 `status: "completed"` 和 `message: "任务仍在处理中，请稍后再查询"`，自相矛盾。
8. 文档缺页面：**图片增强 / 上色 / 降噪 4 个工具没有任何独立文档页**（`/docs/tools/` 下只有 video 与 image-segmentation）。这是本站唯一缺失的工具页，也是 0.3.0 的主力卖点。
9. `src/views/docs/DocsLayout.vue:44-52` 的 `H1_BY_PATH` 与 `nav` 数组都是硬编码，新增页面必须手工同步，否则侧栏没有入口、h1 回落到包名。

### 五、改造任务

**任务 1：建立唯一事实源 `src/lib/packages/registry.js`**

纯数据 + 纯函数，Node 安全（不 import Vue、不 import `@` 别名），因为 `vite.config.js` 也要用它。结构至少包含：

```js
export const PACKAGES = [
  {
    id: 'video',
    npmName: '@avclabs.ai/video-mcp',
    bin: 'video-mcp',
    version: '0.1.0',
    published: false,
    title: { 'zh-CN': '视频增强', 'en-US': 'Video Enhancement' },
    tools: ['create_task', 'get_task_status', 'enhance_video_sync'],
    env: [{ name: 'API_KEY', required: true }, { name: 'HTTP_API_BASE_URL', default: 'https://mcp.avc.ai/enhance' }],
    installArgs: ['-y', '-p', '@avclabs.ai/video-mcp@latest', 'video-mcp'],
  },
  // image / sam3 / legacy ...
]
```

要求：
- 所有安装命令由 `installArgs` 生成，页面与 i18n 里不再出现字面量包名。
- `published: false` 的包，UI 统一渲染发布状态徽标，并禁用「复制安装命令」按钮（或复制时提示替代方案）。
- 提供 `publishedPackages()` / `getPackage(id)` / `serverConfigFor(ids)` 三个辅助函数，其中 `serverConfigFor` 直接产出可粘贴的 `mcpServers` JSON。

**任务 2：文档信息架构改为「1 总览 + 3 功能页 + 安装 + 配置 + FAQ + 排错」**

新增 `src/views/docs/DocsToolsImage.vue`，路由 `/docs/tools/image-enhance`，覆盖 4 个图片工具的完整参数表 + 请求/响应示例。同时：
- 更新 `routes.js`
- 更新 `DocsLayout.vue` 的 `nav` 与 `H1_BY_PATH`（图片页 h1 用 `Image Enhancement Tools`）
- 更新 `src/lib/seo/publicPages.js` 登记该页（**不登记就不会预渲染、不会进 sitemap、canonical 也没有**，这条最容易漏）
- 更新 `zh-CN.json` / `en-US.json` 两份文案

三个功能页顶部都要有一行「所属包」的显式标注，例如 `Package: @avclabs.ai/image-mcp · 4 tools`，让用户第一眼知道该装哪个。

**任务 3：安装页（`DocsInstallation.vue` / `DocsQuickstart.vue`）改为多 server 模式**

不要给「安装全部 9 个工具」当默认推荐。按这个顺序组织：
1. 选功能（三个卡片，各自标注工具数与发布状态）
2. 生成对应的 `mcpServers` 配置（单包，一个 server）
3. 需要多个功能时，展示「装多个 server」的完整配置示例，server 名分别为 `video-mcp` / `image-mcp` / `sam3-mcp`
4. 底部一节「存量配置」：说明旧 `@avclabs.ai/media-mcp` 仍然可用、无需迁移，但新集成不推荐

Claude Code / Cursor / Windsurf 三个集成页同步这套叙述。

**任务 4：配置页（`DocsConfiguration.vue`）改为按包分表**

- 三张小表（video / image / sam3），每张只列该包读取的变量，附「未设时的行为」（尤其 `IMAGE_API_BASE_URL` 回落到 video 基础地址这条，很多用户会踩）
- SAM3 那节必须写清 `SAM3_POLL_INTERVAL_MS` 是规范名、`SAM3_POLL_INTERVAL` 已弃用但仍兼容
- 同步/异步模式那节把 45 秒与 50 秒分开写，不要混
- 旧全量包单独一节，列全 6 个变量

**任务 5：营销页叙述更新**

`Home.vue`、`Pricing.vue`、三个 `/compare/*`、三个 `/integrations/*`：
- 卖点从「9 个工具一个包」改为「按需装一个功能，上下文更小、工具更准」
- 去掉所有「尚未发布」「候选」表述（图片功能已生产）
- **不要**在营销页写具体包版本号，版本会漂
- 保留现有 SEO 结构（每页 h1、canonical、JSON-LD），改动文案后同步 `publicPages.js` 里对应页面的 `lastmod`

**任务 6：测试**

- 新增 `registry` 的单元测试：未发布包不得产出可复制的安装命令；`serverConfigFor(['video','image'])` 产出两个 server 且 env 正确
- 更新 `src/lib/seo/__tests__/publicPages.spec.js`（若有页面数量断言）
- 新增图片工具页的渲染测试（至少断言 4 个工具名出现在 DOM）

### 六、硬约束

1. **不要换框架、不要换构建工具。** 保持 Vue 3 + Vite + vite-ssg + Tailwind + Pinia + vue-i18n。`vite-ssg` 的 `includedRoutes` 从 `publicPages.js` 派生，这个机制不能破坏。
2. **不要动后端 REST 接口。** `src/lib/api/config.js` 里的 `/enhance/api/...` 端点与本次拆包无关，一行都不要改。认证、API Key、Dashboard、Admin 三块功能不在本次范围内。
3. **不要删除** `/dashboard/*`、`/admin/*`、支付、部署脚本、SEO 采集脚本。
4. **SSG 安全**：页面顶层不得访问 `window` / `document` / `localStorage`，必须放在 `onMounted` 或 `import.meta.env.SSR` 判断之后。否则 prerender 直接崩。
5. **i18n 双份同步**：`zh-CN.json` 与 `en-US.json` 的 key 集合必须完全一致，缺 key 会在运行时 fallback 到原始 key 文本。
6. **不写未发布包的可执行安装命令。** 见第一节硬门禁。
7. 每改一个页面，同步 `publicPages.js` 的 `lastmod`（手工填当天日期，脚本会校验格式）。

### 七、验收标准

改完必须全绿，命令在仓库根目录执行：

```bash
npm run build          # vite-ssg build，必须无 prerender 报错
npm test               # vitest run，全绿
npm run seo:files:check    # sitemap / llms.txt 与 publicPages.js 一致
npm run seo:nginx-map:check
```

另外人工确认：
- [ ] `/docs/tools/image-enhance` 出现在 `dist/` 下（`dist/docs/tools/image-enhance/index.html` 存在）
- [ ] 该页出现在 `dist/sitemap.xml`
- [ ] 侧栏 4 个工具入口（overview 内）/ 3 个工具页可达，无死链
- [ ] 全站搜索「50 秒」「50s」「0.2.1」「尚未发布」「候选」，视频/图片语境下的结果应为 0
- [ ] 三个未发布包的安装区块显示 Coming soon，且复制按钮不产出会 404 的命令
- [ ] 移动端 375px 宽度下参数表可横向滚动、不撑破布局

### 八、交付方式

分四批提交，每批独立可构建：
1. `registry.js` + 单测（不改任何页面）
2. 文档信息架构：新增图片页、改 routes / DocsLayout / publicPages / i18n
3. 安装页与配置页改写
4. 营销页文案与 SEO lastmod

每批给我：改了哪些文件、为什么、构建与测试输出。**不要一次性丢一个巨大 diff。** 遇到事实缺口（比如某工具返回值你不确定）就停下来问我，不要猜。

## 提示词正文结束

---

## 如果真要推倒重来

「重做网页项目」如果理解成新建工程重写，上面这份提示词要额外补五条，否则会丢东西：

1. **认证与支付链路**：`useAuth` / `useAuthModal` / `useCheckout` / `payhut.js` 是能跑的生产代码，重写要先摸清 token 存储、失效跳转、支付回调。
2. **SEO 资产**：`publicPages.js` 是 sitemap、canonical、og、SSG 路由、nginx path map 的单一事实源，重写时必须原样迁移这张表。
3. **部署管线**：`scripts/deploy-production.sh` + `deploy/` + 发布期恢复逻辑，有测试覆盖（`src/__tests__/deploy-*.spec.js`），不能当废代码删。
4. **SSG 而非 SPA**：换成纯 SPA 会丢掉现有预渲染带来的收录。要换的话先给出迁移方案与收录影响评估。
5. **图片资源**：`public/` 下已有各页 og 图（`home.png`、`docs.png`、`compare-*.png` 等），重做视觉要复用或等量替换。

我的判断：这个仓库的工程骨架没有重写的必要，值得重做的是**信息架构和文档表达**——那恰好是拆包后唯一真正过期的东西。真要换视觉，也建议在现有骨架上换皮，而不是新建工程。
