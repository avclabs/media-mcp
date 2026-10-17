import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, resolveVideoConfig } from '../dist/config.js';

function expectConfigError(fn, messagePart) {
  assert.throws(fn, (error) => error instanceof ConfigError && error.message.includes(messagePart));
}

test('video defaults to the production enhancement base when nothing is provided', () => {
  const config = resolveVideoConfig({ env: { API_KEY: 'k' } });
  assert.deepEqual(config, { apiBaseUrl: 'https://mcp.avc.ai/enhance', apiKey: 'k' });
});

test('a CLI-only key reaches the video config', () => {
  const config = resolveVideoConfig({ cli: { apiKey: 'cli-only-key' }, env: {} });
  assert.equal(config.apiKey, 'cli-only-key');
  assert.equal(config.apiBaseUrl, 'https://mcp.avc.ai/enhance');
});

test('a CLI key overrides an env key (old env value must not survive anywhere)', () => {
  const config = resolveVideoConfig({ cli: { apiKey: 'new-key' }, env: { API_KEY: 'stale-key' } });
  assert.equal(config.apiKey, 'new-key');
  assert.ok(!JSON.stringify(config).includes('stale-key'));
});

test('a key missing at every layer is a ConfigError whose message carries no key material', () => {
  expectConfigError(() => resolveVideoConfig({ env: {} }), 'API key is required');
  expectConfigError(() => resolveVideoConfig({ cli: { apiKey: '   ' }, env: { API_KEY: '' } }), 'API key is required');
});

test('video base precedence: CLI > env > file > default', () => {
  const key = { API_KEY: 'k' };
  const file = { baseUrl: 'https://file.example/enhance' };
  const env = { ...key, HTTP_API_BASE_URL: 'https://env.example/enhance' };
  assert.equal(resolveVideoConfig({ env, file }).apiBaseUrl, 'https://env.example/enhance');
  assert.equal(resolveVideoConfig({ env: key, file }).apiBaseUrl, 'https://file.example/enhance');
  assert.equal(
    resolveVideoConfig({ cli: { baseUrl: 'https://cli.example/enhance' }, env, file }).apiBaseUrl,
    'https://cli.example/enhance'
  );
});

test('blank values count as not provided at any layer', () => {
  const config = resolveVideoConfig({
    cli: { baseUrl: '   ', apiKey: 'cli-key' },
    env: { HTTP_API_BASE_URL: ' ', API_KEY: '' },
    file: { baseUrl: 'https://file.example/enhance' },
  });
  assert.equal(config.apiBaseUrl, 'https://file.example/enhance');
  assert.equal(config.apiKey, 'cli-key');
});
