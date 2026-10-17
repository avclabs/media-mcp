# ADR 0001: Split media-mcp into per-function packages

- Status: Accepted
- Date: 2026-10-17
- Deciders: media-mcp maintainers

## Context

`@avclabs.ai/media-mcp` 0.3.0 ships 9 tools (3 video, 4 image, 2 SAM3) from a
single stdio MCP server. MCP clients inject every tool definition — name,
description, and JSON schema — of each configured server into the model's
context, so a session that only needs image processing still pays for the
video and SAM3 definitions. Three similarly named status tools
(`get_task_status`, `get_image_task_status`, `get_sam3_task_status`) also
increase tool-choice ambiguity, and the three functions cannot be enabled or
authorized independently per client.

## Decision

Restructure the repository into an npm-workspaces monorepo with one npm
package per function, plus a shared library and a legacy package:

- `@avclabs.ai/media-mcp-core` — internal library (registration wrapper,
  polling, TOS upload, config primitives, stdio bootstrap); published so the
  server packages can depend on it.
- `@avclabs.ai/video-mcp` (3 tools), `@avclabs.ai/image-mcp` (4 tools),
  `@avclabs.ai/sam3-mcp` (2 tools) — one function each, own `bin`, own
  per-package config resolver, all env vars / CLI flags / bundled-config keys
  unchanged from 0.3.0.
- `@avclabs.ai/media-mcp` — legacy all-in-one server composing the three
  packages; kept for configuration compatibility with deployed clients.

New packages start at 0.1.0 (new names, new semver lifecycles). The legacy
package continues from 0.3.0.

### Preserved behavior contracts

- `IMAGE_API_BASE_URL` falls back to the *resolved* enhancement base
  (`--base-url` / `HTTP_API_BASE_URL` chain). This fallback is a deployed
  compatibility contract (see docs/RELEASE.md) and is implemented in the
  image package's resolver, not removed.
- `registerTool`'s `isError` semantics, the SAM3 dual-limit polling bounds
  (query count and interval × attempts), and the deprecated
  `SAM3_POLL_INTERVAL` alias all move into core / the sam3 package unchanged.
- The bundled `config.json` is read only from the package directory, never
  from the caller's working directory.

## Consequences

- A client session configured with one per-function server loads only that
  function's tool definitions; tool ambiguity within a session drops.
- Releases publish up to five packages in dependency order: core first, then
  the three servers, then legacy. Versions are independent; the repo-root
  `scripts/check-release.mjs` gates drift across package.json, lockfile,
  `SERVER_VERSION` literals, and server.json.
- Build order is explicit (core → video → image → sam3 → legacy) in the root
  package.json; CI runs the same gate plus stdio E2E for all four server
  entries against a mock backend.

### Known limitation: MCP registry layout

The MCP registry convention is one `server.json` per repository root. The
three per-function servers therefore cannot each get a registry entry from
this single repository; the root `server.json` continues to describe the
legacy all-in-one package (which functionally is the union of the three).
The per-function packages are discoverable via npm and their READMEs. If
registry entries for the three servers become necessary, that requires
separate repositories (or a registry capability change) — revisit then.

### Non-npm distribution channels

`dist-bundles/avclabs-media-mcp-0.3.0.mcpb` is a manually produced bundle of
the legacy package and stays as-is; per-function `.mcpb` bundles are not
automated by this change and can be produced on demand with the same manual
process. Non-npm channels listed in docs/RELEASE.md (GitHub releases, private
tarballs) must be notified when the new packages are announced.
