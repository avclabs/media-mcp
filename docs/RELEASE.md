# 发布说明

`media-mcp` 是 stdio MCP server：它运行在用户的 Claude、Cursor 等客户端机器上，通过 HTTPS 调用 `mcp.avc.ai/enhance` 和 `mcp.avc.ai/sam`。生产交付物是 npm 包，不是部署到 Web 服务器的 Node 常驻进程。

## 当前状态（2026-09-06）

- npm registry `latest=0.2.1`；发布包包含视频 3 + SAM3 2 个工具，没有图片工具。该包的运行时 metadata 错误报告 `0.3.0`，但 npm/lock 版本为 `0.2.1`。
- 当前仓库版本 `0.3.0` 尚未发布，已修正版本一致性并新增图片 4 工具、`IMAGE_API_BASE_URL` 和发布门禁。
- 生产 `/enhance` API 与 Portal 已上线；共享 FastAPI 的候选代码已实现图片路由、图片/视频独立队列、双 outbox 和积分幂等，但尚未发布或通过真实图片 AI/TOS E2E，`/sam/health` 也尚未提供门禁要求的 JSON health，因此不能发布 9 工具 `0.3.0`。
- Portal 仓库的 API/组合脚本还要求 compatibility health。npm `0.2.1` 不产生图片请求，所以该要求不是 npm 存量兼容义务；删除前仍需盘点 GitHub release、私有 tarball 和 MCP 目录等非 npm 分发渠道。

## 发布前置条件

- Node.js 18 或更高版本。
- npm 组织 `@avclabs.ai` 的发布权限和有效 2FA/token。
- 同级 `media-mcp-api-http-server` 的视频/图片/账户接口以及外部 SAM3 服务已部署，并保持对 `0.2.1` 和候选版本向后兼容。
- `config.json.imageBaseUrl` 保持为空，`package.json` 不设置 `IMAGE_API_BASE_URL`，使视频和图片默认共用通过验收的生产 `/enhance`。
- `main` 工作区干净，版本号尚未存在于 npm registry。

## 版本位置

版本号目前存在于以下位置，必须同步：

- `package.json`
- `package-lock.json` 顶层与根 package
- `server.json` 顶层与 `packages[0]`
- `src/server.ts` 的 MCP server metadata

修改后运行 `npm run check:release`。该检查用于阻止版本漂移；当前不自动改版本，避免发布脚本悄悄修改源码。

## 发布流程

```bash
npm ci
npm run release:verify
npm login
npm publish --access public
```

`release:verify` 会校验所有版本位置、阻断 high 及以上的生产依赖漏洞、编译 TypeScript，并用 `npm pack --dry-run` 展示将要发布的文件。确认产物只包含 `dist/`、配置和公开文档，不含 `.env`、日志、测试数据或凭据。

发布成功后：

```bash
git tag v<version>
git push origin v<version>
npx -y @avclabs.ai/media-mcp@<version> --api-key <temporary-key>
```

最后一条命令应成功启动 stdio server；再在真实 MCP 客户端中确认 9 个工具均可见，并执行一次低成本任务。

## 与门户/后端的发布顺序

1. 保持已经上线的 `/enhance` API 和 Portal，通过 `0.2.1` 验证视频与 SAM3 存量契约。
2. 在隔离环境验证同一 FastAPI/JobServer 已完成的图片创建、状态、`image_url`、图片能力 health、双 outbox 和图片/视频独立处理链；为外部 SAM3 增加 JSON health。若非 npm 渠道确有旧候选客户端，再部署 compatibility adapter。
3. 保持候选 `0.3.0` 的生产默认 `IMAGE_API_BASE_URL` 未设置，通过共享 `/enhance` 验证 health、鉴权、TOS 签名及视频/图片/SAM3 各一项低成本任务。
4. 完成 API/组合一键发布与回滚演练，复核 Portal 的注册、登录、API Key 和文档。
5. 最后发布 `media-mcp@0.3.0`，避免新客户端命中尚未上线的图片接口。

当前生产 `media-mcp-api-http-server` release 只提供视频/TOS REST 路由及 4 个可选远程 MCP 工具；候选代码已在同一 FastAPI/JobServer 内实现图片路由，并以独立图片/视频队列处理。SAM3 仍由外部 `/sam` owner 提供。客户端继续依赖 `IMAGE_API_BASE_URL` 对 `HTTP_API_BASE_URL` 的回落行为，候选后端通过真实 E2E 并发布前不得发布 npm `0.3.0`。

后端 + 门户编排、密钥门禁、Nginx/systemd 模板和双回滚步骤位于同级仓库 `mcp-portal-web/docs/PRODUCTION-DEPLOYMENT.md`。
