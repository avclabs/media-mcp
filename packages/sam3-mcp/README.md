# sam3-mcp (Node.js)

English | [中文](https://github.com/avclabs/media-mcp/blob/main/packages/sam3-mcp/README_CN.md)

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/sam3-mcp)](https://www.npmjs.com/package/@avclabs.ai/sam3-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for SAM3 image segmentation — one function per server, so your
client session only loads the SAM3 tool definitions.

## Tools

- `sam3_predict` — SAM3 image segmentation (supports local path, URL, or Base64 image)
- `get_sam3_task_status` — Query SAM3 task status (for polling after the wait budget is exhausted)

## Prerequisites

- **Node.js >= 18** (check: `node --version`)
- **API Key** (required for authentication)

## Install

Use `npx` directly in your MCP client config. The package ships a single
`sam3-mcp` bin (plain `npx -y @avclabs.ai/sam3-mcp` works too); the snippets
use the explicit `-p <package> <bin>` form to pin the exact binary.

### Claude Code (CLI)

Run `/mcp` in Claude Code, find the **"User MCPs"** config file path
(commonly `~/.claude.json`), and paste:

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

**Settings > Tools & MCPs > Add New MCP Server** — Type `command`:

```bash
env API_KEY=your-api-key npx -y -p @avclabs.ai/sam3-mcp@latest sam3-mcp
```

Or edit `~/.cursor/mcp.json` with the same JSON as above.

### Global install (optional)

```bash
npm install -g @avclabs.ai/sam3-mcp
```

Then use `"command": "sam3-mcp"` with `"args": ["--api-key", "your-api-key"]`.

## Verify Installation

After restarting your client you should see exactly 2 tools: `sam3_predict`
and `get_sam3_task_status`.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | - | API authentication key |
| `SAM3_API_BASE_URL` | No | `https://mcp.avc.ai/sam` | SAM3 service endpoint |
| `SAM3_POLL_INTERVAL_MS` | No | `2000` | Polling interval in milliseconds (`SAM3_POLL_INTERVAL` is a deprecated alias) |
| `SAM3_POLL_MAX_ATTEMPTS` | No | `25` | Maximum status queries; the time budget is interval × attempts, and whichever limit is hit first truncates the wait |

CLI equivalents: `--api-key`, `--sam3-base-url`, `--sam3-poll-interval`,
`--sam3-poll-max-attempts` (and `--config <path>`). Invalid explicit poll
values abort startup before any task can be submitted.

## Recommended Workflow

- Call `sam3_predict` → the server polls internally
- Defaults to at most 25 status queries within a ~50-second budget (25 × 2-second interval; whichever limit is reached first ends the wait)
- If the task completes within the budget, the segmentation result is returned directly
- If not, a truncation notice (with `task_id`) is returned; poll `get_sam3_task_status` until `completed` or `failed`

The wait budget covers only status polling after the task is created — source
preparation, upload, task submission, and the final result download are not
part of it, so the total tool call can take longer than the budget.

## Tool Reference

### sam3_predict

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
  "message": "Task is still processing (waited 50 seconds, 25 status queries). Please use get_sam3_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to task status polling."
}
```

**Result download failure (completed task, missing result):**
If the task completed but the result file could not be downloaded, the tool returns `success: false` with the `task_id` and `status: "completed"`. Use `get_sam3_task_status` with that `task_id` to recover the result. Do not resubmit the task.
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

## Troubleshooting

- **"API key is required"** — check `env.API_KEY` in your config.
- **Drag-and-drop attachment says file not found** — stdio MCP limitation; also provide the local absolute path in your message, or let the client encode the image as base64.
- **URL image download fails** — ensure the URL is publicly accessible (no login, cookies, or signatures).
- **Server shows red/error in client** — check the client's MCP logs (e.g. `~/Library/Logs/Claude/mcp*.log` on macOS).

Pricing, API keys, and quotas: https://mcp.avc.ai/ . For the full FAQ see the
[legacy all-in-one README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README.md#faq).

## License

MIT License — see [LICENSE](LICENSE).
