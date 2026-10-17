import axios, { AxiosResponse } from 'axios';
import * as dns from 'dns/promises';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import FormData from 'form-data';

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
export const TOS_UPLOAD_TIMEOUT_MS = 120000;
export const DOWNLOAD_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Local file validation (extension whitelist + magic number)
// ---------------------------------------------------------------------------

export type MediaKind = 'image' | 'video';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);

interface MagicSignature {
  extensions: string[];
  matches: (header: Buffer) => boolean;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { extensions: ['.png'], matches: (h) => h.length >= 4 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 },
  { extensions: ['.jpg', '.jpeg'], matches: (h) => h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { extensions: ['.bmp'], matches: (h) => h.length >= 2 && h[0] === 0x42 && h[1] === 0x4d },
  { extensions: ['.webp'], matches: (h) => h.length >= 12 && h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP' },
  { extensions: ['.mp4', '.mov', '.m4v'], matches: (h) => h.length >= 8 && h.toString('ascii', 4, 8) === 'ftyp' },
  { extensions: ['.avi'], matches: (h) => h.length >= 12 && h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'AVI ' },
  { extensions: ['.mkv', '.webm'], matches: (h) => h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3 },
];

function readFileHeader(filePath: string, length: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, header, 0, length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export function checkLocalFile(filePath: string, kind: MediaKind): { filePath: string; fileName: string } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File size exceeds 100MB limit');
  }
  const extension = path.extname(filePath).toLowerCase();
  const allowed = kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (!allowed.has(extension)) {
    throw new Error(`Unsupported ${kind} file extension "${extension}"; allowed: ${[...allowed].join(', ')}`);
  }
  const signature = MAGIC_SIGNATURES.find((entry) => entry.extensions.includes(extension));
  if (signature && !signature.matches(readFileHeader(filePath, 12))) {
    throw new Error(`File content does not match its "${extension}" extension (magic number check failed): ${filePath}`);
  }
  return { filePath, fileName: path.basename(filePath) };
}

// ---------------------------------------------------------------------------
// Base64 image input
// ---------------------------------------------------------------------------

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
};

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/s;

export function decodeBase64Image(input: string): { buffer: Buffer; fileName: string } {
  const trimmed = input.trim();
  const match = DATA_URL_PATTERN.exec(trimmed);
  const extension = match ? MIME_EXTENSION[match[1].toLowerCase()] ?? 'png' : 'png';
  const base64 = match ? match[2] : trimmed;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new Error('imageBase64 decoded to empty content');
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image size exceeds 100MB limit');
  }
  return { buffer, fileName: `image.${extension}` };
}

// ---------------------------------------------------------------------------
// SSRF guard for remote fetches
// ---------------------------------------------------------------------------

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10 (cloud metadata, e.g. 100.100.100.200)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18.0.0/15
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  }
  return false;
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed: ${rawUrl}`);
  }
  const hostname = url.hostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Refusing to fetch from a private or reserved address: ${hostname}`);
    }
  } else {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIp(address)) {
      throw new Error(`Refusing to fetch ${hostname}: resolves to private or reserved address ${address}`);
    }
  }
  return url;
}

export async function downloadToBuffer(rawUrl: string): Promise<Buffer> {
  await assertPublicHttpUrl(rawUrl);
  const response = await axios.get(rawUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_FILE_SIZE_BYTES,
    maxRedirects: 3,
    beforeRedirect: (options) => {
      const host = String(options.hostname ?? options.host ?? '');
      if (net.isIP(host) && isPrivateIp(host)) {
        throw new Error(`Refusing redirect to a private or reserved address: ${host}`);
      }
    },
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Downloaded content exceeds 100MB limit');
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Backend response envelope
// ---------------------------------------------------------------------------

export type UnwrapResult = { ok: true; data: any } | { ok: false; error: string };

const DEFAULT_SUCCESS_CODES = new Set([0, 200]);

export function unwrapEnvelope(response: Pick<AxiosResponse, 'data' | 'status'>, successCodes: Set<number> = DEFAULT_SUCCESS_CODES): UnwrapResult {
  const body = response.data;
  if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) {
    const code = body.code;
    if (successCodes.has(code)) {
      return { ok: true, data: body.data };
    }
    const message = body.message ?? body.error;
    if (message !== undefined && message !== null && message !== '') {
      return { ok: false, error: String(message) };
    }
    return { ok: false, error: `API returned code=${code === undefined ? 'missing' : code} (HTTP ${response.status})` };
  }
  const preview = String(body).slice(0, 200).replace(/\s+/g, ' ');
  return { ok: false, error: `Non-JSON response (HTTP ${response.status}): ${preview}` };
}

// ---------------------------------------------------------------------------
// Error formatting (never leaks presigned URL query strings / credentials)
// ---------------------------------------------------------------------------

function safeUrlLocation(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    return ` url=${url.host}${url.pathname}`;
  } catch {
    return '';
  }
}

