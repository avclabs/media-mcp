# image-mcp (Node.js)

[English](https://github.com/avclabs/media-mcp/blob/main/packages/image-mcp/README.md) | 中文

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/image-mcp)](https://www.npmjs.com/package/@avclabs.ai/image-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AVCLabs 图片增强/上色/降噪 MCP server——一个包只提供一个功能，客户端会话只加载图片工具定义。

## 工具

- `enhance_image_sync` — 图片画质增强与人脸优化（支持 URL 或本地文件上传）
- `colorize_image_sync` — 黑白照片上色（支持 URL 或本地文件上传）
- `denoise_image_sync` — 图片降噪去噪（支持 URL 或本地文件上传）
- `get_image_task_status` — 查询图片任务状态（同步工具超时后用于轮询）

## 前置要求

- **Node.js >= 18**（检查：`node --version`）
- **API Key**（用于身份认证）

## 安装

无需安装，直接在 MCP 客户端配置中用 `npx` 运行。本包只带一个 `image-mcp` bin（直接
`npx -y @avclabs.ai/image-mcp` 也能运行）；以下配置统一用显式的 `-p <包名> <bin>`
形式固定要运行的 bin。

### Claude Code（CLI）

在 Claude Code 中运行 `/mcp`，找到 **"User MCPs"** 对应的配置文件路径
（通常是 `~/.claude.json`），粘贴：

```json
{
  "mcpServers": {
    "image-mcp": {
      "command": "npx",
      "args": ["-y", "-p", "@avclabs.ai/image-mcp@latest", "image-mcp"],
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
env API_KEY=your-api-key npx -y -p @avclabs.ai/image-mcp@latest image-mcp
```

或编辑 `~/.cursor/mcp.json`，写入与上面相同的 JSON。

### 全局安装（可选）

```bash
npm install -g @avclabs.ai/image-mcp
```

然后在配置中使用 `"command": "image-mcp"` 配合 `"args": ["--api-key", "your-api-key"]`。

## 验证安装

重启客户端后应看到且仅看到 4 个工具：`enhance_image_sync`、`colorize_image_sync`、
`denoise_image_sync`、`get_image_task_status`。

## 配置项

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `API_KEY` | **是** | - | API 认证密钥 |
| `IMAGE_API_BASE_URL` | 否 | 回落到 `HTTP_API_BASE_URL` | 可选图片服务地址覆盖；共享生产服务无需配置 |
| `HTTP_API_BASE_URL` | 否 | `https://mcp.avc.ai/enhance` | `IMAGE_API_BASE_URL` 未设置时的回落地址 |

`IMAGE_API_BASE_URL` 仅用于主动拆分公网图片服务地址的部署；省略时（推荐配置）图片
请求共用生产增强服务——与全量包的回落行为完全一致。

对应的命令行参数：`--api-key`、`--image-base-url`、`--base-url`（回落用）、
`--config <路径>`。

## 推荐的工作流程

1. **大多数图片**：直接调用 `enhance_image_sync` / `colorize_image_sync` / `denoise_image_sync`，工具会完成全部流程并返回结果
2. **如果被截断**：工具返回 `task_id`（默认等待预算 45 秒），用 `get_image_task_status` 轮询，直到 `status` 变为 `completed` 或 `failed`
3. **如果失败**：查看 `error_message` 字段了解详情

**支持的图片格式**：PNG、JPG、JPEG、BMP、WebP 等。

**两种上传方式**：
1. **URL 上传**：提供公开可访问的图片 URL（`type: "url"`）
2. **本地上传**：提供本地文件路径，MCP Server 自动上传到 TOS 对象存储（`type: "local"`，最大 100MB）

## 工具说明

| 工具 | 功能 | 适用场景 |
|---|---|---|
| `enhance_image_sync` | 图片画质增强与人脸优化 | 模糊、低分辨率或画质下降的照片 |
| `colorize_image_sync` | 黑白照片上色 | 为老旧黑白照片恢复真实色彩 |
| `denoise_image_sync` | 图片降噪去噪 | 弱光环境下拍摄的噪点/颗粒感照片 |

三个处理工具（不含状态查询）均为**同步**调用——阻塞直到处理完成或等待预算耗尽，参数与行为模式相同；`get_image_task_status` 立即返回，用于截断后的轮询。

### enhance_image_sync

同步增强图片画质并优化人脸。

> 工具内部会创建任务并轮询结果。如果在超时时间内（默认 45 秒）处理完成，直接返回结果；否则提前返回 `task_id`，需用 `get_image_task_status` 继续轮询。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `image_source` | string | 是 | - | 图片 URL 或本地文件路径（URL 必须公网可访问，不支持需要登录或签名的链接） |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `scale` | number | 否 | `2` | 增强倍数（如 `2` 为 2 倍、`4` 为 4 倍放大） |
| `poll_interval` | number | 否 | `5` | 轮询间隔（秒，0.5-30） |
| `timeout` | number | 否 | `45` | 同步等待超时时间（秒，1-45），超过后主动返回 |

**正常完成返回：**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "progress": 100,
  "image_url": "https://..."
}
```

**截断返回（默认 45 秒预算内未完成）：**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 45 seconds, 9 status queries). Please use get_image_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to get_image_task_status polling."
}
```

