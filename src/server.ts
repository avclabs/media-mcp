#!/usr/bin/env node
/**
 * MCP Server - Video enhancement, image enhancement/colorization/denoising, and SAM3 image segmentation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { setupVideoEnhancementTools } from './video-enhancement.js';
import { setupImageEnhancementTools } from './image-enhancement.js';
import { setupSam3Tools } from './sam3.js';
import { MediaHostCliOverrides, resolveMediaHostConfig } from './service-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerConfig {
  baseUrl?: string;
  imageBaseUrl?: string;
  sam3BaseUrl?: string;
}

function parseConfigFile(configPath: string): ServerConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (error) {
    console.error(`Error: cannot read config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  let config: any;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    console.error(`Error: config file ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  // Absent keys stay undefined; defaults are applied by resolveMediaHostConfig.
  return {
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : undefined,
    imageBaseUrl: typeof config.imageBaseUrl === 'string' ? config.imageBaseUrl : undefined,
    sam3BaseUrl: typeof config.sam3BaseUrl === 'string' ? config.sam3BaseUrl : undefined,
  };
}

function loadConfig(explicitConfigPath?: string): ServerConfig {
  if (explicitConfigPath) {
    const resolved = path.resolve(explicitConfigPath);
    console.error(`Using config file: ${resolved}`);
    return parseConfigFile(resolved);
  }
  // Only the config bundled with the package is considered; a config.json in
  // the caller's working directory must never silently redirect API traffic.
  const bundledPath = path.resolve(__dirname, '..', 'config.json');
  if (fs.existsSync(bundledPath)) {
    return parseConfigFile(bundledPath);
  }
  return {};
}

// Collect CLI values without consulting the environment; precedence between
// layers is resolved by resolveMediaHostConfig.
function parseCliOverrides(args: string[]): MediaHostCliOverrides {
  const overrides: MediaHostCliOverrides = {};
  for (let i = 0; i < args.length; i++) {
    const takeValue = (key: keyof MediaHostCliOverrides) => {
      overrides[key] = args[i + 1];
      i++;
    };
    if (args[i] === '--base-url' && i + 1 < args.length) takeValue('baseUrl');
    else if (args[i] === '--image-base-url' && i + 1 < args.length) takeValue('imageBaseUrl');
    else if (args[i] === '--api-key' && i + 1 < args.length) takeValue('apiKey');
    else if (args[i] === '--sam3-base-url' && i + 1 < args.length) takeValue('sam3BaseUrl');
    else if (args[i] === '--sam3-poll-interval' && i + 1 < args.length) takeValue('sam3PollIntervalMs');
    else if (args[i] === '--sam3-poll-max-attempts' && i + 1 < args.length) takeValue('sam3PollMaxAttempts');
  }
  return overrides;
}

// Main entry
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let explicitConfigPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      explicitConfigPath = args[i + 1];
      break;
    }
  }
  const fileConfig = loadConfig(explicitConfigPath);

  // SAM3's sync wait is bounded by two independent limits derived from its
  // config: at most SAM3_POLL_MAX_ATTEMPTS status queries and a time budget of
  // interval x attempts (default 25 x 2000 ms = 50 s). Whichever runs out
  // first truncates the wait; the task keeps running remotely either way.
  const hostConfig = resolveMediaHostConfig({ cli: parseCliOverrides(args), env: process.env, file: fileConfig });

  const server = new McpServer(
    {
      name: 'media-mcp',
      version: '0.3.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register video enhancement tools
  setupVideoEnhancementTools(server, hostConfig.enhancementApiBaseUrl, hostConfig.apiKey);

  // Register image enhancement tools
  setupImageEnhancementTools(server, hostConfig.imageApiBaseUrl, hostConfig.apiKey);

  // Register SAM3 tools
  setupSam3Tools(server, hostConfig.sam3ApiBaseUrl, hostConfig.apiKey, hostConfig.sam3PollIntervalMs, hostConfig.sam3PollMaxAttempts);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
