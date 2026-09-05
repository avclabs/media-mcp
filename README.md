# media-mcp (Node.js)

English | [中文](https://github.com/avclabs/media-mcp/blob/main/README_CN.md)

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/media-mcp)](https://www.npmjs.com/package/@avclabs.ai/media-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A video enhancement, image enhancement/colorization/denoising, and image segmentation service based on the MCP protocol, acting as an MCP Client-Server to interact with backend HTTP Servers.

## Features

Provides the following MCP Tools:

**Video Enhancement**
- `create_task` - Create a video enhancement task (supports URL or local file upload)
- `get_task_status` - Query task status
- `enhance_video_sync` - Synchronously enhance video (blocking wait, truncated at ~50s by default)

**Image Enhancement**
- `enhance_image_sync` - Enhance image quality and optimize faces (supports URL or local file upload)
- `colorize_image_sync` - Colorize black-and-white photos (supports URL or local file upload)
- `denoise_image_sync` - Remove noise from images (supports URL or local file upload)
- `get_image_task_status` - Query image task status (for polling after sync timeout)

**Image Segmentation (SAM3)**
- `sam3_predict` - SAM3 image segmentation (supports local path, URL, or Base64 image)
- `get_sam3_task_status` - Query SAM3 task status (for polling after sync timeout)

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
  env API_KEY=your-api-key npx -y @avclabs.ai/media-mcp@latest
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
2. You should see: `create_task`, `get_task_status`, `enhance_video_sync`, `enhance_image_sync`, `colorize_image_sync`, `denoise_image_sync`, `get_image_task_status`, `sam3_predict`, `get_sam3_task_status`

## Configuration Options

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | - | API authentication key (shared by video enhancement and SAM3) |
| `HTTP_API_BASE_URL` | No | `https://mcp.avc.ai/enhance` | Video enhancement service endpoint |
| `SAM3_API_BASE_URL` | No | `https://mcp.avc.ai/sam` | SAM3 service endpoint |
| `SAM3_POLL_INTERVAL` | No | `2000` | SAM3 polling interval (milliseconds) |
| `SAM3_POLL_MAX_ATTEMPTS` | No | `25` | SAM3 maximum polling attempts |

### Custom Endpoint

```json
{
  "env": {
    "HTTP_API_BASE_URL": "https://your-endpoint.com",
    "API_KEY": "your-api-key",
    "SAM3_API_BASE_URL": "https://your-sam3-endpoint.com"
  }
}
```

Or via CLI args:
```bash
npx -y @avclabs.ai/media-mcp@latest --base-url https://your-endpoint.com --api-key your-api-key --sam3-base-url https://your-sam3-endpoint.com
```

## Recommended Workflow

This project provides both **synchronous** and **asynchronous** modes.

**Because MCP Agents typically enforce a ~60-second timeout per tool call**, tasks with longer processing times (video enhancement) are strongly recommended to use **asynchronous mode**:

### Asynchronous Mode (Recommended)

**Video Enhancement:**
1. Call `create_task` to create a task → immediately get `task_id`
2. Wait a few seconds, then call `get_task_status` to query the status
3. If `status` is `processing`, continue waiting and repeat step 2
4. If `status` is `completed`, the task is done and the result contains `video_url`
5. If `status` is `failed`, the task failed and the result contains `error_message`

### Synchronous Mode (Simple Scenarios)

**Video Enhancement:**
- Call `enhance_video_sync` → the server polls internally
- Defaults to a maximum wait of 50 seconds
- If completed within 50 seconds, returns the result directly
- If not completed within 50 seconds, returns `task_id` and instructions for the Agent to switch to `get_task_status`

**Image Segmentation (SAM3):**
- Call `sam3_predict` → the server polls internally
- Defaults to a maximum wait of 50 seconds (25 attempts × 2-second polling interval)
- If completed within 50 seconds, returns the segmentation result directly
- If not completed within 50 seconds, returns a truncation notice indicating the task is still processing

## Usage Examples

Once configured, ask your AI agent naturally:

> "Enhance this video to 1080p: https://example.com/video.mp4"

> "Improve the quality of /Users/me/Desktop/video.mp4 to 2k"

> "Enhance this image: https://example.com/photo.jpg"

> "Colorize this black-and-white photo: /Users/me/Desktop/old_photo.png"

> "Remove noise from this image: C:\\Users\\xxx\\noisy.jpg"

> "Analyze this image and find all objects: C:\\Users\\xxx\\photo.png"

> "Use SAM3 to segment this image, prompt: 'find all cars'"

The agent will automatically choose sync or async tools based on task complexity.

## Provided Tools

### Video Enhancement

#### create_task

Create an asynchronous video enhancement task.

> **Recommended for most use cases.** Ideal for longer videos (over 10 seconds) to avoid timeouts and blocking the connection.

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
  "status": "processing"
}
```

#### get_task_status

Query video enhancement task status.

> The returned `status` field can be: `processing`, `completed`, or `failed`. If `status` is `processing`, you need to wait a few seconds and call this tool again.

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
  "video_url": "https://...",
  "message": "Task is still processing, please check again later"
}
```

