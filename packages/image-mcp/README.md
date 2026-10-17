# image-mcp (Node.js)

English | [中文](https://github.com/avclabs/media-mcp/blob/main/packages/image-mcp/README_CN.md)

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/image-mcp)](https://www.npmjs.com/package/@avclabs.ai/image-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for AVCLabs image enhancement, colorization, and denoising — one
function per server, so your client session only loads the image tool
definitions.

## Tools

- `enhance_image_sync` — Enhance image quality and optimize faces (supports URL or local file upload)
- `colorize_image_sync` — Colorize black-and-white photos (supports URL or local file upload)
- `denoise_image_sync` — Remove noise from images (supports URL or local file upload)
- `get_image_task_status` — Query image task status (for polling after sync timeout)

## Prerequisites

- **Node.js >= 18** (check: `node --version`)
- **API Key** (required for authentication)

## Install

Use `npx` directly in your MCP client config. The package ships a single
`image-mcp` bin (plain `npx -y @avclabs.ai/image-mcp` works too); the snippets
use the explicit `-p <package> <bin>` form to pin the exact binary.

### Claude Code (CLI)

Run `/mcp` in Claude Code, find the **"User MCPs"** config file path
(commonly `~/.claude.json`), and paste:

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

**Settings > Tools & MCPs > Add New MCP Server** — Type `command`:

```bash
env API_KEY=your-api-key npx -y -p @avclabs.ai/image-mcp@latest image-mcp
```

Or edit `~/.cursor/mcp.json` with the same JSON as above.

### Global install (optional)

```bash
npm install -g @avclabs.ai/image-mcp
```

Then use `"command": "image-mcp"` with `"args": ["--api-key", "your-api-key"]`.

## Verify Installation

After restarting your client you should see exactly 4 tools:
`enhance_image_sync`, `colorize_image_sync`, `denoise_image_sync`, and
`get_image_task_status`.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | - | API authentication key |
| `IMAGE_API_BASE_URL` | No | Falls back to `HTTP_API_BASE_URL` | Optional image endpoint override; omit for the shared production server |
| `HTTP_API_BASE_URL` | No | `https://mcp.avc.ai/enhance` | Fallback endpoint when `IMAGE_API_BASE_URL` is unset |

`IMAGE_API_BASE_URL` is an optional override for deployments that split the
public image endpoint. When omitted (the recommended setup), image calls share
the production enhancement endpoint — the same fallback behavior as the
all-in-one package.

CLI equivalents: `--api-key`, `--image-base-url`, `--base-url` (fallback), and
`--config <path>`.

## Recommended Workflow

1. **For most images**: call `enhance_image_sync` / `colorize_image_sync` / `denoise_image_sync` directly — the tool handles everything and returns the result
2. **If truncated**: the tool returns a `task_id` (the default wait budget is 45 seconds), then use `get_image_task_status` to poll until `status` becomes `completed` or `failed`
3. **If failed**: check the `error_message` field for details

**Supported image formats**: PNG, JPG, JPEG, BMP, WebP, etc.

**Two upload methods**:
1. **URL upload**: provide a publicly accessible image URL (`type: "url"`)
2. **Local upload**: provide a local file path, the MCP Server auto-uploads to TOS object storage (`type: "local"`, max file size: 100MB)

## Tool Reference

| Tool | Function | Use Case |
|---|---|---|
| `enhance_image_sync` | Image quality enhancement & face optimization | Blurry, low-resolution, or degraded photos |
| `colorize_image_sync` | Black-and-white photo colorization | Restoring old B&W photos with realistic colors |
| `denoise_image_sync` | Image noise removal | Noisy/grainy photos taken in low light |

All three tools are **synchronous** — the tool blocks until the image is
processed or the wait budget is reached, and share the same behavior pattern.

### enhance_image_sync

Synchronously enhance an image to improve quality and optimize faces.

> The tool internally creates a task and polls for the result. If processing completes within the timeout (default 45s), the result is returned directly. If not, the tool returns early with a `task_id` — use `get_image_task_status` to continue polling.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `scale` | number | No | `2` | Enhancement scale multiplier (e.g. `2` for 2x, `4` for 4x upscaling) |
| `poll_interval` | number | No | `5` | Poll interval in seconds (0.5-30) |
| `timeout` | number | No | `45` | Sync wait timeout in seconds (1-45), returns early when exceeded |

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

**Truncated return (not completed within the default 45-second budget):**
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

Synchronously colorize a black-and-white photo with AI.

> Best for old black-and-white photos. The AI will add realistic colors to the image. Supports the same parameters and return format as `enhance_image_sync`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `poll_interval` | number | No | `5` | Poll interval in seconds (0.5-30) |
| `timeout` | number | No | `45` | Sync wait timeout in seconds (1-45), returns early when exceeded |

**Returns:** Same format as `enhance_image_sync`.

### denoise_image_sync

Synchronously remove noise from an image.

> Best for grainy/noisy photos taken in low-light conditions or with high ISO settings. Supports the same parameters and return format as `enhance_image_sync`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `image_source` | string | Yes | - | Image URL or local file path (URL must be publicly accessible, links requiring login or signatures are not supported) |
| `type` | string | No | `url` | `url` or `local` |
| `poll_interval` | number | No | `5` | Poll interval in seconds (0.5-30) |
| `timeout` | number | No | `45` | Sync wait timeout in seconds (1-45), returns early when exceeded |

**Returns:** Same format as `enhance_image_sync`.

### get_image_task_status

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

## Troubleshooting

- **"API key is required"** — check `env.API_KEY` in your config.
- **"TOS upload failed"** — usually a signature mismatch; confirm `IMAGE_API_BASE_URL` (or its `HTTP_API_BASE_URL` fallback) and `API_KEY` are correct and active.
- **URL image download fails** — ensure the URL is publicly accessible (no login, cookies, or signatures); otherwise download it locally first and use `type: "local"`.
- **Server shows red/error in client** — check the client's MCP logs (e.g. `~/Library/Logs/Claude/mcp*.log` on macOS).

Pricing, API keys, and quotas: https://mcp.avc.ai/ . For the full FAQ see the
[legacy all-in-one README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README.md#faq).

## License

MIT License — see [LICENSE](LICENSE).
