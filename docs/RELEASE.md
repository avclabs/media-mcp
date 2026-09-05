# 发布说明

`media-mcp` 是 stdio MCP server：它运行在用户的 Claude、Cursor 等客户端机器上，通过 HTTPS 调用 `mcp.avc.ai/enhance` 和 `mcp.avc.ai/sam`。生产交付物是 npm 包，不是部署到 Web 服务器的 Node 常驻进程。

## 发布前置条件

- Node.js 18 或更高版本。
- npm 组织 `@avclabs.ai` 的发布权限和有效 2FA/token。
- 同级 `media-mcp-api-http-server` 的视频/账户接口以及外部图片/SAM3 服务已部署，并保持对当前 npm 版本向后兼容。
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

1. 先用门户仓库的一键脚本发布向后兼容的 `media-mcp-api-http-server`，并确认外部图片/SAM3 upstream 未被破坏。
2. 验证 health、鉴权、TOS 签名、视频/图片/SAM3 各一项低成本任务。
3. 部署 `mcp-portal-web`，验证注册、登录、API Key 和文档。
4. 最后发布 `media-mcp`，避免新客户端命中尚未上线的接口。

当前 `media-mcp-api-http-server` 只实现视频/TOS REST 路由及 4 个远程 MCP 工具，不实现 npm 包所需的图片路由与 SAM3。未补齐契约或正式拆分图片 API 基址前，不能用它直接替换现有完整 `/enhance` upstream。

后端 + 门户编排、密钥门禁、Nginx/systemd 模板和双回滚步骤位于同级仓库 `mcp-portal-web/docs/PRODUCTION-DEPLOYMENT.md`。
