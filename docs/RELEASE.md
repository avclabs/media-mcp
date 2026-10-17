# 发布说明

2026-10-17 更新：仓库已拆分为 npm workspaces monorepo（ADR
[0001](adr/0001-split-into-per-function-packages.md)）。发布单元从 1 个 npm 包变为 5 个：

| 包 | 版本起点 | 说明 |
|---|---|---|
| `@avclabs.ai/media-mcp-core` | 0.1.0 | 内部共享库，必须最先发布 |
| `@avclabs.ai/video-mcp` | 0.1.0 | 视频增强（3 工具），bin `video-mcp` |
| `@avclabs.ai/image-mcp` | 0.1.0 | 图片增强/上色/降噪（4 工具），bin `image-mcp` |
| `@avclabs.ai/sam3-mcp` | 0.1.0 | SAM3 分割（2 工具），bin `sam3-mcp` |
| `@avclabs.ai/media-mcp` | 继承 0.3.0 | 旧版全量包（9 工具），存量配置兼容 |

三个分体包是新的 semver 生命周期，从 0.1.0 起独立演进；旧包下一次发布为 0.4.0
（基于新结构重建，作为共享结构的冒烟验证）。`0.3.0` 已发布（含图片工具，正式可用）。

历史补充（2026-09-06）：SAM3 源码与发布脚本已纳入独立仓库，固定部署于 `/opt/ai/sam3`；
API 候选 schema head 为 `20260906_0007`。执行顺序见
[四项目发布清单](https://github.com/avclabs/mcp-portal-web/blob/main/docs/FOUR-PROJECT-ROLLOUT.md)。

这些包是 stdio MCP server：运行在用户的 Claude、Cursor 等客户端机器上，通过 HTTPS 调用 `mcp.avc.ai/enhance` 和 `mcp.avc.ai/sam`。生产交付物是 npm 包，不是部署到 Web 服务器的 Node 常驻进程。

## 发布前置条件

- Node.js 18 或更高版本。
- npm 组织 `@avclabs.ai` 的发布权限和有效 2FA/token。
- 同级 `media-mcp-api-http-server` 的视频/图片/账户接口以及外部 SAM3 服务已部署，并保持对已发布版本的向后兼容。
- 各包 `config.json` 保持现状（image 包的 `imageBaseUrl` 为 `null`，走回落契约），生产默认端点由各包内置默认值提供（bundled `config.json` 与代码默认值一致）。
- `main` 工作区干净，待发布版本号尚未存在于 npm registry。

## 版本位置

每个包的版本号存在于以下位置，必须同步（`npm run check:release` 会逐一校验）：

- `packages/<pkg>/package.json`
- `package-lock.json` 中 `packages/<pkg>` 条目（如 `packages/core`、`packages/video-mcp`）
- `packages/<pkg>/src/server.ts` 的 `SERVER_VERSION` 字面量（core 除外，无 server）
- 仅旧版包：根 `server.json` 顶层与 `packages[0]`
- 服务器包对 `@avclabs.ai/media-mcp-core` 的 `^` 依赖范围必须被 workspace 内 core 版本满足

修改后运行 `npm run check:release`。该检查用于阻止版本漂移；当前不自动改版本，避免发布脚本悄悄修改源码。

## 发布流程

在干净检出上执行：

```bash
npm ci                # 安装 workspaces 并构建全部包
npm run release:verify   # 版本门禁 + 生产依赖审计 + 全部测试 + 各包 npm pack --dry-run
node scripts/e2e-check.mjs  # 四个 server 入口的 stdio E2E（mock 后端）
npm login
```

发布顺序固定为 **core → video-mcp / image-mcp / sam3-mcp → media-mcp（旧版）**——
core 必须先于依赖它的服务器包出现在 registry：

```bash
npm publish --access public -w packages/core
npm publish --access public -w packages/video-mcp
npm publish --access public -w packages/image-mcp
npm publish --access public -w packages/sam3-mcp
npm publish --access public -w packages/media-mcp
```

> 注意：发布旧版包前必须先把 `packages/media-mcp` bump 到 **0.4.0**——registry 已存在
> 0.3.0（发布时会 EPUBLISHCONFLICT），且它依赖的三个分体包必须已先行出现在 registry，
> 否则新用户安装旧版包会解析失败。每个包发布时 `prepublishOnly` 会自动重新构建，
> 但仍应从干净检出执行整个流程。

`release:verify` 的 `npm pack --dry-run --workspaces` 会展示每个包将发布的文件。
确认产物只包含各服务器包的 `dist/`、`config.json`、`LICENSE` 和 README（core 包不含
`config.json`），不含 `.env`、日志、测试数据或凭据。

发布成功后，每个发布的包打独立 tag 并推送：

```bash
git tag core-v<version>            # 例如 core-v0.1.0
git tag video-mcp-v<version>       # 例如 video-mcp-v0.1.0
git push origin <tag>
```

冒烟测试（每个发布的 server 包执行一次，应成功启动 stdio server 并在真实 MCP 客户端
确认工具数量：video 3 / image 4 / sam3 2 / 旧版 9，再各执行一次低成本任务）：

```bash
npx -y -p @avclabs.ai/video-mcp@<version> video-mcp --api-key <temporary-key>
npx -y -p @avclabs.ai/image-mcp@<version> image-mcp --api-key <temporary-key>
npx -y -p @avclabs.ai/sam3-mcp@<version>  sam3-mcp  --api-key <temporary-key>
npx -y @avclabs.ai/media-mcp@<version> --api-key <temporary-key>
```

非 npm 分发渠道需同步：`dist-bundles/*.mcpb` 是旧版包的手工产物（分体包暂不自动产
`.mcpb`，需要时用同一手工流程）；GitHub release、私有 tarball 等渠道在发布公告时一
并通知。MCP registry 限制（每仓库一个 `server.json`，仍指向旧版包）见 ADR 0001。

## 与门户/后端的发布顺序（历史记录，2026-09-06；0.3.0 已按此顺序发布完成）

以下为 `0.3.0` 发布前的后端协同顺序，保留作历史记录；其中的"候选 0.3.0"均指当时状态：

1. 保持已经上线的 `/enhance` API 和 Portal，通过 `0.2.1` 验证视频与 SAM3 存量契约。
2. 在隔离环境验证同一 FastAPI/JobServer 已完成的图片创建、状态、`image_url`、图片能力 health、双 outbox 和图片/视频独立处理链；为外部 SAM3 增加 JSON health。若非 npm 渠道确有旧候选客户端，再部署 compatibility adapter。
3. 保持候选 `0.3.0` 的生产默认 `IMAGE_API_BASE_URL` 未设置，通过共享 `/enhance` 验证 health、鉴权、TOS 签名及视频/图片/SAM3 各一项低成本任务。
4. 完成 API/组合一键发布与回滚演练，复核 Portal 的注册、登录、API Key 和文档。
5. 最后发布 `media-mcp@0.3.0`，避免新客户端命中尚未上线的图片接口。

当前生产 `media-mcp-api-http-server` release 只提供视频/TOS REST 路由及 4 个可选远程 MCP 工具；候选代码已在同一 FastAPI/JobServer 内实现图片路由，并以独立图片/视频队列处理。SAM3 仍由外部 `/sam` owner 提供。客户端继续依赖 `IMAGE_API_BASE_URL` 对 `HTTP_API_BASE_URL` 的回落行为，候选后端通过真实 E2E 并发布前不得发布 npm `0.3.0`。

后端 + 门户编排、密钥门禁、Nginx/systemd 模板和双回滚步骤位于同级仓库 `mcp-portal-web/docs/PRODUCTION-DEPLOYMENT.md`。
