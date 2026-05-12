# media-mcp (Node.js)

中文 | [English](https://github.com/avclabs/media-mcp/blob/main/README_EN.md)

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/media-mcp)](https://www.npmjs.com/package/@avclabs.ai/media-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 MCP 协议的视频增强与图像分割服务，作为 MCP Client-Server 与后端 HTTP Server 交互。

## 功能

提供以下 MCP Tools：

**视频增强**
- `create_task` - 创建视频增强任务（支持 URL 或本地文件上传）
- `get_task_status` - 查询任务状态
- `enhance_video_sync` - 同步增强视频（阻塞等待，默认50秒截断）

**图像分割 (SAM3)**
- `sam3_predict` - SAM3 图像分割（支持本地路径、URL 或 Base64 图片）

## 前置要求

- **Node.js >= 18** （检查：`node --version`）
- **API Key** （用于身份认证，请联系服务提供方获取）

## 懒人安装（推荐）

如果你使用的 AI Agent 有确定的 MCP 配置路径，直接复制下面这句发给 AI：

```
帮我安装 npm 包 @avclabs.ai/media-mcp 作为 MCP server。我的 API Key 是：sk-xxxxxxxx。
```

AI 会自动完成：
1. 检测你使用的 MCP 客户端
2. 找到配置文件路径
3. 写入正确的配置
4. 提示你重启客户端

## 手动安装

无需安装，直接在 MCP 客户端配置中使用 `npx` 运行。

### 1. Claude Code（CLI）

在 Claude Code 中运行：

```
/mcp
```

查看输出中 **"User MCPs"** 对应的配置文件路径，然后编辑该文件。

常见路径（如果 `/mcp` 不可用）：
- **Windows**: `%USERPROFILE%\.claude.json`
- **macOS**: `~/.claude.json`
- **Linux**: `~/.claude.json`
- **旧版/备用**: `~/.claude/mcp.json`

粘贴以下内容（将 `your-api-key` 替换为实际 API Key）：

```json
{
  "mcpServers": {
    "video-enhancement": {
      "command": "npx",
      "args": ["-y", "@avclabs.ai/media-mcp@latest"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

保存后运行 `/mcp` 验证是否加载成功。

### 2. Cursor

进入 **设置 > Tools & MCPs > Add New MCP Server**：

- **Name**：`video-enhancement`
- **Type**：`command`
- **Command**：
  ```bash
  env API_KEY=your-api-key npx -y @avclabs.ai/media-mcp@latest
  ```

或编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "video-enhancement": {
      "command": "npx",
      "args": ["-y", "@avclabs.ai/media-mcp@latest"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

## 验证安装

重启客户端后，确认工具是否加载成功：

1. 或直接问 AI："你有哪些可用的工具？"
2. 应看到：`create_task`、`get_task_status`、`enhance_video_sync`、`sam3_predict`

## 配置项

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `API_KEY` | **是** | - | API 认证密钥（视频增强和 SAM3 共用） |
| `HTTP_API_BASE_URL` | 否 | `https://mcp.avc.ai/enhance` | 视频增强服务接口地址 |
| `SAM3_API_BASE_URL` | 否 | `https://mcp.avc.ai/sam` | SAM3 服务接口地址 |
| `SAM3_POLL_INTERVAL` | 否 | `2000` | SAM3 轮询间隔（毫秒） |
| `SAM3_POLL_MAX_ATTEMPTS` | 否 | `25` | SAM3 最大轮询次数 |

### 自定义服务地址

```json
{
  "env": {
    "HTTP_API_BASE_URL": "https://your-endpoint.com",
    "API_KEY": "your-api-key",
    "SAM3_API_BASE_URL": "https://your-sam3-endpoint.com"
  }
}
```

或通过命令行参数：
```bash
npx -y @avclabs.ai/media-mcp@latest --base-url https://your-endpoint.com --api-key your-api-key --sam3-base-url https://your-sam3-endpoint.com
```

## 推荐的工作流程

本项目提供了**同步**和**异步**两种模式。

**由于 MCP Agent 对单个 tool 调用通常有约 60 秒的超时限制**，处理时间较长的任务（视频增强）强烈建议使用**异步模式**：

### 异步模式（推荐）

**视频增强**：
1. 调用 `create_task` 创建任务 → 立即获得 `task_id`
2. 等待几秒后，调用 `get_task_status` 查询状态
3. 如果 `status` 为 `processing`，继续等待并重复步骤 2
4. 如果 `status` 为 `completed`，任务完成，结果中包含 `video_url`
5. 如果 `status` 为 `failed`，任务失败，结果中包含 `error_message`

### 同步模式（简单场景）

**视频增强**：
- 调用 `enhance_video_sync` → 服务器内部自动轮询
- 默认最多等待50秒
- 如果50秒内完成，直接返回结果
- 如果50秒未完成，返回 `task_id` 和提示，让 Agent 切换到 `get_task_status` 继续查询

**图像分割 (SAM3)**：
- 调用 `sam3_predict` → 服务器内部自动轮询
- 默认最多等待50秒（25次 × 2秒轮询间隔）
- 如果50秒内完成，直接返回分割结果
- 如果50秒未完成，返回截断提示，告知任务仍在处理中

## 使用示例

配置完成后，用自然语言对 AI 说：

> "帮我把这个视频增强到 1080p：https://example.com/video.mp4"

> "把我桌面的 video.mp4 提升到 2k 画质"

> "帮我分析这张图片，找出里面的所有物体：C:\\Users\\xxx\\photo.png"

> "用 SAM3 分割这张图片，prompt 是 'find all cars'"

AI 会根据任务复杂度自动选择同步或异步工具完成任务。

## 提供的 Tools

### 视频增强

#### create_task

创建视频增强任务（异步）。

> **推荐使用**：适用于绝大多数场景，尤其是时长超过10秒的视频，可避免超时和长时间阻塞连接。

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

#### get_task_status

查询视频增强任务状态。

> 返回值中的 `status` 字段可能为：`processing`（处理中）、`completed`（已完成）、`failed`（失败）。如果 `status` 为 `processing`，你需要等待几秒后再次调用此工具轮询。

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
  "message": "任务仍在处理中，请稍后再查询"
}
```

其中 `message` 字段只在 `status` 为 `processing` 时出现，提示 Agent 继续等待。

#### enhance_video_sync

同步增强视频（阻塞等待完成）。

> **仅适合短视频（预计处理时间 < 1 分钟）。** 如果任务在50秒内未完成，工具会提前返回并包含 `task_id`，你需要使用 `get_task_status` 继续查询。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `video_source` | string | 是 | - | 视频 URL 或本地文件路径 |
| `type` | string | 否 | `url` | `url` 或 `local` |
| `resolution` | string | 否 | `720p` | 目标分辨率 |
| `poll_interval` | number | 否 | `5` | 轮询间隔（秒） |
| `timeout` | number | 否 | `50` | 同步等待超时时间（秒），超过后主动返回 |

**截断返回示例（50秒未完成）：**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "任务仍在处理中（已等待 50 秒）。请使用 get_task_status 工具继续查询此任务状态。",
  "note": "此工具对长任务的同步等待已被截断，请切换到 get_task_status 轮询模式。"
}
```

