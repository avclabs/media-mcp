#!/usr/bin/env node
/**
 * image-mcp — MCP server for AVCLabs image processing only:
 * enhance_image_sync / colorize_image_sync / denoise_image_sync /
 * get_image_task_status.
 */

import { extractConfigPath, loadBundledConfig, parseFlagValues, runStdioServer } from '@avclabs.ai/media-mcp-core';
import { resolveImageConfig } from './config.js';
import { setupImageEnhancementTools } from './image-enhancement.js';

// Kept in sync with package.json; scripts/check-release.mjs fails the build on drift.
const SERVER_VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileConfig = loadBundledConfig(extractConfigPath(args), import.meta.url);
  const config = resolveImageConfig({
    cli: parseFlagValues(args, {
      '--image-base-url': 'imageBaseUrl',
      '--base-url': 'baseUrl', // only consulted as the fallback for an unset image base
      '--api-key': 'apiKey',
    }),
    env: process.env,
    file: fileConfig,
  });
  await runStdioServer({ name: 'image-mcp', version: SERVER_VERSION }, (server) =>
    setupImageEnhancementTools(server, config.imageApiBaseUrl, config.apiKey)
  );
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
