import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, resolveSam3Config } from '../dist/config.js';

function expectConfigError(fn, messagePart) {
  assert.throws(fn, (error) => error instanceof ConfigError && error.message.includes(messagePart));
}

test('sam3 defaults apply when nothing is provided', () => {
  const config = resolveSam3Config({ env: { API_KEY: 'k' } });
  assert.deepEqual(config, {
    apiBaseUrl: 'https://mcp.avc.ai/sam',
    apiKey: 'k',
    pollIntervalMs: 2000,
    pollMaxAttempts: 25,
  });
});

test('sam3 base precedence: CLI > env > file', () => {
  assert.equal(resolveSam3Config({ env: { API_KEY: 'k', SAM3_API_BASE_URL: 'https://env.example/sam' } }).apiBaseUrl, 'https://env.example/sam');
  assert.equal(
    resolveSam3Config({ cli: { sam3BaseUrl: 'https://cli.example/sam' }, env: { API_KEY: 'k', SAM3_API_BASE_URL: 'https://env.example/sam' } }).apiBaseUrl,
    'https://cli.example/sam'
  );
  assert.equal(resolveSam3Config({ env: { API_KEY: 'k' }, file: { sam3BaseUrl: 'https://file.example/sam' } }).apiBaseUrl, 'https://file.example/sam');
});

test('SAM3 wait values come from env with the canonical name taking precedence over the deprecated alias', () => {
  const canonical = resolveSam3Config({ env: { API_KEY: 'k', SAM3_POLL_INTERVAL_MS: '1000', SAM3_POLL_INTERVAL: '60000' } });
  assert.equal(canonical.pollIntervalMs, 1000);
  const alias = resolveSam3Config({ env: { API_KEY: 'k', SAM3_POLL_INTERVAL: '3000' } });
  assert.equal(alias.pollIntervalMs, 3000);
  const cli = resolveSam3Config({
    cli: { sam3PollIntervalMs: '750', sam3PollMaxAttempts: '40' },
    env: { API_KEY: 'k', SAM3_POLL_INTERVAL_MS: '1000', SAM3_POLL_MAX_ATTEMPTS: '25' },
  });
  assert.equal(cli.pollIntervalMs, 750);
  assert.equal(cli.pollMaxAttempts, 40);
});

test('invalid SAM3 wait values fail closed before any task can be submitted', () => {
  // Each case names the parameter it must be rejected against — non-integers
  // (e.g. "2.5", "1000abc") fail on both parameters, not just the interval.
  const cases = [
    { raw: 'abc', interval: true },
    { raw: '499', interval: true },
    { raw: '60001', interval: true },
    { raw: '2.5', interval: true },
    { raw: '2000.7', interval: true },
    { raw: '0', interval: false },
    { raw: '1001', interval: false },
    { raw: '2.5', interval: false },
    { raw: '1000abc', interval: false },
  ];
  for (const { raw, interval } of cases) {
    const boundsName = interval ? 'SAM3_POLL_INTERVAL_MS' : 'SAM3_POLL_MAX_ATTEMPTS';
    expectConfigError(
      () =>
        resolveSam3Config({
          cli: interval ? { sam3PollIntervalMs: raw } : { sam3PollMaxAttempts: raw },
          env: { API_KEY: 'k' },
        }),
      boundsName
    );
  }
  // Boundary values are legal.
  const bounds = resolveSam3Config({ cli: { sam3PollIntervalMs: '500', sam3PollMaxAttempts: '1000' }, env: { API_KEY: 'k' } });
  assert.equal(bounds.pollIntervalMs, 500);
  assert.equal(bounds.pollMaxAttempts, 1000);
});

test('a missing API key is a ConfigError', () => {
  expectConfigError(() => resolveSam3Config({ env: {} }), 'API key is required');
});