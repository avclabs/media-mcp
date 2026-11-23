import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';

import { setupVideoEnhancementTools } from '../dist/video-enhancement.js';

// Progress reporting for enhance_video_sync: the tool only emits
// notifications/progress when the client asked for it by sending a
// progressToken, and a failing notification channel must never fail the call.

const PROGRESS_SEQUENCE = [
  { status: 'processing', progress: 0 },
  { status: 'processing', progress: 40 },
  // Duplicate: a client must not see the same percentage twice.
  { status: 'processing', progress: 40 },
  { status: 'completed', progress: 100, video_url: 'https://x/v.mp4' },
];

const queues = new Map();
let created = 0;

const mock = http.createServer((req, res) => {
  const send = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'POST' && /\/api\/v3\/contents\/generations\/tasks$/.test(req.url)) {
    req.resume();
    req.on('end', () => {
      created += 1;
      const taskId = `sync-${created}`;
      queues.set(taskId, PROGRESS_SEQUENCE.map((entry) => ({ ...entry })));
      send({ code: 0, data: { task_id: taskId, status: 'processing' } });
    });
    return;
  }

  const statusMatch = /\/api\/v3\/contents\/generations\/tasks\/([^/]+)$/.exec(req.url);
  if (req.method === 'GET' && statusMatch) {
    const queue = queues.get(decodeURIComponent(statusMatch[1]));
    if (!queue) {
      res.writeHead(404);
      res.end('unknown task');
      return;
    }
    // Hold the last entry so an extra poll cannot run off the sequence.
    const tick = queue.length > 1 ? queue.shift() : queue[0];
    return send({
      code: 0,
      data: { task_id: decodeURIComponent(statusMatch[1]), ...tick },
    });
  }

  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
after(() => mock.close());

const tools = new Map();
setupVideoEnhancementTools(
  { tool: (name, _description, _schema, handler) => tools.set(name, handler) },
  `http://127.0.0.1:${mock.address().port}`,
  'test-key'
);
const sync = tools.get('enhance_video_sync');
assert.ok(sync, 'enhance_video_sync must be registered');

const SYNC_ARGS = {
  video_source: 'https://example.com/in.mp4',
  type: 'url',
  resolution: '720p',
  poll_interval: 0.5,
  timeout: 15,
};

test('enhance_video_sync sends no notification without a progressToken', async () => {
  let calls = 0;
  const extra = {
    _meta: {},
    requestId: 11,
    sendNotification: async () => {
      calls += 1;
    },
  };

  const result = await sync(SYNC_ARGS, extra);
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.success, true);
  assert.equal(body.video_url, 'https://x/v.mp4');
  assert.equal(calls, 0, 'a token-less call must stay silent');
});

test('enhance_video_sync reports a strictly increasing 0-100 progress sequence', async () => {
  const notifications = [];
  const extra = {
    _meta: { progressToken: 'token-42' },
    requestId: 12,
    sendNotification: async (notification) => {
      notifications.push(notification);
    },
  };

  const result = await sync(SYNC_ARGS, extra);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.success, true);
  assert.equal(body.video_url, 'https://x/v.mp4');

  assert.deepEqual(
    notifications.map((n) => n.method),
    Array(notifications.length).fill('notifications/progress')
  );
  const progresses = notifications.map((n) => n.params.progress);
  assert.deepEqual(progresses, [0, 40, 100]);
  for (const params of notifications.map((n) => n.params)) {
    assert.equal(params.progressToken, 'token-42');
    assert.equal(params.total, 100);
    assert.equal(typeof params.message, 'string');
  }
});

test('enhance_video_sync still returns its result when sendNotification throws', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let attempts = 0;
  const extra = {
    _meta: { progressToken: 'token-broken' },
    requestId: 13,
    sendNotification: async () => {
      attempts += 1;
      throw new Error('transport closed');
    },
  };

  try {
    const result = await sync(SYNC_ARGS, extra);
    assert.equal(result.isError, undefined);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.success, true);
    assert.equal(body.task_id.length > 0, true);
    assert.equal(body.video_url, 'https://x/v.mp4');
    assert.ok(attempts > 0, 'the failing notification path must actually have been exercised');
  } finally {
    console.warn = originalWarn;
  }
});
