import assert from 'node:assert/strict';
import test from 'node:test';

import { clampSam3WaitBudget, resolveImageBaseUrl } from '../dist/service-config.js';

test('image API falls back to the final video API base URL', () => {
  assert.equal(
    resolveImageBaseUrl(undefined, 'https://video.example.com'),
    'https://video.example.com'
  );
});

test('an explicit image API base URL wins over the video fallback', () => {
  assert.equal(
    resolveImageBaseUrl('https://image.example.com', 'https://video.example.com'),
    'https://image.example.com'
  );
});

test('a blank image API base URL still falls back', () => {
  assert.equal(resolveImageBaseUrl('  ', 'https://video.example.com'), 'https://video.example.com');
});

test('clampSam3WaitBudget keeps a declared budget that already fits the cap', () => {
  const notes = [];
  assert.deepEqual(clampSam3WaitBudget(2000, 22, { note: (m) => notes.push(m) }), {
    maxAttempts: 22,
    clamped: false,
  });
  assert.equal(notes.length, 0);
});

test('clampSam3WaitBudget reduces max attempts with a note when the declared budget exceeds the cap', () => {
  const notes = [];
  const budget = clampSam3WaitBudget(2000, 60, { note: (m) => notes.push(m) });
  assert.deepEqual(budget, { maxAttempts: 22, clamped: true });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /45000/);
  assert.match(notes[0], /22/);
});

test('clampSam3WaitBudget clamps silently when no note hook is provided', () => {
  assert.deepEqual(clampSam3WaitBudget(2000, 60), { maxAttempts: 22, clamped: true });
});

test('clampSam3WaitBudget keeps at least one attempt when the interval alone exceeds the cap', () => {
  const notes = [];
  const budget = clampSam3WaitBudget(60000, 1, { note: (m) => notes.push(m) });
  assert.deepEqual(budget, { maxAttempts: 1, clamped: true });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /truncated/);
});

test('clampSam3WaitBudget says the wait truncates when reducing attempts cannot fit the interval', () => {
  const notes = [];
  const budget = clampSam3WaitBudget(60000, 3, { note: (m) => notes.push(m) });
  assert.deepEqual(budget, { maxAttempts: 1, clamped: true });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /max attempts 1/);
  assert.match(notes[0], /truncated/);
});

test('clampSam3WaitBudget honors a custom cap', () => {
  assert.deepEqual(clampSam3WaitBudget(1000, 50, { maxBudgetMs: 10000 }), {
    maxAttempts: 10,
    clamped: true,
  });
});
