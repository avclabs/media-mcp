// Throwaway end-to-end check: mock backend + real MCP stdio client.
// Verifies the P0/P1 fixes from docs/CODE-REVIEW.md against dist/server.js.
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
    if (url.pathname === '/api/v3/contents/generations/tasks/task-1') {
      if (taskMode === 'failed') {
        return send({ code: 0, data: { task_id: 'task-1', status: 'failed', progress: 40, error_message: 'GPU worker exploded' } });
      }
      return send({ code: 0, data: { task_id: 'task-1', status: 'completed', progress: 100, video_url: 'https://x/v.mp4' } });
    }
    if (url.pathname === '/sam/get_postsignature_url') {
      return send({
        code: 0,
        data: {
          url: 'http://127.0.0.1:8799/tos/up/file-1',
          policy: Buffer.from(JSON.stringify({ conditions: [{ key: 'up/file-1' }] }), 'utf-8').toString('base64'),
          algorithm: 'a', credential: 'c', date: 'd', signature: 's',
        },
      });
    }
    if (url.pathname === '/tos/up/file-1') return send({});
    if (url.pathname === '/sam/predict') return send({ task_id: 'sam-1' });
    if (url.pathname === '/sam/predict/result/sam-1') return send({ status: 'completed', result: 'http://127.0.0.1:8799/result.json' });
    if (url.pathname === '/result.json') return send({ masks: [], boxes: [], scores: [] });
    res.writeHead(404);
    res.end('not found');
  });
});

await new Promise((resolve) => mock.listen(8799, '127.0.0.1', resolve));

const child = spawn('node', [
  'dist/server.js',
  '--api-key', 'test-key', // CLI-only key: exercises the P0-1 fix for SAM3
  '--base-url', 'http://127.0.0.1:8799',
  '--sam3-base-url', 'http://127.0.0.1:8799/sam',
], { stdio: ['pipe', 'pipe', 'inherit'] });

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

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60000);
  });
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await rpc('tools/list', {});
check('tools/list returns 9 tools', list.result.tools.length === 9, list.result.tools.map((t) => t.name).join(','));

// P0-1: sam3_predict must work with --api-key only (no env var)
const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const sam3 = await rpc('tools/call', { name: 'sam3_predict', arguments: { imageBase64: tinyPng, prompt: 'cat' } });
check('P0-1 sam3_predict works with CLI --api-key', !sam3.result.isError && sam3.result.content[0].text.includes('"masks"'), sam3.result.content[0].text.slice(0, 120));

// P0-2: tool failure must carry isError: true
const missing = await rpc('tools/call', { name: 'enhance_image_sync', arguments: { image_source: 'C:/no/such/file.png', type: 'local' } });
check('P0-2 missing local file returns isError:true', missing.result.isError === true, missing.result.content[0].text.slice(0, 100));

// P1-3: terminal failed task must return success:false + isError
taskMode = 'failed';
const failed = await rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url', timeout: 5, poll_interval: 1 } });
taskMode = 'completed';
const failedBody = JSON.parse(failed.result.content[0].text);
check('P1-3 failed task returns success:false', failedBody.success === false && failedBody.status === 'failed', failed.result.content[0].text.slice(0, 140));
check('P1-3 failed task returns isError:true', failed.result.isError === true);

// P1-5: poll_interval 0 must be rejected by the schema
const badInterval = await rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url', poll_interval: 0 } });
check('P1-5 poll_interval=0 rejected', badInterval.result.isError === true, badInterval.result.content[0].text.slice(0, 120));

// happy path still works
const ok = await rpc('tools/call', { name: 'enhance_video_sync', arguments: { video_source: 'https://x/v.mp4', type: 'url' } });
const okBody = JSON.parse(ok.result.content[0].text);
check('happy path enhance_video_sync completes', okBody.success === true && okBody.video_url === 'https://x/v.mp4');

child.kill();
mock.close();
const failedCount = results.filter((r) => !r.ok).length;
console.log(failedCount === 0 ? `\nALL ${results.length} E2E CHECKS PASSED` : `\n${failedCount} CHECKS FAILED`);
process.exit(failedCount === 0 ? 0 : 1);
