import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveImageConfig } from '../dist/config.js';

test('image base defaults to the production enhancement base when nothing is provided', () => {
  const config = resolveImageConfig({ env: { API_KEY: 'k' } });
  assert.deepEqual(config, { imageApiBaseUrl: 'https://mcp.avc.ai/enhance', apiKey: 'k' });
});

test('the image base derives from the RESOLVED enhancement base after the merge', () => {
  const fromCliEnhance = resolveImageConfig({ cli: { baseUrl: 'https://cli.example/enhance' }, env: { API_KEY: 'k' } });
  assert.equal(fromCliEnhance.imageApiBaseUrl, 'https://cli.example/enhance');
  const fromEnvEnhance = resolveImageConfig({ env: { API_KEY: 'k', HTTP_API_BASE_URL: 'https://env.example/enhance' } });
  assert.equal(fromEnvEnhance.imageApiBaseUrl, 'https://env.example/enhance');
});

test('an explicit image base overrides the enhancement fallback at every layer', () => {
  assert.equal(
    resolveImageConfig({
      cli: { baseUrl: 'https://cli.example/enhance', imageBaseUrl: 'https://cli.example/image' },
      env: { API_KEY: 'k' },
    }).imageApiBaseUrl,
    'https://cli.example/image'
  );
  assert.equal(
    resolveImageConfig({ env: { API_KEY: 'k', IMAGE_API_BASE_URL: 'https://env.example/image' } }).imageApiBaseUrl,
    'https://env.example/image'
  );
  assert.equal(
    resolveImageConfig({ env: { API_KEY: 'k' }, file: { imageBaseUrl: 'https://file.example/image' } }).imageApiBaseUrl,
    'https://file.example/image'
  );
});

test('a null imageBaseUrl in the bundled config counts as not provided (falls back)', () => {
  const config = resolveImageConfig({ env: { API_KEY: 'k' }, file: { imageBaseUrl: null } });
  assert.equal(config.imageApiBaseUrl, 'https://mcp.avc.ai/enhance');
});

test('a missing API key is a ConfigError', () => {
  assert.throws(() => resolveImageConfig({ env: {} }), /API key is required/);
});
