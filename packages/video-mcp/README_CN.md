# video-mcp (Node.js)

[English](https://github.com/avclabs/media-mcp/blob/main/packages/video-mcp/README.md) | 中文

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/video-mcp)](https://www.npmjs.com/package/@avclabs.ai/video-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AVCLabs 视频增强 MCP server——一个包只提供一个功能，客户端会话只加载视频工具定义。

## 工具

- `create_task` — 创建视频增强任务（异步；支持 URL 或本地文件上传）
- `get_task_status` — 查询任务状态
- `enhance_video_sync` — 同步增强视频（阻塞等待，默认 45 秒截断）

## 前置要求

- **Node.js >= 18**（检查：`node --version`）
- **API Key**（用于身份认证）

## 安装

无需安装，直接在 MCP 客户端配置中用 `npx` 运行。本包只带一个 `video-mcp` bin（直接
`npx -y @avclabs.ai/video-mcp` 也能运行）；以下配置统一用显式的 `-p <包名> <bin>`
形式固定要运行的 bin。

### Claude Code（CLI）

在 Claude Code 中运行 `/mcp`，找到 **"User MCPs"** 对应的配置文件路径
（通常是 `~/.claude.json`），粘贴：

```json
{
  "mcpServers": {
    "video-mcp": {
      "command": "npx",
      "args": ["-y", "-p", "@avclabs.ai/video-mcp@latest", "video-mcp"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

**设置 > Tools & MCPs > Add New MCP Server**，Type 选 `command`：

```bash
env API_KEY=your-api-key npx -y -p @avclabs.ai/video-mcp@latest video-mcp
```

或编辑 `~/.cursor/mcp.json`，写入与上面相同的 JSON。

### 全局安装（可选）

```bash
npm install -g @avclabs.ai/video-mcp
```

然后在配置中使用 `"command": "video-mcp"` 配合 `"args": ["--api-key", "your-api-key"]`。

## 验证安装

重启客户端后应看到且仅看到 3 个工具：`create_task`、`get_task_status`、`enhance_video_sync`。

## 配置项

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `API_KEY` | **是** | - | API 认证密钥 |
| `HTTP_API_BASE_URL` | 否 | `https://mcp.avc.ai/enhance` | 视频 HTTP 服务接口地址 |

对应的命令行参数：`--api-key`、`--base-url`（另支持 `--config <路径>` 指定配置文件）。
自定义服务地址示例：

```json
{
  "env": {
    "HTTP_API_BASE_URL": "https://your-media-endpoint.com",
    "API_KEY": "your-api-key"
  }
}
```

## 推荐的工作流程

MCP Agent 对单个 tool 调用通常有约 60 秒超时限制，较长视频请使用异步组合：

1. 调用 `create_task` 创建任务 → 立即获得 `task_id`
2. 等待几秒后调用 `get_task_status` 查询状态
3. 如果 `status` 为 `processing`，继续等待并重复步骤 2
4. 如果 `status` 为 `completed`，任务完成，结果包含 `video_url`
5. 如果 `status` 为 `failed`，任务失败，结果包含 `error_message`

短视频（预计处理 < 1 分钟）可直接调用 `enhance_video_sync`——它内部轮询，默认
45 秒等待预算内未完成会提前返回 `task_id`，此时切换到 `get_task_status` 继续查询。

## 工具说明

### create_task

创建视频增强任务（异步）。

> **推荐使用**：适用于绝大多数场景，尤其是时长超过 10 秒的视频，可避免超时和长时间阻塞连接。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `video_source` | string | 是 | - | 视频 URL 或本地文件路径（URL 必须公网可访问，不支持需要登录或签名的链接） |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `resolution` | string | 否 | `720p` | `480p`、`540p`、`720p`、`1080p`、`2k` |

**返回值：**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "processing"
}
```

### get_task_status

查询视频增强任务状态。

> 返回值中的 `status` 字段可能为：`processing`（处理中）、`completed`（已完成）、`failed`（失败）。如果 `status` 为 `processing`，等待几秒后再次调用此工具轮询。

| 参数 | 类型 | 必填 |
|---|---|---|
| `task_id` | string | 是 |

**返回值：**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "progress": 100,
  "video_url": "https://...",
  "message": "Task is still processing, please check again later"
}
```

其中 `message` 字段只在 `status` 为 `processing` 时出现，提示 Agent 继续等待。

### enhance_video_sync

同步增强视频（阻塞等待完成）。

> **仅适合短视频（预计处理时间 < 1 分钟）。** 如果任务在默认 45 秒等待预算内未完成，工具会提前返回并包含 `task_id`，需要用 `get_task_status` 继续查询。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `video_source` | string | 是 | - | 视频 URL 或本地文件路径 |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `resolution` | string | 否 | `720p` | 目标分辨率 |
| `poll_interval` | number | 否 | `5` | 轮询间隔（秒，0.5-30） |
| `timeout` | number | 否 | `45` | 同步等待超时时间（秒，1-45），超过后主动返回 |

**截断返回示例（默认 45 秒预算内未完成）：**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 45 seconds, 9 status queries). Please use get_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to get_task_status polling."
}
```

## 文件上传说明

当 `type` 为 `"local"` 时，MCP Server 会：
1. 读取本地文件
2. 通过预签名 URL 直传到 TOS 对象存储
3. **最大文件大小：100MB**

## 故障排查

- **"API key is required"** — 检查配置中的 `env.API_KEY`。
- **"TOS 上传失败"** — 通常是签名不匹配，确认 `HTTP_API_BASE_URL` 和 `API_KEY` 正确且有效。
- **客户端中 server 显示红色/错误** — 查看客户端 MCP 日志（如 macOS 的 `~/Library/Logs/Claude/mcp*.log`）。

定价、API Key 与额度见 https://mcp.avc.ai/ 。完整常见问题见
[旧版全量包 README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README_CN.md#常见问题)。

## License

MIT License — 详见 [LICENSE](LICENSE)。
