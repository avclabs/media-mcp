#!/usr/bin/env node
/**
 * MCP Server - 提供视频增强和 SAM3 图像分割功能
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { setupVideoEnhancementTools } from './video-enhancement.js';
import { setupSam3Tools } from './sam3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadConfig(): { baseUrl: string; sam3BaseUrl: string } {
  const configPaths = [
    path.resolve(process.cwd(), 'config.json'),
    path.resolve(__dirname, '..', 'config.json'),
  ];
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return {
          baseUrl: config.baseUrl || 'https://mcp.avc.ai/enhance',
          sam3BaseUrl: config.sam3BaseUrl || 'https://mcp.avc.ai/sam',
        };
      } catch {
        continue;
      }
    }
  }
  return { baseUrl: 'https://mcp.avc.ai/enhance', sam3BaseUrl: 'https://mcp.avc.ai/sam' };
}

// 主入口
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  let baseUrl = process.env.HTTP_API_BASE_URL || config.baseUrl;
  let apiKey = process.env.API_KEY || '';
  let sam3BaseUrl = process.env.SAM3_API_BASE_URL || config.sam3BaseUrl;
  let sam3ApiKey = apiKey;
  let sam3PollInterval = parseInt(process.env.SAM3_POLL_INTERVAL || '2000', 10);
  let sam3PollMaxAttempts = parseInt(process.env.SAM3_POLL_MAX_ATTEMPTS || '60', 10);

  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && i + 1 < args.length) {
      baseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--api-key' && i + 1 < args.length) {
      apiKey = args[i + 1];
      i++;
    } else if (args[i] === '--sam3-base-url' && i + 1 < args.length) {
      sam3BaseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--sam3-poll-interval' && i + 1 < args.length) {
      sam3PollInterval = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--sam3-poll-max-attempts' && i + 1 < args.length) {
      sam3PollMaxAttempts = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!apiKey) {
    console.error('错误: 需要提供 --api-key 或设置 API_KEY 环境变量');
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

  // 注册视频增强 tools
  setupVideoEnhancementTools(server, baseUrl, apiKey);

  // 注册 SAM3 tools
  setupSam3Tools(server, sam3BaseUrl, sam3ApiKey, sam3PollInterval, sam3PollMaxAttempts);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
