import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';

import { setupImageEnhancementTools } from '../dist/image-enhancement.js';

// P1-1: a terminal failed status must surface as isError:true through
// registerTool (success===false), while completed stays healthy.
const mock = http.createServer((req, res) => {
  const send = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && /\/api\/v3\/contents\/generations\/tasks\/failed-1$/.test(req.url)) {
    return send({ code: 0, data: { task_id: 'failed-1', status: 'failed', progress: 40, error_message: 'GPU worker exploded' } });
  }
  if (req.method === 'GET' && /\/api\/v3\/contents\/generations\/tasks\/done-1$/.test(req.url)) {
    return send({ code: 0, data: { task_id: 'done-1', status: 'completed', progress: 100, image_url: 'https://x/i.png' } });
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const port = mock.address().port;
after(() => mock.close());

const tools = new Map();
setupImageEnhancementTools({ tool: (name, _description, _schema, handler) => tools.set(name, handler) }, `http://127.0.0.1:${port}`, 'test-key');
const query = tools.get('get_image_task_status');
assert.ok(query, 'get_image_task_status must be registered');

test('get_image_task_status marks a terminal failed status as isError', async () => {
  const result = await query({ task_id: 'failed-1' });
  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.success, false);
  assert.equal(body.status, 'failed');
  assert.equal(body.error_message, 'GPU worker exploded');
});

test('get_image_task_status keeps a completed status healthy (no isError key)', async () => {
  const result = await query({ task_id: 'done-1' });
  // registerTool only sets isError on failure; a completed poll is a success result.
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.success, true);
  assert.equal(body.status, 'completed');
});
