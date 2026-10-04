import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';

// Named static import: the suite must fail at load time (not silently pass)
// if the new export is missing from dist.
import { fetchSam3ResultPayload, setupSam3Tools } from '../dist/sam3.js';

const hits = new Map();
function hit(pathname) {
  hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
}
function totalHits() {
  return [...hits.values()].reduce((sum, n) => sum + n, 0);
}

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hit(url.pathname);
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/ok') return send({ masks: [], boxes: [], scores: [] });
    if (url.pathname === '/fail') return send({ code: 500, message: 'mock result download failure' }, 500);
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
    if (url.pathname === '/tos/up/file-1') return send({});
    if (url.pathname === '/sam/predict') return send({ task_id: 'sam-1' });
    if (url.pathname === '/sam/predict/result/sam-1') {
      return send({ status: 'completed', result: `http://127.0.0.1:${mock.address().port}/result-fail.json` });
    }
    if (url.pathname === '/result-fail.json') {
      return send({ code: 500, message: 'mock result download failure' }, 500);
    }
    res.writeHead(404);
    res.end('not found');
  });
});

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const port = mock.address().port;
after(() => mock.close());

test('fetchSam3ResultPayload keeps task_id when the result download returns HTTP 500', async () => {
  const before = hits.get('/fail') ?? 0;
  const out = await fetchSam3ResultPayload('task-1', `http://127.0.0.1:${port}/fail`);
  assert.equal(out.success, false);
  assert.equal(out.task_id, 'task-1');
  assert.equal(out.status, 'completed');
  assert.notEqual(out.status, 'processing');
  assert.notEqual(out.status, 'failed');
  assert.match(out.error, /500/);
  assert.match(out.note, /get_sam3_task_status/);
  assert.match(out.note, /Do not resubmit/);
  assert.equal(hits.get('/fail') ?? 0, before + 1);
});

test('fetchSam3ResultPayload keeps task_id when result_url is missing without any network request', async () => {
  const before = totalHits();
  for (const bad of [undefined, '', '   ']) {
    const out = await fetchSam3ResultPayload('task-2', bad);
    assert.equal(out.success, false);
    assert.equal(out.task_id, 'task-2');
    assert.equal(out.status, 'completed');
    assert.match(out.error, /no usable result_url/);
    assert.match(out.note, /get_sam3_task_status/);
  }
  assert.equal(totalHits(), before);
});

test('fetchSam3ResultPayload keeps task_id when result_url is not a URL', async () => {
  const before = totalHits();
  const out = await fetchSam3ResultPayload('task-3', 'not a url');
  assert.equal(out.success, false);
  assert.equal(out.task_id, 'task-3');
  assert.equal(out.status, 'completed');
  assert.notEqual(out.status, 'processing');
  assert.notEqual(out.status, 'failed');
  assert.match(out.error, /Failed to download/);
  assert.match(out.note, /Do not resubmit/);
  assert.equal(totalHits(), before);
});

test('fetchSam3ResultPayload returns the payload on success', async () => {
  const out = await fetchSam3ResultPayload('task-5', `http://127.0.0.1:${port}/ok`);
  assert.equal(out.success, true);
  assert.equal(out.task_id, 'task-5');
  assert.equal(out.status, 'completed');
  assert.deepEqual(out.result, { masks: [], boxes: [], scores: [] });
});

test('sam3_predict keeps task_id when the completed result download fails (wired via registerTool)', async () => {
  const tools = new Map();
  const fakeServer = {
    tool: (name, _description, _schema, handler) => {
      tools.set(name, handler);
    },
  };
  setupSam3Tools(fakeServer, `http://127.0.0.1:${port}/sam`, 'test-key', 500, 4);
  const predict = tools.get('sam3_predict');
  assert.ok(predict, 'sam3_predict must be registered');

  const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const result = await predict({ imageBase64: tinyPng, prompt: 'cat' });
  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.success, false);
  assert.equal(body.task_id, 'sam-1');
  assert.equal(body.status, 'completed');
  assert.notEqual(body.status, 'processing');
  assert.match(body.note, /get_sam3_task_status/);
  assert.match(body.note, /Do not resubmit/);
});
