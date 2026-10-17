# sam3-mcp (Node.js)

[English](https://github.com/avclabs/media-mcp/blob/main/packages/sam3-mcp/README.md) | 中文

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/sam3-mcp)](https://www.npmjs.com/package/@avclabs.ai/sam3-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SAM3 图像分割 MCP server——一个包只提供一个功能，客户端会话只加载 SAM3 工具定义。

## 工具

- `sam3_predict` — SAM3 图像分割（支持本地路径、URL 或 Base64 图片）
- `get_sam3_task_status` — 查询 SAM3 任务状态（等待预算耗尽后用于轮询）

## 前置要求

- **Node.js >= 18**（检查：`node --version`）
- **API Key**（用于身份认证）

## 安装

无需安装，直接在 MCP 客户端配置中用 `npx` 运行。本包只带一个 `sam3-mcp` bin（直接
`npx -y @avclabs.ai/sam3-mcp` 也能运行）；以下配置统一用显式的 `-p <包名> <bin>`
形式固定要运行的 bin。

### Claude Code（CLI）

在 Claude Code 中运行 `/mcp`，找到 **"User MCPs"** 对应的配置文件路径
（通常是 `~/.claude.json`），粘贴：

```json
{
  "mcpServers": {
    "sam3-mcp": {
      "command": "npx",
      "args": ["-y", "-p", "@avclabs.ai/sam3-mcp@latest", "sam3-mcp"],
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
env API_KEY=your-api-key npx -y -p @avclabs.ai/sam3-mcp@latest sam3-mcp
```

或编辑 `~/.cursor/mcp.json`，写入与上面相同的 JSON。

### 全局安装（可选）

```bash
npm install -g @avclabs.ai/sam3-mcp
```

然后在配置中使用 `"command": "sam3-mcp"` 配合 `"args": ["--api-key", "your-api-key"]`。

## 验证安装

重启客户端后应看到且仅看到 2 个工具：`sam3_predict`、`get_sam3_task_status`。

## 配置项

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `API_KEY` | **是** | - | API 认证密钥 |
| `SAM3_API_BASE_URL` | 否 | `https://mcp.avc.ai/sam` | SAM3 服务接口地址 |
| `SAM3_POLL_INTERVAL_MS` | 否 | `2000` | 轮询间隔（毫秒，`SAM3_POLL_INTERVAL` 为已弃用别名） |
| `SAM3_POLL_MAX_ATTEMPTS` | 否 | `25` | 最大状态查询次数；时间预算为 间隔 × 次数，任一限制先耗尽即截断等待 |

对应的命令行参数：`--api-key`、`--sam3-base-url`、`--sam3-poll-interval`、
`--sam3-poll-max-attempts`（另支持 `--config <路径>`）。显式配置的非法值会在启动时
直接报错退出，不会提交任何任务。

## 推荐的工作流程

- 调用 `sam3_predict` → 服务器内部自动轮询
- 默认最多 25 次状态查询、约 50 秒时间预算（25 次 × 2 秒间隔，任一限制先耗尽即截断等待）
- 预算内完成则直接返回分割结果
- 预算内未完成则返回携带 `task_id` 的截断提示，用 `get_sam3_task_status` 轮询直到 `completed` 或 `failed`

等待预算只覆盖任务创建后的状态轮询——源准备、上传、任务提交和最后的结果下载都
不计入，因此整个工具调用可能长于预算。

## 工具说明

### sam3_predict

使用 SAM3 分割 API 分析图片，生成推理结果（masks、boxes、scores）。

**参数：**

图片输入（三选一，必须提供其中一种）：

- `imagePath` (string): 本地图片的绝对路径。支持常见图片格式（如 PNG、JPG、JPEG）。
  - 示例：`"C:\\Users\\xxx\\photo.png"`、`"/home/user/images/cat.jpg"`
  - 适用场景：用户明确提供了本地文件路径

- `imageUrl` (string): 公开可访问的图片 URL。
  - 示例：`"https://example.com/photo.jpg"`
  - 适用场景：图片已在网上，用户提供了链接
  - 注意：URL 必须公开可访问，不支持需要登录或签名的链接

- `imageBase64` (string): Base64 编码的图片数据。
  - 示例：`"iVBORw0KGgoAAAANSUhEUgAA..."`
  - 适用场景：用户拖拽或上传了图片附件，Agent 将图片编码为 base64 后传入
  - 注意：大图片的 base64 数据会比较大，传输时间可能稍长

其他参数：

- `prompt` (string, required): 英文文本提示，用于指定要在图片中分割的目标物体。由于 SAM3 模型仅接受英文 prompt，建议传入英文描述。如果用户提供中文或其他非英文文本，Agent 会自动翻译为英文后调用。

**正常完成返回：**

推理完成后，直接返回 JSON 字符串。该 JSON 包含以下三个字段：

- **`masks`**：二维数组。每个元素是一个与输入图片尺寸相同的二值掩码（取值为 0 或 1），用于标记检测到的物体在图片中的像素级位置。数组中的第 i 个掩码对应第 i 个检测到的物体实例。
- **`boxes`**：二维数组。每个元素是 `[x1, y1, x2, y2]` 格式的边界框坐标，表示检测到的物体在图片中的矩形区域。`x1`、`y1` 为左上角坐标，`x2`、`y2` 为右下角坐标。

  坐标系说明：以图片左上角为原点 `(0, 0)`，`x` 轴向右增长，`y` 轴向下增长，单位为像素。例如 `[120, 80, 300, 450]` 表示该物体区域从图片左边缘向右 120px、上边缘向下 80px 处开始，延伸至左边缘向右 300px、上边缘向下 450px 处结束，区域宽度为 `x2 - x1 = 180px`，高度为 `y2 - y1 = 370px`。
- **`scores`**：一维数组。每个元素是对应检测结果的置信度分数，取值范围为 0 到 1。分数越高，表示模型对该检测结果的把握越大。

结果 JSON 内容示例：

```json
{
  "masks": [
    [[0, 0, 1, ...], [0, 1, 1, ...], ...],
    [[0, 0, 0, ...], [0, 0, 1, ...], ...]
  ],
  "boxes": [
    [120, 80, 300, 450],
    [400, 200, 600, 500]
  ],
  "scores": [0.95, 0.87]
}
```

**截断返回示例（预算内未完成）：**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 50 seconds, 25 status queries). Please use get_sam3_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to task status polling."
}
```

**结果下载失败（任务已完成、结果缺失）：**
任务已完成但结果文件下载失败时，工具返回 `success: false`，同时携带 `task_id` 与 `status: "completed"`。请用该 `task_id` 调用 `get_sam3_task_status` 恢复结果，不要重新提交任务。
```json
{
  "success": false,
  "task_id": "xxx",
  "status": "completed",
  "error": "Failed to download the completed result for task xxx: ...",
  "note": "The task has completed; only the result download failed. Do not resubmit. Use get_sam3_task_status with this task_id to recover the result."
}
```

### get_sam3_task_status

查询 SAM3 分割任务状态。当 `sam3_predict` 超时后，用此工具轮询结果。

> 返回值中的 `status` 字段可能为：`processing`（处理中）、`completed`（已完成）、`failed`（失败）。如果 `status` 为 `processing`，等待几秒后再次调用此工具。

| 参数 | 类型 | 必填 |
|---|---|---|
| `task_id` | string | 是 |

**已完成返回：**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "result_url": "https://..."
}
```

**处理中返回：**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "processing",
  "message": "Task is still processing, please check again later."
}
```

**失败返回：**
```json
{
  "success": false,
  "task_id": "xxx",
  "status": "failed",
  "error": "Task failed"
}
```

## 故障排查

- **"API key is required"** — 检查配置中的 `env.API_KEY`。
- **拖拽附件后提示找不到文件** — stdio MCP 的已知限制；在消息中同时提供本地绝对路径，或让客户端将图片编码为 base64。
- **URL 图片下载失败** — 确保 URL 公开可访问（无需登录、Cookie 或签名）。
- **客户端中 server 显示红色/错误** — 查看客户端 MCP 日志（如 macOS 的 `~/Library/Logs/Claude/mcp*.log`）。

定价、API Key 与额度见 https://mcp.avc.ai/ 。完整常见问题见
[旧版全量包 README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README_CN.md#常见问题)。

## License

MIT License — 详见 [LICENSE](LICENSE)。
