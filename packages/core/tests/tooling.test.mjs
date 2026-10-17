import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import axios from 'axios';

import { classifyStatus, clampNumber, pollUntilTerminal, remainingSleepMs, requestBudgetMs } from '../dist/tooling.js';

test('clampNumber falls back on non-finite input and clamps to range', () => {
  assert.equal(clampNumber(NaN, 1, 45, 45), 45);
  assert.equal(clampNumber(Infinity, 1, 45, 45), 45);
  assert.equal(clampNumber(0, 1, 45, 45), 1);
  assert.equal(clampNumber(999, 1, 45, 45), 45);
  assert.equal(clampNumber(10, 1, 45, 45), 10);
});

test('remainingSleepMs never sleeps past the deadline', () => {
  const now = 1000;
  assert.equal(remainingSleepMs(5000, now + 2000, now), 2000);
  assert.equal(remainingSleepMs(1000, now + 5000, now), 1000);
  assert.equal(remainingSleepMs(5000, now - 1, now), 0);
});

test('classifyStatus recognizes terminal, transient, and unknown statuses', () => {
  assert.equal(classifyStatus('completed'), 'ok');
  assert.equal(classifyStatus('succeeded'), 'ok');
  assert.equal(classifyStatus('failed'), 'failed');
  assert.equal(classifyStatus('canceled'), 'failed');
  assert.equal(classifyStatus('expired'), 'failed');
  assert.equal(classifyStatus('processing'), 'processing');
  assert.equal(classifyStatus('pending'), 'processing');
  assert.equal(classifyStatus('whatever-new'), 'unknown');
  assert.equal(classifyStatus(undefined), 'unknown');
  assert.equal(classifyStatus(null), 'unknown');
});

test('pollUntilTerminal returns success on immediate completion', async () => {
  const result = await pollUntilTerminal({
    taskId: 'task-1',
    timeoutSeconds: 5,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => ({ status: 'completed', payload: { video_url: 'https://x/v.mp4' } }),
  });
  assert.equal(result.success, true);
  assert.equal(result.task_id, 'task-1');
  assert.equal(result.video_url, 'https://x/v.mp4');
});

test('pollUntilTerminal returns success:false when the task itself fails', async () => {
  const result = await pollUntilTerminal({
    taskId: 'task-2',
    timeoutSeconds: 5,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => ({ status: 'failed', payload: { error_message: 'GPU worker exploded' } }),
  });
  assert.equal(result.success, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'GPU worker exploded');
});

