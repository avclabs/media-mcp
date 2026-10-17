#!/usr/bin/env node
/**
 * video-mcp — MCP server for AVCLabs video enhancement only:
 * create_task / get_task_status / enhance_video_sync.
 */

import { extractConfigPath, loadBundledConfig, parseFlagValues, runStdioServer } from '@avclabs.ai/media-mcp-core';
import { resolveVideoConfig } from './config.js';
import { setupVideoEnhancementTools } from './video-enhancement.js';

// Kept in sync with package.json; scripts/check-release.mjs fails the build on drift.
const SERVER_VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileConfig = loadBundledConfig(extractConfigPath(args), import.meta.url);
  const config = resolveVideoConfig({
    cli: parseFlagValues(args, { '--base-url': 'baseUrl', '--api-key': 'apiKey' }),
    env: process.env,
    file: fileConfig,
  });
  await runStdioServer({ name: 'video-mcp', version: SERVER_VERSION }, (server) =>
    setupVideoEnhancementTools(server, config.apiBaseUrl, config.apiKey)
  );
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
