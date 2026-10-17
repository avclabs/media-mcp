import assert from 'node:assert/strict';
import test from 'node:test';

import { extractConfigPath, parseFlagValues } from '../dist/cli.js';

test('parseFlagValues maps known "--flag value" pairs and ignores everything else', () => {
  const overrides = parseFlagValues(
    ['--base-url', 'https://x', '--unknown', 'x', '--api-key', 'k'],
    { '--base-url': 'baseUrl', '--api-key': 'apiKey' }
  );
  assert.deepEqual(overrides, { baseUrl: 'https://x', apiKey: 'k' });
});

test('a trailing flag without a value is ignored', () => {
  const overrides = parseFlagValues(['--api-key'], { '--api-key': 'apiKey' });
  assert.deepEqual(overrides, {});
});

test('a repeated flag keeps the last value', () => {
  const overrides = parseFlagValues(['--base-url', 'https://a', '--base-url', 'https://b'], { '--base-url': 'baseUrl' });
  assert.deepEqual(overrides, { baseUrl: 'https://b' });
});

test('extractConfigPath returns the value after --config, else undefined', () => {
  assert.equal(extractConfigPath(['--config', '/tmp/c.json', '--api-key', 'k']), '/tmp/c.json');
  assert.equal(extractConfigPath(['--api-key', 'k']), undefined);
  assert.equal(extractConfigPath(['--config']), undefined);
});
