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
import { resolveImageBaseUrl } from './service-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerConfig {
  baseUrl: string;
  imageBaseUrl?: string;
  sam3BaseUrl: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: 'https://mcp.avc.ai/enhance',
  sam3BaseUrl: 'https://mcp.avc.ai/sam',
};

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
  return {
    baseUrl: config.baseUrl || DEFAULT_CONFIG.baseUrl,
    imageBaseUrl: config.imageBaseUrl || undefined,
    sam3BaseUrl: config.sam3BaseUrl || DEFAULT_CONFIG.sam3BaseUrl,
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
  return { ...DEFAULT_CONFIG };
}

// Fail-closed: an explicitly configured wait parameter that is not an integer
// inside [min, max] aborts startup before any task can be submitted.
function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid SAM3 wait configuration "${value}": expected an integer between ${min} and ${max}`);
  }
  return parsed;
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
  const config = loadConfig(explicitConfigPath);

  let baseUrl = process.env.HTTP_API_BASE_URL || config.baseUrl;
  let imageBaseUrl = process.env.IMAGE_API_BASE_URL || config.imageBaseUrl;
  let apiKey = process.env.API_KEY || '';
  let sam3BaseUrl = process.env.SAM3_API_BASE_URL || config.sam3BaseUrl;
  // SAM3_POLL_INTERVAL_MS is the canonical name; SAM3_POLL_INTERVAL is kept as
  // a deprecated alias. Both are milliseconds (unlike the per-tool
  // poll_interval argument, which is seconds).
  let sam3PollInterval = parsePositiveInt(process.env.SAM3_POLL_INTERVAL_MS ?? process.env.SAM3_POLL_INTERVAL, 2000, 500, 60000);
  let sam3PollMaxAttempts = parsePositiveInt(process.env.SAM3_POLL_MAX_ATTEMPTS, 25, 1, 1000);

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && i + 1 < args.length) {
      baseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--image-base-url' && i + 1 < args.length) {
      imageBaseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--api-key' && i + 1 < args.length) {
      apiKey = args[i + 1];
      i++;
    } else if (args[i] === '--sam3-base-url' && i + 1 < args.length) {
      sam3BaseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--sam3-poll-interval' && i + 1 < args.length) {
      sam3PollInterval = parsePositiveInt(args[i + 1], 2000, 500, 60000);
      i++;
    } else if (args[i] === '--sam3-poll-max-attempts' && i + 1 < args.length) {
      sam3PollMaxAttempts = parsePositiveInt(args[i + 1], 25, 1, 1000);
      i++;
    } else if (args[i] === '--config' && i + 1 < args.length) {
      i++;
    }
  }

  // SAM3's sync wait is bounded by two independent limits derived from its
  // config: at most SAM3_POLL_MAX_ATTEMPTS status queries and a time budget of
  // interval x attempts (default 25 x 2000 ms = 50 s). Whichever runs out
  // first truncates the wait; the task keeps running remotely either way.

  if (!apiKey) {
    console.error('Error: --api-key argument or API_KEY environment variable is required');
    process.exit(1);
  }

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
  setupVideoEnhancementTools(server, baseUrl, apiKey);

  // Register image enhancement tools
  setupImageEnhancementTools(server, resolveImageBaseUrl(imageBaseUrl, baseUrl), apiKey);

  // Register SAM3 tools
  setupSam3Tools(server, sam3BaseUrl, apiKey, sam3PollInterval, sam3PollMaxAttempts);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
