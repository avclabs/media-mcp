# media-mcp monorepo

English | [中文](https://github.com/avclabs/media-mcp/blob/main/README_CN.md)

[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP servers wrapping the AVCLabs hosted media services, published as one
function per npm package so an MCP client session only loads the tool
definitions it actually uses.

## Packages

| Package | Function | Tools | Bin |
|---|---|---|---|
| [`@avclabs.ai/video-mcp`](packages/video-mcp) | Video enhancement | `create_task`, `get_task_status`, `enhance_video_sync` | `video-mcp` |
| [`@avclabs.ai/image-mcp`](packages/image-mcp) | Image enhancement / colorization / denoising | `enhance_image_sync`, `colorize_image_sync`, `denoise_image_sync`, `get_image_task_status` | `image-mcp` |
| [`@avclabs.ai/sam3-mcp`](packages/sam3-mcp) | SAM3 image segmentation | `sam3_predict`, `get_sam3_task_status` | `sam3-mcp` |
| [`@avclabs.ai/media-mcp`](packages/media-mcp) | Legacy all-in-one (all 9 tools) | everything above | `media-mcp` |
| [`@avclabs.ai/media-mcp-core`](packages/core) | Shared internal library (not an MCP server) | — | — |

## Why one function per package

- **Smaller context**: MCP clients inject every tool definition (name,
  description, JSON schema) of each configured server into the session. A
  client that only needs image tools no longer pays for video and SAM3
  definitions.
- **Less tool ambiguity**: with a single `get_*_task_status` variant present,
  the model picks tools more reliably.
- **Independent enablement**: expose exactly one function per client or per
  audience (e.g. SAM3 only for the annotation team).

The legacy all-in-one `@avclabs.ai/media-mcp` keeps working unchanged for
existing configurations; see its [README](packages/media-mcp/README.md) for a
migration note.

## Quick start

Every server is a stdio MCP server over `npx`. For example, image tools only:

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

Note the `-p <package> <bin>` form: these packages install a named binary, so
plain `npx -y <package>` would run the default bin of the legacy package.
Each package README ([video](packages/video-mcp/README.md),
[image](packages/image-mcp/README.md),
[SAM3](packages/sam3-mcp/README.md)) has full install instructions for Claude
Code, Cursor, and global installs, plus the configuration variables it reads.

All packages share one `API_KEY` and the same backend defaults
(`https://mcp.avc.ai/enhance` and `https://mcp.avc.ai/sam`).

## Repository layout

```
packages/
  core/       shared library: tool registration, polling, TOS upload, config
  video-mcp/  video enhancement server (3 tools)
  image-mcp/  image processing server (4 tools)
  sam3-mcp/   SAM3 segmentation server (2 tools)
  media-mcp/  legacy all-in-one server (9 tools)
```

Domain vocabulary shared across the packages lives in
[CONTEXT.md](CONTEXT.md); decisions are recorded in [docs/adr/](docs/adr/).

## Development and release

```bash
npm ci               # installs workspaces and builds every package
npm test             # rebuild + run all package tests
npm run release:verify   # metadata gate + audit + tests + pack dry-run
node scripts/e2e-check.mjs  # stdio E2E for all four server entries
```

Maintainers: see the [release guide](docs/RELEASE.md) for publish order
(core first), versioning, tags, and smoke tests. Publishing is manual from a
clean checkout; the CI workflow runs the same verification gate on Node 22.

## License

MIT License — see [LICENSE](LICENSE).