### colorize_image_sync

同步为黑白照片 AI 上色。

> 适合老旧黑白照片，AI 会为图片添加真实色彩。参数与返回格式与 `enhance_image_sync` 相同。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `image_source` | string | 是 | - | 图片 URL 或本地文件路径（URL 必须公网可访问，不支持需要登录或签名的链接） |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `poll_interval` | number | 否 | `5` | 轮询间隔（秒，0.5-30） |
| `timeout` | number | 否 | `45` | 同步等待超时时间（秒，1-45），超过后主动返回 |

**返回值：** 与 `enhance_image_sync` 相同。

### denoise_image_sync

同步为图片降噪去噪。

> 适合弱光环境或高 ISO 拍摄的噪点/颗粒感照片。参数与返回格式与 `enhance_image_sync` 相同。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `image_source` | string | 是 | - | 图片 URL 或本地文件路径（URL 必须公网可访问，不支持需要登录或签名的链接） |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `poll_interval` | number | 否 | `5` | 轮询间隔（秒，0.5-30） |
| `timeout` | number | 否 | `45` | 同步等待超时时间（秒，1-45），超过后主动返回 |

**返回值：** 与 `enhance_image_sync` 相同。

### get_image_task_status

查询图片处理任务状态。当同步工具超时后，用此工具轮询结果。

> 返回值中的 `status` 字段可能为：`processing`（处理中）、`completed`（已完成）、`failed`（失败）。如果 `status` 为 `processing`，等待几秒后再次调用此工具。

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
  "image_url": "https://...",
  "message": "Task is still processing, please check again later"
}
```

其中 `message` 字段只在 `status` 为 `processing` 时出现，提示 Agent 继续等待。

## 故障排查

- **"API key is required"** — 检查配置中的 `env.API_KEY`。
- **"TOS 上传失败"** — 通常是签名不匹配，确认 `IMAGE_API_BASE_URL`（未配置时回落到 `HTTP_API_BASE_URL`）和 `API_KEY` 正确且有效。
- **URL 图片下载失败** — 确保 URL 公开可访问（无需登录、Cookie 或签名）；否则先下载到本地再用 `type: "local"`。
- **客户端中 server 显示红色/错误** — 查看客户端 MCP 日志（如 macOS 的 `~/Library/Logs/Claude/mcp*.log`）。

定价、API Key 与额度见 https://mcp.avc.ai/ 。完整常见问题见
[旧版全量包 README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README_CN.md#常见问题)。

## License

MIT License — 详见 [LICENSE](LICENSE)。
