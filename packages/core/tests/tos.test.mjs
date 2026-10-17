import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkLocalFile,
  decodeBase64Image,
  formatRequestError,
  isPrivateIp,
  parseTosSignature,
  unwrapEnvelope,
} from '../dist/tos.js';

// --- unwrapEnvelope ---------------------------------------------------------

test('unwrapEnvelope accepts code 0 and 200 envelopes', () => {
  assert.deepEqual(unwrapEnvelope({ data: { code: 0, data: { a: 1 } }, status: 200 }), { ok: true, data: { a: 1 } });
  assert.deepEqual(unwrapEnvelope({ data: { code: 200, data: 'x' }, status: 200 }), { ok: true, data: 'x' });
});

test('unwrapEnvelope keeps the backend message when present', () => {
  const result = unwrapEnvelope({ data: { code: 500, message: 'boom' }, status: 200 });
  assert.deepEqual(result, { ok: false, error: 'boom' });
});

test('unwrapEnvelope synthesizes an error when message is missing', () => {
  const result = unwrapEnvelope({ data: { code: 500 }, status: 200 });
  assert.equal(result.ok, false);
  assert.match(result.error, /code=500/);
});

test('unwrapEnvelope handles non-JSON (HTML error page) bodies', () => {
  const result = unwrapEnvelope({ data: '<html>502 Bad Gateway</html>', status: 200 });
  assert.equal(result.ok, false);
  assert.match(result.error, /Non-JSON response/);
  assert.match(result.error, /502 Bad Gateway/);
});

test('unwrapEnvelope honors custom success codes', () => {
  const only = new Set([0]);
  const result = unwrapEnvelope({ data: { code: 200, data: null }, status: 200 }, only);
  assert.equal(result.ok, false);
});

// --- parseTosSignature ------------------------------------------------------

const POLICY_JSON = JSON.stringify({ conditions: [{ bucket: 'b' }, { key: 'dir/file-123' }] });
const POLICY_B64 = Buffer.from(POLICY_JSON, 'utf-8').toString('base64');

test('parseTosSignature handles video/image style with plain-JSON origin_policy', () => {
  const target = parseTosSignature({
    url: 'https://tos.example.com/bucket/dir/file-123?X-Tos-Credential=secret&X-Tos-Signature=abc',
    file_id: 'file-123',
    algorithm: 'algo',
    credential: 'cred',
    date: '20260925',
    signature: 'sig',
    origin_policy: POLICY_JSON,
    some_future_field: { nested: true },
  });
  assert.equal(target.fileId, 'file-123');
  assert.equal(target.objectKey, 'dir/file-123');
  assert.equal(target.fields['x-tos-algorithm'], 'algo');
  assert.equal(target.fields['x-tos-credential'], 'cred');
  assert.equal(target.fields['x-tos-date'], '20260925');
  assert.equal(target.fields['x-tos-signature'], 'sig');
  assert.equal(target.fields['policy'], POLICY_B64);
  assert.equal(target.fields['some_future_field'], undefined);
  assert.equal(target.fields['file_id'], undefined);
});

test('parseTosSignature handles Base64 origin_policy without double-encoding', () => {
  const target = parseTosSignature({
    url: 'https://tos.example.com/bucket/dir/file-9',
    origin_policy: POLICY_B64,
  });
  assert.equal(target.fields['policy'], POLICY_B64);
  assert.equal(target.objectKey, 'dir/file-123');
});

test('parseTosSignature handles SAM3 style with a policy field', () => {
  const sam3PolicyB64 = Buffer.from(JSON.stringify({ conditions: [{ key: 'up/file-7' }] }), 'utf-8').toString('base64');
  const target = parseTosSignature({
    url: 'https://tos.example.com/bucket/up/file-7',
    policy: sam3PolicyB64,
    algorithm: 'algo',
    credential: 'cred',
    date: 'd',
    signature: 's',
  });
  assert.equal(target.fileId, 'file-7');
  assert.equal(target.fields['policy'], sam3PolicyB64);
  assert.equal(target.objectKey, 'up/file-7');
});

test('parseTosSignature falls back to the URL path key when policy has none', () => {
  const target = parseTosSignature({
    url: 'https://tos.example.com/dir/file-1',
    origin_policy: Buffer.from(JSON.stringify({ conditions: [] }), 'utf-8').toString('base64'),
  });
  assert.equal(target.objectKey, 'dir/file-1');
});

test('parseTosSignature rejects missing upload URLs', () => {
  assert.throws(() => parseTosSignature({}), /Missing upload URL/);
  assert.throws(() => parseTosSignature(null), /Invalid TOS signature/);
});

// --- decodeBase64Image ------------------------------------------------------

const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);

test('decodeBase64Image accepts plain base64', () => {
  const { buffer, fileName } = decodeBase64Image(PIXEL.toString('base64'));
  assert.deepEqual(buffer, PIXEL);
  assert.equal(fileName, 'image.png');
});

test('decodeBase64Image strips a data: URL prefix and derives the extension', () => {
  const { buffer, fileName } = decodeBase64Image(`data:image/jpeg;base64,${PIXEL.toString('base64')}`);
  assert.deepEqual(buffer, PIXEL);
  assert.equal(fileName, 'image.jpg');
});

test('decodeBase64Image rejects empty content', () => {
  assert.throws(() => decodeBase64Image('!!!'), /empty/);
});

// --- isPrivateIp ------------------------------------------------------------

test('isPrivateIp flags loopback, RFC1918, CGNAT, benchmark, link-local and reserved ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1', '100.100.100.200', '100.127.255.255', '198.18.0.1', '198.19.255.255']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '1.1.1.1', '100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

// --- formatRequestError ------------------------------------------------------

test('formatRequestError never leaks the presigned URL query string', () => {
  const message = formatRequestError(
    { response: { status: 403, statusText: 'Forbidden', data: { code: 1 } } },
    'https://tos.example.com/bucket/dir/file-1?X-Tos-Credential=AKLTsecret&X-Tos-Signature=abc123'
  );
  assert.match(message, /status=403/);
  assert.match(message, /tos\.example\.com\/bucket\/dir\/file-1/);
  assert.ok(!message.includes('X-Tos-Credential'), 'must not contain credential query params');
  assert.ok(!message.includes('abc123'), 'must not contain signature');
});

// --- checkLocalFile ----------------------------------------------------------

test('checkLocalFile enforces existence, extension, and magic number', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-mcp-'));
  try {
    const pngPath = path.join(dir, 'ok.png');
    fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
    assert.equal(checkLocalFile(pngPath, 'image').fileName, 'ok.png');

    const fakePath = path.join(dir, 'fake.jpg');
    fs.writeFileSync(fakePath, 'this is not a jpeg');
    assert.throws(() => checkLocalFile(fakePath, 'image'), /magic number/);

    const txtPath = path.join(dir, 'notes.txt');
    fs.writeFileSync(txtPath, 'hello');
    assert.throws(() => checkLocalFile(txtPath, 'image'), /Unsupported image file extension/);

    assert.throws(() => checkLocalFile(path.join(dir, 'missing.png'), 'image'), /does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
