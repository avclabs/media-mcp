// End-to-end check: mock backend + real MCP stdio clients against every
// server entry (per-function packages and the legacy all-in-one), plus
// negative startup cases that must fail closed.
import http from 'node:http';
import { spawn } from 'node:child_process';

let taskMode = 'completed';

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/api/v3/contents/generations/tasks' && req.method === 'POST') {
      return send({ code: 0, data: { task_id: 'task-1', status: 'processing' } });
    }
    if (url.pathname === '/api/v3/contents/generations/image/enhance' && req.method === 'POST') {
      return send({ code: 0, data: { task_id: 'task-1', status: 'processing' } });
    }
    if (url.pathname === '/api/v3/contents/generations/tasks/task-1') {
      if (taskMode === 'failed') {
        return send({ code: 0, data: { task_id: 'task-1', status: 'failed', progress: 40, error_message: 'GPU worker exploded' } });
      }
      return send({ code: 0, data: { task_id: 'task-1', status: 'completed', progress: 100, video_url: 'https://x/v.mp4', image_url: 'https://x/i.png' } });
    }
    if (url.pathname === '/api/v3/contents/generations/tos-signature') {
      return send({
        code: 0,
        data: {
          url: `http://127.0.0.1:${mock.address().port}/tos/up/file-1`,
          policy: Buffer.from(JSON.stringify({ conditions: [{ key: 'up/file-1' }] }), 'utf-8').toString('base64'),
          algorithm: 'a', credential: 'c', date: 'd', signature: 's',
        },
      });
    }
    if (url.pathname === '/tos/up/file-1') return send({});
    if (url.pathname === '/sam/get_postsignature_url') {
      return send({
        code: 0,
        data: {
          url: `http://127.0.0.1:${mock.address().port}/tos/up/file-1`,
          policy: Buffer.from(JSON.stringify({ conditions: [{ key: 'up/file-1' }] }), 'utf-8').toString('base64'),
          algorithm: 'a', credential: 'c', date: 'd', signature: 's',
        },
      });
    }
    if (url.pathname === '/sam/predict') return send({ task_id: 'sam-1' });
    if (url.pathname === '/sam/predict/result/sam-1') return send({ status: 'completed', result: `http://127.0.0.1:${mock.address().port}/result.json` });
    if (url.pathname === '/result.json') return send({ masks: [], boxes: [], scores: [] });
    res.writeHead(404);
    res.end('not found');
  });
});

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${mock.address().port}`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

// Every session passes its full configuration via CLI flags, so inherited
// environment values must never leak in — a developer shell with API_KEY
// exported would otherwise mask a broken flag mapping (and make the
// CLI-only-key checks pass accidentally).
const SCRUBBED_ENV_KEYS = [
  'API_KEY',
  'HTTP_API_BASE_URL',
  'IMAGE_API_BASE_URL',
  'SAM3_API_BASE_URL',
  'SAM3_POLL_INTERVAL_MS',
  'SAM3_POLL_INTERVAL',
  'SAM3_POLL_MAX_ATTEMPTS',
];

function scrubbedEnv() {
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV_KEYS) delete env[key];
  return env;
}

function startServer(label, entry, args) {
  const child = spawn('node', [entry, ...args], { stdio: ['pipe', 'pipe', 'inherit'], env: scrubbedEnv() });
  let buffer = '';
  const pending = new Map();
  let nextId = 0;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => reject(new Error(`${label}: timeout waiting for ${method}`)), 60000);
    });
  const stop = () => child.kill();
  return { rpc, stop };
}

async function runSession(label, entry, args, checks) {
  const session = startServer(label, entry, args);
  try {
    await session.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    await checks(session, label);
  } finally {
    session.stop();
  }
}

function expectTools(label, expectedNames) {
  return async (session) => {
    const list = await session.rpc('tools/list', {});
    const names = list.result.tools.map((t) => t.name).sort();
    const expected = [...expectedNames].sort();
    check(
      `${label}: tools/list returns exactly [${expected.join(', ')}]`,
      names.length === expected.length && names.every((name, i) => name === expected[i]),
      names.join(',')
    );
  };
}

// --- Per-function servers: exact tool surface ---

await runSession('video-mcp', 'packages/video-mcp/dist/server.js', ['--api-key', 'test-key', '--base-url', BASE], async (session, label) => {
  await expectTools(label, ['create_task', 'get_task_status', 'enhance_video_sync'])(session);

  // P1-3: terminal failed task must return success:false + isError
  taskMode = 'failed';
  const failed = await session.rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url', timeout: 5, poll_interval: 1 } });
  taskMode = 'completed';
  const failedBody = JSON.parse(failed.result.content[0].text);
  check('P1-3 failed task returns success:false', failedBody.success === false && failedBody.status === 'failed', failed.result.content[0].text.slice(0, 140));
  check('P1-3 failed task returns isError:true', failed.result.isError === true);

  // P1-5: poll_interval 0 must be rejected by the schema
  const badInterval = await session.rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url', poll_interval: 0 } });
  check('P1-5 poll_interval=0 rejected', badInterval.result.isError === true, badInterval.result.content[0].text.slice(0, 120));

  // happy path still works
  const ok = await session.rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url' } });
  const okBody = JSON.parse(ok.result.content[0].text);
  check('happy path enhance_video_sync completes', okBody.success === true && okBody.video_url === 'https://x/v.mp4');
});

await runSession('image-mcp', 'packages/image-mcp/dist/server.js', ['--api-key', 'test-key', '--image-base-url', BASE], async (session, label) => {
  await expectTools(label, ['enhance_image_sync', 'colorize_image_sync', 'denoise_image_sync', 'get_image_task_status'])(session);

  // P0-2: tool failure must carry isError: true
  const missing = await session.rpc('tools/call', { name: 'enhance_image_sync', arguments: { image_source: 'C:/no/such/file.png', type: 'local' } });
  check('P0-2 missing local file returns isError:true', missing.result.isError === true, missing.result.content[0].text.slice(0, 100));

  const ok = await session.rpc('tools/call', { name: 'enhance_image_sync', arguments: { image_source: 'https://x/i.png', type: 'url' } });
  const okBody = JSON.parse(ok.result.content[0].text);
  check('happy path enhance_image_sync completes', okBody.success === true && okBody.image_url === 'https://x/i.png');
});

await runSession('sam3-mcp', 'packages/sam3-mcp/dist/server.js', [
  '--api-key', 'test-key',
  '--sam3-base-url', `${BASE}/sam`,
  // Exercise the SAM3 wait CLI flags end-to-end (bounds-checked at startup).
  '--sam3-poll-interval', '500',
  '--sam3-poll-max-attempts', '3',
], async (session, label) => {
  await expectTools(label, ['sam3_predict', 'get_sam3_task_status'])(session);

  // P0-1: sam3_predict must work with --api-key only (no env var)
  const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const sam3 = await session.rpc('tools/call', { name: 'sam3_predict', arguments: { imageBase64: tinyPng, prompt: 'cat' } });
  check('P0-1 sam3_predict works with CLI --api-key', !sam3.result.isError && sam3.result.content[0].text.includes('"masks"'), sam3.result.content[0].text.slice(0, 120));
});

// --- Legacy all-in-one: full surface still intact ---

await runSession('media-mcp (legacy)', 'packages/media-mcp/dist/server.js', [
  '--api-key', 'test-key',
  '--base-url', BASE,
  '--sam3-base-url', `${BASE}/sam`,
  // Exercise the explicit --config path (file layer sits below CLI overrides).
  '--config', 'packages/media-mcp/config.json',
], async (session, label) => {
  await expectTools(label, [
    'create_task', 'get_task_status', 'enhance_video_sync',
    'enhance_image_sync', 'colorize_image_sync', 'denoise_image_sync', 'get_image_task_status',
    'sam3_predict', 'get_sam3_task_status',
  ])(session);

  const ok = await session.rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url' } });
  const okBody = JSON.parse(ok.result.content[0].text);
  check('legacy happy path enhance_video_sync completes', okBody.success === true && okBody.video_url === 'https://x/v.mp4');
});

// A server handed an invalid explicit value (or no API key at all) must fail
// closed: non-zero exit and the real error on stderr, never a silent fallback
// to defaults. This is the only coverage of the CLI flag-table wiring.
function expectStartupFailure(label, entry, args, expectedStderr) {
  return new Promise((resolve) => {
    const child = spawn('node', [entry, ...args], { stdio: ['ignore', 'ignore', 'pipe'], env: scrubbedEnv() });
    let err = '';
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('exit', (code) => {
      const ok = code !== 0 && err.includes(expectedStderr);
      check(
        `${label}: exits non-zero with "${expectedStderr}" on stderr`,
        ok,
        `code=${code} :: ${err.trim().split('\n').pop()?.slice(0, 140) ?? ''}`
      );
      resolve();
    });
  });
}

await expectStartupFailure(
  'sam3-mcp below-range interval',
  'packages/sam3-mcp/dist/server.js',
  ['--api-key', 'test-key', '--sam3-poll-interval', '100'],
  'Invalid SAM3_POLL_INTERVAL_MS'
);
await expectStartupFailure(
  'sam3-mcp non-integer attempts',
  'packages/sam3-mcp/dist/server.js',
  ['--api-key', 'test-key', '--sam3-poll-max-attempts', 'abc'],
  'Invalid SAM3_POLL_MAX_ATTEMPTS'
);
await expectStartupFailure(
  'video-mcp missing API key',
  'packages/video-mcp/dist/server.js',
  [],
  'API key is required'
);

mock.close();
const failedCount = results.filter((r) => !r.ok).length;
console.log(failedCount === 0 ? `\nALL ${results.length} E2E CHECKS PASSED` : `\n${failedCount} CHECKS FAILED`);
process.exit(failedCount === 0 ? 0 : 1);