The `message` field only appears when `status` is `processing`, prompting the Agent to continue waiting.

#### enhance_video_sync

Synchronously enhance video (blocks until completion).

> **Best for short videos (estimated processing time < 1 minute).** If the task is not completed within 50 seconds, the tool returns early with a `task_id`, and you need to use `get_task_status` to continue querying.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `video_source` | string | Yes | - | Video URL or local file path |
| `type` | string | No | `url` | `url` or `local` |
| `resolution` | string | No | `720p` | Target resolution |
| `poll_interval` | number | No | `5` | Poll interval (seconds) |
| `timeout` | number | No | `50` | Sync wait timeout (seconds), returns early when exceeded |

**Truncated return example (not completed within 50s):**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 50 seconds). Please use get_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to get_task_status polling."
}
```

### Image Enhancement

Three image processing tools are provided, each targeting a specific use case:

| Tool | Function | Use Case |
|---|---|---|
| `enhance_image_sync` | Image quality enhancement & face optimization | Blurry, low-resolution, or degraded photos |
| `colorize_image_sync` | Black-and-white photo colorization | Restoring old B&W photos with realistic colors |
| `denoise_image_sync` | Image noise removal | Noisy/grainy photos taken in low light |

All three tools share the same parameters and behavior pattern. They are **synchronous** — the tool blocks until the image is processed or the timeout is reached.

**Supported image formats**: PNG, JPG, JPEG, BMP, WebP, etc.

**Two upload methods**:
1. **URL upload**: provide a publicly accessible image URL (`type: "url"`)
2. **Local upload**: provide a local file path, the MCP Server auto-uploads to TOS object storage (`type: "local"`, max file size: 100MB)

#### enhance_image_sync

Synchronously enhance an image to improve quality and optimize faces.

> The tool internally creates a task and polls for the result. If processing completes within the timeout (default 50s), the result is returned directly. If not, the tool returns early with a `task_id` — use `get_image_task_status` to continue polling.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `scale` | number | No | `2` | Enhancement scale multiplier (e.g. `2` for 2x, `4` for 4x upscaling) |
| `poll_interval` | number | No | `5` | Poll interval in seconds |
| `timeout` | number | No | `50` | Sync wait timeout in seconds, returns early when exceeded |

**Normal completion return:**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "progress": 100,
  "image_url": "https://..."
}
```

**Truncated return (not completed within 50s):**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 50 seconds). Please use get_image_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to get_image_task_status polling."
}
```

#### colorize_image_sync

Synchronously colorize a black-and-white photo with AI.

> Best for old black-and-white photos. The AI will add realistic colors to the image. Supports the same parameters and return format as `enhance_image_sync`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `poll_interval` | number | No | `5` | Poll interval in seconds |
| `timeout` | number | No | `50` | Sync wait timeout in seconds, returns early when exceeded |

**Returns:** Same format as `enhance_image_sync`.

#### denoise_image_sync

Synchronously remove noise from an image.

> Best for grainy/noisy photos taken in low-light conditions or with high ISO settings. Supports the same parameters and return format as `enhance_image_sync`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `poll_interval` | number | No | `5` | Poll interval in seconds |
| `timeout` | number | No | `50` | Sync wait timeout in seconds, returns early when exceeded |

**Returns:** Same format as `enhance_image_sync`.

#### get_image_task_status

Query image processing task status. Used to poll for results when a sync tool times out.

> The returned `status` field can be: `processing`, `completed`, or `failed`. If `status` is `processing`, wait a few seconds and call this tool again.

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
  "image_url": "https://...",
  "message": "Task is still processing, please check again later"
}
```

The `message` field only appears when `status` is `processing`, prompting the Agent to continue waiting.

#### Recommended Workflow for Image Tools

