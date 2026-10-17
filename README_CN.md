# media-mcp monorepo

[English](https://github.com/avclabs/media-mcp/blob/main/README.md) | 中文

[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

封装 AVCLabs 云端媒体服务的 MCP server 集合，按"一个 npm 包只含一个功能"发布，
让 MCP 客户端会话只加载自己实际用到的工具定义。

## 包清单

| 包 | 功能 | 工具 | 可执行文件 |
|---|---|---|---|
| [`@avclabs.ai/video-mcp`](packages/video-mcp) | 视频增强 | `create_task`、`get_task_status`、`enhance_video_sync` | `video-mcp` |
| [`@avclabs.ai/image-mcp`](packages/image-mcp) | 图片增强 / 上色 / 降噪 | `enhance_image_sync`、`colorize_image_sync`、`denoise_image_sync`、`get_image_task_status` | `image-mcp` |
| [`@avclabs.ai/sam3-mcp`](packages/sam3-mcp) | SAM3 图像分割 | `sam3_predict`、`get_sam3_task_status` | `sam3-mcp` |
| [`@avclabs.ai/media-mcp`](packages/media-mcp) | 旧版全量包（全部 9 个工具） | 以上全部 | `media-mcp` |
| [`@avclabs.ai/media-mcp-core`](packages/core) | 内部共享库（不是 MCP server） | — | — |

## 为什么要按功能拆包

- **上下文更小**：MCP 客户端会把每个已配置 server 的全部工具定义（名称、描述、JSON Schema）注入会话。只需要图片功能的客户端不再为视频和 SAM3 的定义买单。
- **工具歧义更少**：会话里只剩一个 `get_*_task_status` 变体时，模型选错工具的概率显著下降。
- **按需启用**：可以给某个客户端或某类用户只暴露一个功能（例如只给标注团队开 SAM3）。

旧版全量包 `@avclabs.ai/media-mcp` 对存量配置保持完全兼容，迁移说明见其
[README](packages/media-mcp/README_CN.md)。

## 快速开始

每个 server 都是通过 `npx` 运行的 stdio MCP server。以只启用图片工具为例：

```json
{
  "mcpServers": {
    "image-mcp": {
      "command": "npx",
      "args": ["-y", "-p", "@avclabs.ai/image-mcp@latest", "image-mcp"],
      "env": { "API_KEY": "your-api-key" }
    }
  }
}
```

注意必须用 `-p <包名> <bin>` 的形式：这些包安装的是命名可执行文件，直接
`npx -y <包名>` 会运行默认 bin。各包 README（[视频](packages/video-mcp/README_CN.md)、
[图片](packages/image-mcp/README_CN.md)、[SAM3](packages/sam3-mcp/README_CN.md)）
包含 Claude Code、Cursor 与全局安装的完整步骤，以及各自读取的配置变量。

所有包共用同一个 `API_KEY` 和相同的后端默认地址
（`https://mcp.avc.ai/enhance` 与 `https://mcp.avc.ai/sam`）。

## 仓库结构

```
packages/
  core/       共享库：工具注册、轮询、TOS 上传、配置解析
  video-mcp/  视频增强 server（3 个工具）
  image-mcp/  图片处理 server（4 个工具）
  sam3-mcp/   SAM3 分割 server（2 个工具）
  media-mcp/  旧版全量 server（9 个工具）
```

各包共享的领域词汇表在 [CONTEXT.md](CONTEXT.md)；架构决策记录在
[docs/adr/](docs/adr/)。

## 开发与发布

```bash
npm ci               # 安装 workspace 依赖并构建所有包
npm test             # 重新构建并运行全部测试
npm run release:verify   # 发布元数据门禁 + 审计 + 测试 + 打包预览
node scripts/e2e-check.mjs  # 四个 server 入口的 stdio E2E
```

维护者请查阅[发布指南](docs/RELEASE.md)了解发布顺序（core 先行）、版本策略、
tag 规则与冒烟测试。发布在干净检出上手工执行；CI 在 Node 22 上运行同一套验证门禁。

## License

MIT License — 详见 [LICENSE](LICENSE)。
