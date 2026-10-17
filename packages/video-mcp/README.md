# video-mcp (Node.js)

English | [中文](https://github.com/avclabs/media-mcp/blob/main/packages/video-mcp/README_CN.md)

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/video-mcp)](https://www.npmjs.com/package/@avclabs.ai/video-mcp)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for AVCLabs video enhancement — one function per server, so your
client session only loads the video tool definitions.

## Tools

- `create_task` — Create a video enhancement task (async; supports URL or local file upload)
- `get_task_status` — Query task status
- `enhance_video_sync` — Synchronously enhance video (blocking wait, truncated at ~45s by default)

## Prerequisites

- **Node.js >= 18** (check: `node --version`)
- **API Key** (required for authentication)

## Install

Use `npx` directly in your MCP client config. The package ships a single
`video-mcp` bin (plain `npx -y @avclabs.ai/video-mcp` works too); the snippets
use the explicit `-p <package> <bin>` form to pin the exact binary.

### Claude Code (CLI)

Run `/mcp` in Claude Code, find the **"User MCPs"** config file path
(commonly `~/.claude.json`), and paste:

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

**Settings > Tools & MCPs > Add New MCP Server** — Type `command`:

```bash
env API_KEY=your-api-key npx -y -p @avclabs.ai/video-mcp@latest video-mcp
```

Or edit `~/.cursor/mcp.json` with the same JSON as above.

### Global install (optional)

```bash
npm install -g @avclabs.ai/video-mcp
```

Then use `"command": "video-mcp"` with `"args": ["--api-key", "your-api-key"]`.

## Verify Installation

After restarting your client you should see exactly 3 tools: `create_task`,
`get_task_status`, and `enhance_video_sync`.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | - | API authentication key |
| `HTTP_API_BASE_URL` | No | `https://mcp.avc.ai/enhance` | Video HTTP service endpoint |

CLI equivalents: `--api-key`, `--base-url` (and `--config <path>` for an
explicit config file). Custom endpoint example:

```json
{
  "env": {
    "HTTP_API_BASE_URL": "https://your-media-endpoint.com",
    "API_KEY": "your-api-key"
  }
}
```

## Recommended Workflow

MCP agents typically enforce a ~60-second timeout per tool call, so for
longer videos use the async pair:

1. Call `create_task` to create a task → immediately get `task_id`
2. Wait a few seconds, then call `get_task_status`
3. If `status` is `processing`, wait and repeat step 2
4. If `status` is `completed`, the result contains `video_url`
5. If `status` is `failed`, the result contains `error_message`

For short videos (processing < 1 minute), call `enhance_video_sync` directly —
it polls internally and returns early with a `task_id` if the default 45-second
wait budget is exceeded, at which point you switch to `get_task_status`.

## Tool Reference

### create_task

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

### get_task_status

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

### enhance_video_sync

Synchronously enhance video (blocks until completion).

> **Best for short videos (estimated processing time < 1 minute).** If the task is not completed within the default 45-second wait budget, the tool returns early with a `task_id`, and you need to use `get_task_status` to continue querying.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `video_source` | string | Yes | - | Video URL or local file path |
| `type` | string | No | `url` | `url` or `local` |
| `resolution` | string | No | `720p` | Target resolution |
| `poll_interval` | number | No | `5` | Poll interval (seconds, 0.5-30) |
| `timeout` | number | No | `45` | Sync wait timeout in seconds (1-45), returns early when exceeded |

**Truncated return example (not completed within the default 45-second budget):**
```json
{
  "success": true,
  "status": "processing",
  "task_id": "xxx",
  "message": "Task is still processing (waited 45 seconds, 9 status queries). Please use get_task_status to continue polling.",
  "note": "The synchronous wait for this long-running task has been truncated. Switch to get_task_status polling."
}
```

## File Upload Notes

When `type` is `"local"`:
1. File is read locally by the MCP Server
2. Uploaded directly to TOS object storage via pre-signed URL
3. **Max file size: 100MB**

## Troubleshooting

- **"API key is required"** — check `env.API_KEY` in your config.
- **"TOS upload failed"** — usually a signature mismatch; confirm `HTTP_API_BASE_URL` and `API_KEY` are correct and active.
- **Server shows red/error in client** — check the client's MCP logs (e.g. `~/Library/Logs/Claude/mcp*.log` on macOS).

Pricing, API keys, and quotas: https://mcp.avc.ai/ . For the full FAQ see the
[legacy all-in-one README](https://github.com/avclabs/media-mcp/blob/main/packages/media-mcp/README.md#faq).

## License

MIT License — see [LICENSE](LICENSE).