test('pollUntilTerminal keeps task_id after repeated network failures', async () => {
  const result = await pollUntilTerminal({
    taskId: 'task-3',
    timeoutSeconds: 10,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.task_id, 'task-3');
  assert.match(result.error, /socket hang up/);
  assert.match(result.note, /get_task_status/);
});

test('pollUntilTerminal tolerates a transient failure before completion', async () => {
  let calls = 0;
  const result = await pollUntilTerminal({
    taskId: 'task-4',
    timeoutSeconds: 10,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => {
      calls++;
      if (calls === 1) throw new Error('ETIMEDOUT');
      return { status: 'completed', payload: {} };
    },
  });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
});

test('pollUntilTerminal reports unknown statuses instead of polling forever', async () => {
  const result = await pollUntilTerminal({
    taskId: 'task-5',
    timeoutSeconds: 10,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => ({ status: 'canceled-by-user', payload: {} }),
  });
  // 'canceled-by-user' is not in the known fail set; after repeated sightings it errors out
  assert.equal(result.success, false);
  assert.equal(result.task_id, 'task-5');
  assert.match(result.error, /Unrecognized task status/);
});

test('pollUntilTerminal truncates at the deadline with a processing result', async () => {
  const started = Date.now();
  const result = await pollUntilTerminal({
    taskId: 'task-6',
    timeoutSeconds: 1,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => ({ status: 'processing', payload: {} }),
  });
  const elapsed = Date.now() - started;
  assert.equal(result.success, true);
  assert.equal(result.status, 'processing');
  assert.equal(result.task_id, 'task-6');
  assert.match(result.message, /get_task_status/);
  assert.ok(elapsed < 5000, `truncation should be quick, took ${elapsed}ms`);
});

test('requestBudgetMs bounds a single status request by the remaining wait budget', () => {
  const now = 1000;
  // remaining far above the request cap -> capped at 10s
  assert.equal(requestBudgetMs(now + 40000, now), 10000);
  // remaining below the cap -> exactly the remaining time
  assert.equal(requestBudgetMs(now + 700, now), 700);
  // remaining at/below the floor -> never 0 (axios treats timeout 0 as "no timeout")
  assert.equal(requestBudgetMs(now + 50, now), 250);
  assert.equal(requestBudgetMs(now - 500, now), 250);
});

test('pollUntilTerminal passes a signal to fetchStatus without aborting it up front', async () => {
  const signals = [];
  const result = await pollUntilTerminal({
    taskId: 'task-7',
    timeoutSeconds: 2,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async (signal) => {
      signals.push(signal);
      throw new Error('down');
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.task_id, 'task-7');
  assert.equal(signals.length, 3);
  assert.ok(signals.every((s) => s instanceof AbortSignal && !s.aborted));
});

test('pollUntilTerminal aborts a hanging fetchStatus at the budget edge and still truncates on time', async () => {
  const started = Date.now();
  const result = await pollUntilTerminal({
    taskId: 'task-8',
    timeoutSeconds: 1,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async () => new Promise(() => {}),
  });
  const elapsed = Date.now() - started;
  assert.equal(result.success, true);
  assert.equal(result.status, 'processing');
  assert.equal(result.task_id, 'task-8');
  assert.ok(elapsed >= 900 && elapsed < 3500, `should truncate near the 1s budget, took ${elapsed}ms`);
});

test('pollUntilTerminal treats a signal-aborted slow fetchStatus as a tolerated failure', async () => {
  const result = await pollUntilTerminal({
    taskId: 'task-9',
    timeoutSeconds: 1,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: async (signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.status, 'processing');
  assert.equal(result.task_id, 'task-9');
});

// --- Deterministic sequences on a fake clock (same interface, no real waiting) ---

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    delay: async (ms) => { t += ms; },
  };
}

test('pollUntilTerminal drives a full status sequence to completion on a fake clock', async () => {
  const clock = fakeClock();
  const statuses = ['processing', 'processing', 'completed'];
  const seen = [];
  const result = await pollUntilTerminal({
    taskId: 'seq-1',
    timeoutSeconds: 50,
    pollIntervalSeconds: 2,
    continueHint: 'get_task_status',
    now: clock.now,
    delay: clock.delay,
    fetchStatus: async () => {
      const status = statuses.shift();
      seen.push(status);
      return { status, payload: status === 'completed' ? { video_url: 'https://x/v.mp4' } : {} };
    },
  });
  assert.deepEqual(seen, ['processing', 'processing', 'completed']);
  assert.equal(result.success, true);
  assert.equal(result.task_id, 'seq-1');
  assert.equal(result.video_url, 'https://x/v.mp4');
});

test('pollUntilTerminal truncates immediately when the first query counts and N=1, with no trailing sleep', async () => {
  const clock = fakeClock();
  let queries = 0;
  const result = await pollUntilTerminal({
    taskId: 'count-1',
    timeoutSeconds: 50,
    pollIntervalSeconds: 2,
    maxAttempts: 1,
    continueHint: 'get_sam3_task_status',
    now: clock.now,
    delay: clock.delay,
    fetchStatus: async () => {
      queries++;
      return { status: 'processing', payload: {} };
    },
  });
  assert.equal(queries, 1);
  assert.equal(result.success, true);
  assert.equal(result.status, 'processing');
  assert.equal(result.task_id, 'count-1');
  assert.match(result.message, /1 status query/);
  assert.match(result.message, /get_sam3_task_status/);
});

test('pollUntilTerminal honors the attempt limit across several queries and stops without a tail wait', async () => {
  const clock = fakeClock();
  let queries = 0;
  const result = await pollUntilTerminal({
    taskId: 'count-2',
    timeoutSeconds: 50,
    pollIntervalSeconds: 0.5,
    maxAttempts: 25,
    continueHint: 'get_task_status',
    now: clock.now,
    delay: clock.delay,
    fetchStatus: async () => {
      queries++;
      return { status: 'processing', payload: {} };
    },
  });
  assert.equal(queries, 25);
  assert.equal(result.status, 'processing');
  // Count limit truncated first: the message must not claim the full budget.
  assert.match(result.message, /12 seconds, 25 status queries/);
});

test('pollUntilTerminal returns at budget exhaustion when the interval exceeds the budget', async () => {
  const clock = fakeClock();
  let queries = 0;
  const result = await pollUntilTerminal({
    taskId: 'slow-1',
    timeoutSeconds: 50,
    pollIntervalSeconds: 60,
    maxAttempts: 25,
    continueHint: 'get_task_status',
    now: clock.now,
    delay: clock.delay,
    fetchStatus: async () => {
      queries++;
      return { status: 'processing', payload: {} };
    },
  });
  // 50 s budget, 60 s interval: exactly one query, no second request past the deadline.
  assert.equal(queries, 1);
  assert.equal(result.status, 'processing');
  assert.equal(result.task_id, 'slow-1');
  assert.match(result.message, /50 seconds, 1 status query/);
});

test('pollUntilTerminal falls back to a 45 s budget for a non-finite timeout and reports real elapsed time', async () => {
  const clock = fakeClock();
  let queries = 0;
  const result = await pollUntilTerminal({
    taskId: 'fb-1',
    timeoutSeconds: Number.NaN,
    pollIntervalSeconds: 30,
    continueHint: 'get_task_status',
    now: clock.now,
    delay: clock.delay,
    fetchStatus: async () => {
      queries++;
      return { status: 'processing', payload: {} };
    },
  });
  assert.equal(queries, 2);
  assert.match(result.message, /45 seconds, 2 status queries/);
});

test('pollUntilTerminal keeps the truncated wait when a completed response arrives after the deadline', async () => {
  const result = await pollUntilTerminal({
    taskId: 'late-1',
    timeoutSeconds: 1,
    pollIntervalSeconds: 0.5,
    continueHint: 'get_task_status',
    fetchStatus: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: 'completed', payload: { video_url: 'https://x/v.mp4' } }), 1300);
      }),
  });
  assert.equal(result.success, true);
  assert.equal(result.status, 'processing');
  assert.equal(result.video_url, undefined);
});

test('pollUntilTerminal cancels a real in-flight HTTP query at the budget edge and keeps task_id', async () => {
  let abortedWithoutResponse = false;
  let socketClosed = () => {};
  const closed = new Promise((resolve) => { socketClosed = resolve; });
  const server = http.createServer((req, res) => {
    req.on('close', () => {
      if (!res.writableEnded) abortedWithoutResponse = true;
      socketClosed();
    });
    // Never respond: the socket stays open until the client aborts.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const started = Date.now();
    const result = await pollUntilTerminal({
      taskId: 'http-1',
      timeoutSeconds: 1,
      pollIntervalSeconds: 0.5,
      continueHint: 'get_task_status',
      fetchStatus: (signal) => axios.get(`http://127.0.0.1:${port}/status`, { signal }),
    });
    const elapsed = Date.now() - started;
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 500))]);
    assert.equal(result.success, true);
    assert.equal(result.status, 'processing');
    assert.equal(result.task_id, 'http-1');
    assert.ok(elapsed >= 900 && elapsed < 3500, `should cancel near the 1 s budget, took ${elapsed} ms`);
    assert.ok(abortedWithoutResponse, 'the request should be cancelled without ever receiving a response');
  } finally {
    server.close();
  }
});
