# media-mcp (Node.js)

[中文](https://github.com/avclabs/media-mcp/blob/main/README.md) | English

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/media-mcp)](https://www.npmjs.com/package/@avclabs.ai/media-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A video enhancement and image segmentation service based on the MCP protocol, acting as an MCP Client-Server to interact with backend HTTP Servers.

## Features

Provides the following MCP Tools:
- `create_task` - Create a video enhancement task (supports URL or local file upload)
- `get_task_status` - Query task status
- `enhance_video_sync` - Synchronously enhance video (blocking wait)
- `sam3_predict` - SAM3 image segmentation (supports local path, URL, or Base64 image)

## Prerequisites

- **Node.js >= 18** (check: `node --version`)
- **API Key** (required for authentication)

## Lazy Install (Recommended)

If your AI Agent has a known MCP config path, just copy the line below and send it to your AI:

```
Install the npm package @avclabs.ai/media-mcp as an MCP server. My API Key is: sk-xxxxxxxx.
```

The AI will automatically:
1. Detect your MCP client
2. Find the config file path
3. Write the correct configuration
4. Prompt you to restart the client

## Manual Install

No installation needed. Use `npx` directly in your MCP client config.

### 1. Claude Code (CLI)

Run in Claude Code:

```
/mcp
```

Check the output for the **"User MCPs"** section to find the config file path, then edit that file.

Common paths (if `/mcp` is unavailable):
- **Windows**: `%USERPROFILE%\.claude.json`
- **macOS**: `~/.claude.json`
- **Linux**: `~/.claude.json`
- **Legacy/Alternative**: `~/.claude/mcp.json`

Paste this (replace `your-api-key`):

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

Save and run `/mcp` to verify it's loaded.

### 2. Cursor

Go to **Settings > Tools & MCPs > Add New MCP Server**:

- **Name**: `video-enhancement`
- **Type**: `command`
- **Command**:
  ```bash
  env HTTP_API_KEY=your-api-key npx -y @avclabs.ai/media-mcp@latest
  ```

Or edit `~/.cursor/mcp.json`:

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

## Verify Installation

After restarting your client, check if the tools are available:

1. Or ask: "What tools do you have available?"
2. You should see: `create_task`, `get_task_status`, `enhance_video_sync`, `sam3_predict`

## Configuration Options

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | - | API authentication key (shared by video enhancement and SAM3) |
| `HTTP_API_BASE_URL` | No | `https://mcp.avc.ai/enhance` | Video enhancement service endpoint |
| `SAM3_API_BASE_URL` | No | `https://mcp.avc.ai/sam` | SAM3 service endpoint |
| `SAM3_POLL_INTERVAL` | No | `2000` | Polling interval (milliseconds) |
| `SAM3_POLL_MAX_ATTEMPTS` | No | `60` | Maximum polling attempts |

### Custom Endpoint

```json
{
  "env": {
    "HTTP_API_BASE_URL": "https://your-endpoint.com",
    "HTTP_API_KEY": "your-api-key"
  }
}
```

Or via CLI args:
```bash
npx -y @avclabs.ai/media-mcp@latest --base-url https://your-endpoint.com --api-key your-api-key --sam3-base-url http://localhost:8001 --sam3-api-key your-sam3-key
```

## Usage Examples

Once configured, ask your AI agent naturally:

> "Enhance this video to 1080p: https://example.com/video.mp4"

> "Improve the quality of /Users/me/Desktop/video.mp4 to 2k"

The agent will automatically call the appropriate tools.

> "Analyze this image and find all objects: C:\Users\xxx\photo.png"
>
> "Use SAM3 to segment this image, prompt: 'find all cars'"

## Provided Tools

### create_task

Create an asynchronous video enhancement task.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `video_source` | string | Yes | - | Video URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `resolution` | string | No | `720p` | `480p`, `540p`, `720p`, `1080p`, `2k` |

**Returns:**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "wait"
}
```

### get_task_status

Query task status.

| Parameter | Type | Required |
|---|---|---|
| `task_id` | string | Yes |

**Returns:**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "progress": 100,
  "video_url": "https://..."
}
```

### enhance_video_sync

Synchronously enhance video (blocks until completion).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `video_source` | string | Yes | - | Video URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `resolution` | string | No | `720p` | Target resolution |
| `poll_interval` | number | No | `5` | Poll interval (seconds) |
| `timeout` | number | No | `600` | Timeout (seconds) |

### sam3_predict

Analyze an image using the SAM3 segmentation API to generate inference results (masks, boxes, scores).

**Parameters:**

Image input (choose one, must provide exactly one):