export function formatRequestError(error: any, rawUrl?: string): string {
  const location = safeUrlLocation(rawUrl);
  if (error?.response) {
    const data = error.response.data;
    let bodyPreview = '';
    if (typeof data === 'string') {
      bodyPreview = ` data=${data.slice(0, 200).replace(/\s+/g, ' ')}`;
    } else if (data) {
      bodyPreview = ` data=${JSON.stringify(data).slice(0, 200)}`;
    }
    return `status=${error.response.status} statusText=${error.response.statusText}${bodyPreview}${location}`;
  }
  return `${error?.message ?? String(error)}${location}`;
}

// ---------------------------------------------------------------------------
// TOS signature parsing + upload (single contract shared by all services)
// ---------------------------------------------------------------------------

export interface TosUploadTarget {
  url: string;
  fileId: string;
  objectKey: string;
  fields: Record<string, string>;
}

// Whitelist: only these signature fields are ever forwarded as TOS form fields.
const TOS_FIELD_MAPPING: Record<string, string> = {
  algorithm: 'x-tos-algorithm',
  credential: 'x-tos-credential',
  date: 'x-tos-date',
  signature: 'x-tos-signature',
};

function decodePolicyJson(policyValue: string): any | undefined {
  let text = policyValue.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf-8');
    } catch {
      return undefined;
    }
  }
  if (!text.startsWith('{')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseTosSignature(signatureData: any): TosUploadTarget {
  if (!signatureData || typeof signatureData !== 'object') {
    throw new Error('Invalid TOS signature response');
  }
  const url = signatureData.url;
  if (typeof url !== 'string' || !url) {
    throw new Error('Missing upload URL in TOS signature response');
  }
  const pathname = new URL(url).pathname;
  const segments = pathname.split('/');
  const fileId = decodeURIComponent(segments[segments.length - 1] || '');
  if (!fileId) {
    throw new Error('Could not extract file_id from upload URL');
  }

  const fields: Record<string, string> = {};
  for (const [sourceKey, formKey] of Object.entries(TOS_FIELD_MAPPING)) {
    const value = signatureData[sourceKey];
    if (value !== undefined && value !== null) {
      fields[formKey] = String(value);
    }
  }

  const policyValue = signatureData.origin_policy ?? signatureData.policy;
  let objectKey = decodeURIComponent(pathname.slice(1));
  if (policyValue !== undefined && policyValue !== null) {
    let policyText = String(policyValue);
    // Different volcengine-tos SDK versions return the policy as plain JSON or
    // Base64; TOS expects Base64, so normalize here.
    if (policyText.trim().startsWith('{')) {
      policyText = Buffer.from(policyText, 'utf-8').toString('base64');
    }
    fields['policy'] = policyText;

    // Prefer the key declared in the policy conditions when available.
    const policyJson = decodePolicyJson(String(policyValue));
    const keyCondition = policyJson?.conditions?.find(
      (condition: any) => condition && typeof condition === 'object' && typeof condition.key === 'string'
    );
    if (keyCondition) {
      objectKey = keyCondition.key;
    }
  }

  return { url, fileId, objectKey, fields };
}

export async function uploadToTos(target: TosUploadTarget, data: fs.ReadStream | Buffer, fileName: string): Promise<void> {
  const formData = new FormData();
  formData.append('key', target.objectKey);
  for (const [key, value] of Object.entries(target.fields)) {
    formData.append(key, value);
  }
  formData.append('file', data, fileName);

  try {
    await axios.post(target.url, formData, {
      headers: formData.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: TOS_UPLOAD_TIMEOUT_MS,
    });
  } catch (error: any) {
    throw new Error(`TOS upload failed: ${formatRequestError(error, target.url)}`);
  }
}