1. **For most images**: Call `enhance_image_sync` / `colorize_image_sync` / `denoise_image_sync` directly — the tool handles everything and returns the result
2. **If truncated**: The tool returns a `task_id`, then use `get_image_task_status` to poll until `status` becomes `completed` or `failed`
3. **If failed**: Check the `error_message` field for details

### Image Segmentation (SAM3)

#### sam3_predict

Analyze an image using the SAM3 segmentation API to generate inference results (masks, boxes, scores).

**Parameters:**

Image input (choose one, must provide exactly one):

- `imagePath` (string): Absolute path of a local image file. Supports common formats (PNG, JPG, JPEG).
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

- `prompt` (string, required): English text prompt specifying the target object to segment. Since the SAM3 model only accepts English prompts, provide an English description. If the user provides Chinese or other non-English text, the Agent will automatically translate it before calling the tool.

**Normal completion return:**

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

**Truncated return example (not completed within 50s):**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited about 50 seconds). Please retry later or record this task_id for manual follow-up.",
  "note": "The synchronous wait for this long-running task has been truncated."
}
```

#### get_sam3_task_status

Query SAM3 segmentation task status. Used to poll for results when `sam3_predict` times out.

> The returned `status` field can be: `processing`, `completed`, or `failed`. If `status` is `processing`, wait a few seconds and call this tool again.

| Parameter | Type | Required |
|---|---|---|
| `task_id` | string | Yes |

**Completed return:**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "completed",
  "result_url": "https://..."
}
```

**Processing return:**
```json
{
  "success": true,
  "task_id": "xxx",
  "status": "processing",
  "message": "Task is still processing, please check again later."
}
```

**Failed return:**
```json
{
  "success": false,
  "task_id": "xxx",
  "status": "failed",
  "error": "Task failed"
}
```

## FAQ

### Agent reports timeout when calling tools?

This is the primary issue this project addresses. MCP Agents (such as Claude, Cursor) typically enforce a ~60-second timeout per tool call. If task processing exceeds this limit, the Agent will error and disconnect.

**Solutions:**

1. **Prefer asynchronous tools**: For video enhancement and other time-consuming tasks, always use `create_task` + `get_task_status`. These tools return instantly on each call and will not trigger timeouts.

2. **Sync tool truncation mechanism**: `enhance_video_sync` has an internal 50-second truncation limit. If the task is not completed within 50 seconds, the tool proactively returns a `task_id` and instructs the Agent to use `get_task_status` to follow up.

3. **SAM3 truncation mechanism**: `sam3_predict` defaults to 25 polling attempts (~50 seconds). If the task is not completed, it returns a truncation notice indicating the task is still processing.

4. **Adjust SAM3 polling parameters** (advanced): If you are confident that SAM3 tasks are usually fast (e.g., under 10 seconds), you can increase polling attempts via environment variable:
   ```bash
   SAM3_POLL_MAX_ATTEMPTS=60
   ```
   But ensure the total wait time does not exceed your Agent's timeout limit.

### Drag-and-drop attachment says file not found?

This is a known limitation of stdio MCP. When dragging or uploading an attachment through the Agent interface, the file path is usually not automatically passed to the MCP Server.

**Solutions:**

1. **Provide the path simultaneously** (recommended): After dragging the image, add the local absolute path in your message:
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

### "Error: --api-key argument or API_KEY environment variable is required"

Your API Key is missing. Double-check the `env.API_KEY` in your config.

### MCP Server shows red/error in client

Check logs:
- **Claude Desktop macOS**: `~/Library/Logs/Claude/mcp*.log`
- **Claude Desktop Windows**: `%APPDATA%\Claude\logs\mcp*.log`
- **Cursor**: Output panel > MCP

### "TOS upload failed"

Usually a signature mismatch. Ensure your `HTTP_API_BASE_URL` and `API_KEY` are correct and active.

## Global Install (Alternative)

If you prefer not using `npx` every time:

```bash
npm install -g @avclabs.ai/media-mcp
```

Then use `"command": "media-mcp"` with `"args": ["--api-key", "your-api-key"]` in your config.

## Development and Release

This package runs locally in the MCP client and is released through npm; it is not a remote Node daemon. The sibling `media-mcp-api-http-server` currently provides the video/account backend only, while image enhancement and SAM3 remain separate production dependencies. Before publishing, run:

```bash
npm ci
npm run release:verify
```

See the [release guide](https://github.com/avclabs/media-mcp/blob/main/docs/RELEASE.md) for version synchronization, publish order, smoke tests, and the relationship with the portal/backend deployment.

## License

MIT License - See [LICENSE](LICENSE) file for details
