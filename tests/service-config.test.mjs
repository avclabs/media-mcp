import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, resolveMediaHostConfig } from '../dist/service-config.js';

function expectConfigError(fn, messagePart) {
  assert.throws(fn, (error) => error instanceof ConfigError && error.message.includes(messagePart));
}

test('built-in defaults apply when nothing is provided', () => {
  const config = resolveMediaHostConfig({ env: { API_KEY: 'k' } });
  assert.deepEqual(config, {
    enhancementApiBaseUrl: 'https://mcp.avc.ai/enhance',
    imageApiBaseUrl: 'https://mcp.avc.ai/enhance',
    sam3ApiBaseUrl: 'https://mcp.avc.ai/sam',
    apiKey: 'k',
    sam3PollIntervalMs: 2000,
    sam3PollMaxAttempts: 25,
  });
});

test('a CLI-only key reaches the shared final config for both hosts', () => {
  const config = resolveMediaHostConfig({ cli: { apiKey: 'cli-only-key' }, env: {} });
  assert.equal(config.apiKey, 'cli-only-key');
  // One resolved config feeds the enhancement and SAM3 adapters alike.
  assert.equal(config.enhancementApiBaseUrl, 'https://mcp.avc.ai/enhance');
  assert.equal(config.sam3ApiBaseUrl, 'https://mcp.avc.ai/sam');
});

test('an env-only key is used without CLI input', () => {
  const config = resolveMediaHostConfig({ env: { API_KEY: 'env-key' } });
  assert.equal(config.apiKey, 'env-key');
});

test('a CLI key overrides an env key (old env value must not survive anywhere)', () => {
  const config = resolveMediaHostConfig({ cli: { apiKey: 'new-key' }, env: { API_KEY: 'stale-key' } });
  assert.equal(config.apiKey, 'new-key');
  assert.ok(!JSON.stringify(config).includes('stale-key'));
});

test('a key missing at every layer is a ConfigError whose message carries no key material', () => {
  expectConfigError(() => resolveMediaHostConfig({ env: {} }), 'API key is required');
  expectConfigError(() => resolveMediaHostConfig({ cli: { apiKey: '   ' }, env: { API_KEY: '' } }), 'API key is required');
});

test('each layer overrides the ones below it: CLI > env > file > default', () => {
  const key = { API_KEY: 'k' };
  const file = { baseUrl: 'https://file.example/enhance', sam3BaseUrl: 'https://file.example/sam' };
  const env = { ...key, HTTP_API_BASE_URL: 'https://env.example/enhance', SAM3_API_BASE_URL: 'https://env.example/sam' };
  assert.equal(resolveMediaHostConfig({ env, file }).enhancementApiBaseUrl, 'https://env.example/enhance');
  assert.equal(resolveMediaHostConfig({ env, file }).sam3ApiBaseUrl, 'https://env.example/sam');
  assert.equal(resolveMediaHostConfig({ env: key, file }).enhancementApiBaseUrl, 'https://file.example/enhance');
  const overridden = resolveMediaHostConfig({
    cli: { baseUrl: 'https://cli.example/enhance', sam3BaseUrl: 'https://cli.example/sam' },
    env,
    file,
  });
  assert.equal(overridden.enhancementApiBaseUrl, 'https://cli.example/enhance');
  assert.equal(overridden.sam3ApiBaseUrl, 'https://cli.example/sam');
});

test('the image base derives from the RESOLVED enhancement base after the merge', () => {
  const config = resolveMediaHostConfig({ cli: { baseUrl: 'https://cli.example/enhance' }, env: { API_KEY: 'k' } });
  assert.equal(config.imageApiBaseUrl, 'https://cli.example/enhance');
  const explicit = resolveMediaHostConfig({
    cli: { baseUrl: 'https://cli.example/enhance', imageBaseUrl: 'https://cli.example/image' },
    env: { API_KEY: 'k' },
  });
  assert.equal(explicit.imageApiBaseUrl, 'https://cli.example/image');
  const fromEnv = resolveMediaHostConfig({ env: { API_KEY: 'k', IMAGE_API_BASE_URL: 'https://env.example/image' } });
  assert.equal(fromEnv.imageApiBaseUrl, 'https://env.example/image');
});

test('blank values count as not provided at any layer', () => {
  const config = resolveMediaHostConfig({
    cli: { baseUrl: '   ', apiKey: 'cli-key' },
    env: { HTTP_API_BASE_URL: ' ', API_KEY: '' },
    file: { baseUrl: 'https://file.example/enhance' },
  });
  assert.equal(config.enhancementApiBaseUrl, 'https://file.example/enhance');
  assert.equal(config.apiKey, 'cli-key');
});

test('SAM3 wait values come from env with canonical name taking precedence over the deprecated alias', () => {
  const canonical = resolveMediaHostConfig({
    env: { API_KEY: 'k', SAM3_POLL_INTERVAL_MS: '1000', SAM3_POLL_INTERVAL: '60000' },
  });
  assert.equal(canonical.sam3PollIntervalMs, 1000);
  const alias = resolveMediaHostConfig({ env: { API_KEY: 'k', SAM3_POLL_INTERVAL: '3000' } });
  assert.equal(alias.sam3PollIntervalMs, 3000);
  const cli = resolveMediaHostConfig({
    cli: { sam3PollIntervalMs: '750', sam3PollMaxAttempts: '40' },
    env: { API_KEY: 'k', SAM3_POLL_INTERVAL_MS: '1000', SAM3_POLL_MAX_ATTEMPTS: '25' },
  });
  assert.equal(cli.sam3PollIntervalMs, 750);
  assert.equal(cli.sam3PollMaxAttempts, 40);
});

test('invalid SAM3 wait values fail closed before any task can be submitted', () => {
  for (const raw of ['abc', '499', '60001', '0', '1001', '2.5']) {
    const isInterval = ['499', '60001', 'abc', '2.5'].includes(raw);
    const boundsName = isInterval ? 'SAM3_POLL_INTERVAL_MS' : 'SAM3_POLL_MAX_ATTEMPTS';
    expectConfigError(
      () =>
        resolveMediaHostConfig({
          cli: isInterval ? { sam3PollIntervalMs: raw } : { sam3PollMaxAttempts: raw },
          env: { API_KEY: 'k' },
        }),
      boundsName
    );
  }
  // Boundary values are legal.
  const bounds = resolveMediaHostConfig({
    cli: { sam3PollIntervalMs: '500', sam3PollMaxAttempts: '1000' },
    env: { API_KEY: 'k' },
  });
  assert.equal(bounds.sam3PollIntervalMs, 500);
  assert.equal(bounds.sam3PollMaxAttempts, 1000);
});
