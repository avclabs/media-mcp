#!/usr/bin/env node
/**
 * sam3-mcp — MCP server for SAM3 image segmentation only:
 * sam3_predict / get_sam3_task_status.
 */

import { extractConfigPath, loadBundledConfig, parseFlagValues, runStdioServer } from '@avclabs.ai/media-mcp-core';
import { resolveSam3Config } from './config.js';
import { setupSam3Tools } from './sam3.js';

// Kept in sync with package.json; scripts/check-release.mjs fails the build on drift.
const SERVER_VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileConfig = loadBundledConfig(extractConfigPath(args), import.meta.url);
  const config = resolveSam3Config({
    cli: parseFlagValues(args, {
      '--sam3-base-url': 'sam3BaseUrl',
      '--api-key': 'apiKey',
      '--sam3-poll-interval': 'sam3PollIntervalMs',
      '--sam3-poll-max-attempts': 'sam3PollMaxAttempts',
    }),
    env: process.env,
    file: fileConfig,
  });
  await runStdioServer({ name: 'sam3-mcp', version: SERVER_VERSION }, (server) =>
    setupSam3Tools(server, config.apiBaseUrl, config.apiKey, config.pollIntervalMs, config.pollMaxAttempts)
  );
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
