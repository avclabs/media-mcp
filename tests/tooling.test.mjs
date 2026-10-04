import assert from 'node:assert/strict';
import test from 'node:test';

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