### 图像分割 (SAM3)

#### sam3_predict

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

**截断返回示例（50秒未完成）：**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited about 50 seconds). Please retry later or record this task_id for manual follow-up.",
  "note": "The synchronous wait for this long-running task has been truncated."
}
```

## 常见问题

### Agent 调用工具时报超时怎么办？

这是本项目重点解决的问题。MCP Agent（如 Claude、Cursor）对单个 tool 调用通常有约 60 秒的超时限制。如果任务处理时间超过此限制，Agent 会报错并切断连接。

**解决方案：**

1. **优先使用异步工具**：对于视频增强等耗时任务，始终使用 `create_task` + `get_task_status`。这些工具每次调用都是瞬间返回的，不会触发超时。

2. **同步工具的截断机制**：`enhance_video_sync` 已在内部设置了50秒的截断限制。如果任务未在50秒内完成，工具会主动返回 `task_id`，并提示 Agent 使用 `get_task_status` 继续跟进。

3. **SAM3 的截断机制**：`sam3_predict` 默认轮询25次（约50秒），如果任务未完成会返回截断提示，告知任务仍在处理中。

4. **调整 SAM3 轮询参数**（高级）：如果你确定 SAM3 任务通常很快（例如10秒内），可以通过环境变量增加轮询次数：
   ```bash
   SAM3_POLL_MAX_ATTEMPTS=60
   ```
   但请确保总等待时间不超过 Agent 的超时限制。

### 拖拽附件后提示找不到文件？

这是 stdio MCP 的已知限制。当通过 Agent 界面拖拽或上传附件时，文件路径通常不会自动传给 MCP Server。

**解决方法：**

1. **同时提供路径**（推荐）：拖拽图片后，在文字中补充说明图片的本地绝对路径：
   > "请处理这张图片 `D:\\photos\\cat.jpg`，找出里面的猫"

2. **等待自动编码**：Claude 可能会自动将图片编码为 base64 传入。如果成功，无需额外操作。

3. **回答路径询问**：如果 Claude 询问图片路径，直接回复本地绝对路径即可。

### 三种输入方式有优先级吗？

没有严格优先级。Claude 会根据对话上下文自动选择最合适的方式：

- 你提供了本地路径 → 使用 `imagePath`
- 你提供了网络链接 → 使用 `imageUrl`
- 你拖拽了附件且没有路径 → 尝试 `imageBase64`

### 支持哪些图片格式？

支持常见格式：PNG、JPG、JPEG、BMP、WebP 等。建议优先使用 PNG 或 JPG。

### URL 图片下载失败怎么办？

确保 URL 是**公开可访问**的，不需要登录、Cookie 或签名。如果图片在需要身份验证的服务上（如私有 S3 Bucket、需要登录的图床），请先下载到本地再使用 `imagePath`。

### Base64 图片太大怎么办？

如果图片很大（如 4K 分辨率），base64 编码后的数据会非常大，可能导致传输变慢。建议：

1. 使用 `imagePath` 代替
2. 或先将图片压缩后再编码

## 文件上传说明

当 `type` 为 `"local"` 时，MCP Server 会：
1. 读取本地文件
2. 通过预签名 URL 直传到 TOS 对象存储
3. **最大文件大小：100MB**

## 故障排查

### "command not found: npx"

安装 Node.js >= 18：https://nodejs.org/

### "错误: 需要提供 --api-key 或设置 API_KEY"

API Key 缺失，请检查配置中的 `env.API_KEY`。

### MCP Server 在客户端显示红色/错误

查看日志：
- **Claude Desktop macOS**：`~/Library/Logs/Claude/mcp*.log`
- **Claude Desktop Windows**：`%APPDATA%\Claude\logs\mcp*.log`
- **Cursor**：Output 面板 > MCP

### "TOS 上传失败"

通常是签名不匹配，请确认 `HTTP_API_BASE_URL` 和 `API_KEY` 正确且有效。

## 全局安装（可选）

如果你不想每次都用 `npx`：

```bash
npm install -g @avclabs.ai/media-mcp
```

然后在配置中使用 `"command": "media-mcp"` 配合 `"args": ["--api-key", "your-api-key"]` 。

## License

MIT License - 详见 [LICENSE](LICENSE) 文件
