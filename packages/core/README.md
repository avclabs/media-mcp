# @avclabs.ai/media-mcp-core

[![npm version](https://img.shields.io/npm/v/@avclabs.ai/media-mcp-core)](https://www.npmjs.com/package/@avclabs.ai/media-mcp-core)

Internal shared library for the AVCLabs media MCP servers
([video-mcp](../video-mcp), [image-mcp](../image-mcp),
[sam3-mcp](../sam3-mcp), and the legacy
[media-mcp](../media-mcp)). It is not an MCP server itself.

## What lives here

- `tooling.ts` — tool registration wrapper (business failures surface as MCP
  `isError` results) and deadline-/attempt-aware task polling
- `tos.ts` — local media validation (extension + magic number), base64 image
  decoding, SSRF-guarded downloads, and the TOS signature + upload contract
- `config.ts` — host-config primitives: layer precedence
  (CLI > env > bundled file > default), bounded-int parsing, and the shared
  endpoint/API-key resolvers
- `cli.ts` / `bundled-config.ts` — per-package flag parsing and bundled
  `config.json` loading (never reads the caller's working directory)
- `bootstrap.ts` — stdio server bootstrap (`runStdioServer`)

Server packages own their tool definitions and per-package config resolvers on
top of these primitives; the domain vocabulary is shared via the repo-root
[CONTEXT.md](../../CONTEXT.md).

## Versioning

Independent semver. Bump core, then bump (as needed) and republish the server
packages that depend on it; `scripts/check-release.mjs` at the repo root fails
when a server package's declared core range is not satisfied by the workspace
core version.
