import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';

import { setupVideoEnhancementTools } from '../dist/video-enhancement.js';
import { setupImageEnhancementTools } from '../dist/image-enhancement.js';

// P1-1: a terminal failed status must surface as isError:true through
// registerTool (success===false), while completed/processing stay healthy.
const mock = http.createServer((req, res) => {
  const send = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && /\/api\/v3\/contents\/generations\/tasks\/failed-1$/.test(req.url)) {
    return send({ code: 0, data: { task_id: 'failed-1', status: 'failed', progress: 40, error_message: 'GPU worker exploded' } });
  }
  if (req.method === 'GET' && /\/api\/v3\/contents\/generations\/tasks\/done-1$/.test(req.url)) {
    return send({ code: 0, data: { task_id: 'done-1', status: 'completed', progress: 100, video_url: 'https://x/v.mp4' } });
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const port = mock.address().port;
after(() => mock.close());

function harness(setup) {
  const tools = new Map();
  setup({ tool: (name, _description, _schema, handler) => tools.set(name, handler) }, `http://127.0.0.1:${port}`, 'test-key');
  return tools;
}

for (const [setup, statusTool] of [
  [setupVideoEnhancementTools, 'get_task_status'],
  [setupImageEnhancementTools, 'get_image_task_status'],
]) {
  const tools = harness(setup);
  const query = tools.get(statusTool);
  assert.ok(query, `${statusTool} must be registered`);

  test(`${statusTool} marks a terminal failed status as isError`, async () => {
    const result = await query({ task_id: 'failed-1' });
    assert.equal(result.isError, true);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.success, false);
    assert.equal(body.status, 'failed');
    assert.equal(body.error_message, 'GPU worker exploded');
  });

  test(`${statusTool} keeps a completed status healthy (no isError key)`, async () => {
    const result = await query({ task_id: 'done-1' });
    // registerTool only sets isError on failure; a completed poll is a success result.
    assert.equal(result.isError, undefined);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.success, true);
    assert.equal(body.status, 'completed');
  });
}
