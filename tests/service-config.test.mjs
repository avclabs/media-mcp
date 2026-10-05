import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveImageBaseUrl } from '../dist/service-config.js';

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
