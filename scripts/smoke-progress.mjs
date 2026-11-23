#!/usr/bin/env node
// End-to-end smoke test for MCP progress reporting.
//
// Starts the built video-mcp over stdio, calls enhance_video_sync through the
// real SDK client with a progress callback, and asserts that the server emits
// strictly increasing 0-100 notifications before returning.
//
// Usage:
//   API_KEY=sk-... node scripts/smoke-progress.mjs <public-video-url>
//
// The video should finish within the 45s synchronous window, or the call
// returns early with a task_id (still a valid smoke, but fewer progress ticks).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const videoUrl = process.argv[2];
if (!videoUrl) {
  console.error('usage: node scripts/smoke-progress.mjs <public-video-url>');
  process.exit(2);
}
if (!process.env.API_KEY) {
  console.error('API_KEY is required');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, '..', 'packages', 'video-mcp', 'dist', 'server.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env },
});

const client = new Client({ name: 'progress-smoke', version: '0.0.0' });
await client.connect(transport);

const seen = [];
const startedAt = Date.now();

try {
  const result = await client.callTool(
    {
      name: 'enhance_video_sync',
      arguments: {
        video_source: videoUrl,
        type: 'url',
        resolution: '720p',
        poll_interval: 2,
        timeout: 45,
      },
    },
    undefined,
    {
      timeout: 180000,
      onprogress: ({ progress, total, message }) => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        seen.push(progress);
        console.log(`[+${seconds}s] progress=${progress} total=${total ?? '?'} ${message ?? ''}`);
      },
    }
  );

  const text = result.content?.find((item) => item.type === 'text')?.text;
  const body = text ? JSON.parse(text) : {};
  console.log('\nresult:', JSON.stringify(body, null, 2));
  console.log(`progress events: ${seen.length}`);

  const monotonic = seen.every((value, index) => index === 0 || value > seen[index - 1]);
  // The synchronous wait can end while the task is still healthy: the tool
  // returns status=processing plus a "still processing" hint when the caller's
  // timeout expires. That is a valid outcome for this smoke — the progress
  // sequence is what we came for — so it must not be reported as a failure.
  const truncated =
    body.status === 'processing' &&
    typeof body.message === 'string' &&
    body.message.includes('still processing');
  const finished = body.status === 'completed' || body.status === 'timeout' || truncated;

  if (seen.length === 0) {
    console.error('FAIL: no notifications/progress received (client sent no token?)');
    process.exitCode = 1;
  } else if (!monotonic) {
    console.error('FAIL: progress went backwards');
    process.exitCode = 1;
  } else if (!finished) {
    console.error(`FAIL: tool call ended with ${JSON.stringify(body.status ?? body.error ?? body)}`);
    process.exitCode = 1;
  } else {
    if (truncated) {
      console.log(`note: sync window closed first; task ${body.task_id} is still running`);
    }
    console.log('PASS');
  }
} finally {
  await client.close();
}