- `imagePath` (string): Absolute path of a local image file. Supports common formats (PNG, JPG, JPEG, BMP, WebP).
  - Example: `"C:\\Users\\xxx\\photo.png"`, `"/home/user/images/cat.jpg"`
  - Use when: The user explicitly provides a local file path

- `imageUrl` (string): Publicly accessible URL of the image.
  - Example: `"https://example.com/photo.jpg"`
  - Use when: The image is already online and the user provides a link
  - Note: The URL must be publicly accessible. Links requiring login or signatures are not supported

- `imageBase64` (string): Base64-encoded image data.
  - Example: `"iVBORw0KGgoAAAANSUhEUgAA..."`
  - Use when: The user drags or uploads an image attachment, and the Agent encodes it as base64
  - Note: Large images will produce very large base64 strings, which may slow transmission

Other parameters:

- `prompt` (string, required): English text prompt specifying the target object to segment. Examples: `"person"`, `"car"`, `"a cat sitting on a sofa"`. Since the SAM3 model only accepts English prompts, provide an English description. If the user provides Chinese or other non-English text, the Agent will automatically translate it before calling the tool.

**Returns:**

After inference completes, returns a JSON string containing three fields:

- **`masks`**: 2D array. Each element is a binary mask (values 0 or 1) with the same dimensions as the input image, marking the pixel-level location of detected objects. The i-th mask corresponds to the i-th detected object instance.
- **`boxes`**: 2D array. Each element is a bounding box in `[x1, y1, x2, y2]` format, representing the rectangular region of the detected object. `x1`, `y1` are the top-left coordinates; `x2`, `y2` are the bottom-right coordinates.

  Coordinate system: The top-left corner of the image is the origin `(0, 0)`. The x-axis increases to the right, and the y-axis increases downward, in pixels. For example, `[120, 80, 300, 450]` means the region starts 120px from the left edge and 80px from the top edge, extending to 300px from the left and 450px from the top. Width = `x2 - x1 = 180px`, Height = `y2 - y1 = 370px`.
- **`scores`**: 1D array. Each element is a confidence score for the corresponding detection result, ranging from 0 to 1. Higher scores indicate greater model confidence.

Example result JSON:

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

## FAQ

### Drag-and-drop attachment says file not found?

This is a known limitation of stdio MCP. When dragging or uploading an attachment through the Agent interface, the file path is usually not automatically passed to the MCP Server.

**Solutions:**

1. **Provide the path simultaneously** (recommended): After dragging the image,补充 the local absolute path in your message:
   > "Please analyze this image `D:\\photos\\cat.jpg` and find the cat"

2. **Wait for auto-encoding**: Claude may automatically encode the image as base64. If successful, no extra action is needed.

3. **Reply to path inquiry**: If Claude asks for the image path, simply reply with the local absolute path.

### Is there a priority among the three input methods?

There is no strict priority. Claude will automatically choose the most appropriate method based on conversation context:

- You provided a local path → uses `imagePath`
- You provided a web link → uses `imageUrl`
- You dragged an attachment without a path → tries `imageBase64`

### What image formats are supported?

Common formats: PNG, JPG, JPEG, BMP, WebP, etc. PNG or JPG is recommended.

### What if URL image download fails?

Ensure the URL is **publicly accessible**, requiring no login, cookies, or signatures. If the image is on a service requiring authentication (e.g., private S3 Bucket, login-required image host), download it locally first and use `imagePath`.

### What if the base64 image is too large?

If the image is very large (e.g., 4K resolution), the base64-encoded data will be very large and may slow transmission. Suggestions:

1. Use `imagePath` instead
2. Or compress the image before encoding

## File Upload Notes

When `type` is `"local"`:
1. File is read locally by the MCP Server
2. Uploaded directly to TOS object storage via pre-signed URL
3. **Max file size: 100MB**

## Troubleshooting

### "command not found: npx"

Install Node.js >= 18: https://nodejs.org/

### "Error:需要提供 --api-key 或设置 HTTP_API_KEY"

Your API Key is missing. Double-check the `env.HTTP_API_KEY` in your config.

### MCP Server shows red/error in client

Check logs:
- **Claude Desktop macOS**: `~/Library/Logs/Claude/mcp*.log`
- **Claude Desktop Windows**: `%APPDATA%\Claude\logs\mcp*.log`
- **Cursor**: Output panel > MCP

### "TOS 上传失败"

Usually a signature mismatch. Ensure your `HTTP_API_BASE_URL` and `HTTP_API_KEY` are correct and active.

## Global Install (Alternative)

If you prefer not using `npx` every time:

```bash
npm install -g @avclabs.ai/media-mcp
```

Then use `"command": "media-mcp"` with `"args": ["--api-key", "your-api-key"]` in your config.

## License

MIT License - See [LICENSE](LICENSE) file for details
