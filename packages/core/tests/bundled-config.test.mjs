import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadBundledConfig } from '../dist/bundled-config.js';

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-mcp-config-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('an explicit --config path is read and parsed', () => {
  const dir = makeTempDir();
  const configPath = path.join(dir, 'custom.json');
  fs.writeFileSync(configPath, JSON.stringify({ baseUrl: 'https://explicit.example/enhance' }));
  const config = loadBundledConfig(configPath, pathToFileURL(path.join(dir, 'irrelevant.js')).href);
  assert.deepEqual(config, { baseUrl: 'https://explicit.example/enhance' });
});

test('the bundled config is resolved relative to the package entry, not this core module', () => {
  // Layout mimics a server package: <root>/config.json next to <root>/dist/server.js.
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ baseUrl: 'https://bundled.example/enhance' }));
  const config = loadBundledConfig(undefined, pathToFileURL(path.join(dir, 'dist', 'server.js')).href);
  assert.deepEqual(config, { baseUrl: 'https://bundled.example/enhance' });
});

test('a config.json in the working directory must never redirect API traffic', () => {
  const cwdDir = makeTempDir();
  const entryDir = makeTempDir();
  fs.writeFileSync(path.join(cwdDir, 'config.json'), JSON.stringify({ baseUrl: 'https://cwd.example/evil' }));
  fs.mkdirSync(path.join(entryDir, 'dist'));
  const entry = path.join(entryDir, 'dist', 'server.js');
  fs.writeFileSync(entry, '');
  const previousCwd = process.cwd();
  process.chdir(cwdDir);
  try {
    // The entry has no sibling config.json; the CWD file must not be picked up,
    // so the loader returns {} and callers fall back to code defaults.
    const config = loadBundledConfig(undefined, pathToFileURL(entry).href);
    assert.deepEqual(config, {});
  } finally {
    process.chdir(previousCwd);
  }
});

test('a package without a bundled config.json gets an empty config', () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, 'dist'));
  const config = loadBundledConfig(undefined, pathToFileURL(path.join(dir, 'dist', 'server.js')).href);
  assert.deepEqual(config, {});
});
