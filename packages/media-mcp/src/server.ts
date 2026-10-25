#!/usr/bin/env node
/**
 * media-mcp — legacy all-in-one MCP server: video enhancement, image
 * enhancement/colorization/denoising, and SAM3 image segmentation (9 tools).
 * Prefer the per-function packages @avclabs.ai/video-mcp, @avclabs.ai/image-mcp,
 * and @avclabs.ai/sam3-mcp; this entry keeps existing client configurations
 * working unchanged.
 */

import { extractConfigPath, loadBundledConfig, parseFlagValues, runStdioServer } from '@avclabs.ai/media-mcp-core';
import { setupVideoEnhancementTools } from '@avclabs.ai/video-mcp';
import { setupImageEnhancementTools } from '@avclabs.ai/image-mcp';
import { setupSam3Tools } from '@avclabs.ai/sam3-mcp';
import { resolveMediaHostConfig } from './config.js';

// Kept in sync with package.json; scripts/check-release.mjs fails the build on drift.
const SERVER_VERSION = '0.4.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileConfig = loadBundledConfig(extractConfigPath(args), import.meta.url);

  const hostConfig = resolveMediaHostConfig({
    cli: parseFlagValues(args, {
      '--base-url': 'baseUrl',
      '--image-base-url': 'imageBaseUrl',
      '--api-key': 'apiKey',
      '--sam3-base-url': 'sam3BaseUrl',
      '--sam3-poll-interval': 'sam3PollIntervalMs',
      '--sam3-poll-max-attempts': 'sam3PollMaxAttempts',
    }),
    env: process.env,
    file: fileConfig,
  });

  await runStdioServer({ name: 'media-mcp', version: SERVER_VERSION }, (server) => {
    // Register video enhancement tools
    setupVideoEnhancementTools(server, hostConfig.enhancementApiBaseUrl, hostConfig.apiKey);

    // Register image enhancement tools
    setupImageEnhancementTools(server, hostConfig.imageApiBaseUrl, hostConfig.apiKey);

    // Register SAM3 tools
    setupSam3Tools(
      server,
      hostConfig.sam3ApiBaseUrl,
      hostConfig.apiKey,
      hostConfig.sam3PollIntervalMs,
      hostConfig.sam3PollMaxAttempts
    );
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
