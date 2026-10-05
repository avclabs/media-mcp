// Media host configuration: one deep module owning precedence, validation,
// and derivation for everything the enhancement and SAM3 hosts need. Adapters
// consume the resolved MediaHostConfig; callers never merge layers themselves
// and never need to know variable initialization order.

export const SAM3_POLL_INTERVAL_MS_BOUNDS = { min: 500, max: 60000 } as const;
export const SAM3_POLL_MAX_ATTEMPTS_BOUNDS = { min: 1, max: 1000 } as const;

const DEFAULT_ENHANCEMENT_API_BASE_URL = 'https://mcp.avc.ai/enhance';
const DEFAULT_SAM3_API_BASE_URL = 'https://mcp.avc.ai/sam';
const DEFAULT_SAM3_POLL_INTERVAL_MS = 2000;
const DEFAULT_SAM3_POLL_MAX_ATTEMPTS = 25;

export class ConfigError extends Error {}

export interface MediaHostFileConfig {
  baseUrl?: string;
  imageBaseUrl?: string;
  sam3BaseUrl?: string;
}

export interface MediaHostCliOverrides {
  baseUrl?: string;
  imageBaseUrl?: string;
  sam3BaseUrl?: string;
  apiKey?: string;
  /** Raw argument text; parsed and bounds-checked here. */
  sam3PollIntervalMs?: string;
  sam3PollMaxAttempts?: string;
}

export interface MediaHostEnv {
  API_KEY?: string;
  HTTP_API_BASE_URL?: string;
  IMAGE_API_BASE_URL?: string;
  SAM3_API_BASE_URL?: string;
  /** Canonical name. */
  SAM3_POLL_INTERVAL_MS?: string;
  /** Deprecated alias of SAM3_POLL_INTERVAL_MS. */
  SAM3_POLL_INTERVAL?: string;
  SAM3_POLL_MAX_ATTEMPTS?: string;
}

export interface MediaHostConfig {
  enhancementApiBaseUrl: string;
  imageApiBaseUrl: string;
  sam3ApiBaseUrl: string;
  apiKey: string;
  sam3PollIntervalMs: number;
  sam3PollMaxAttempts: number;
}

// Blank values are "not provided" at every layer, so a resolved address is
// never empty and a blank override cannot mask a valid lower layer.
function highestPrecedence(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

export function parseSam3WaitInt(
  raw: string | undefined,
  name: string,
  bounds: { min: number; max: number },
  fallback: number
): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new ConfigError(`Invalid ${name} "${raw}": expected an integer between ${bounds.min} and ${bounds.max}`);
  }
  return parsed;
}

/**
 * Resolves the final Media host configuration.
 *
 * Precedence per key: CLI override > environment > file config > built-in
 * default. The image API base URL is derived only after the merge: an unset
 * image base falls back to the resolved enhancement base, no matter which
 * layer provided it. All validation happens here, before any tool is created
 * or request is made; error messages never echo secret values.
 */
export function resolveMediaHostConfig(options: {
  cli?: MediaHostCliOverrides;
  env?: MediaHostEnv;
  file?: MediaHostFileConfig;
}): MediaHostConfig {
  const cli = options.cli ?? {};
  const env = options.env ?? {};
  const file = options.file ?? {};

  const enhancementApiBaseUrl =
    highestPrecedence(cli.baseUrl, env.HTTP_API_BASE_URL, file.baseUrl) ?? DEFAULT_ENHANCEMENT_API_BASE_URL;
  const sam3ApiBaseUrl =
    highestPrecedence(cli.sam3BaseUrl, env.SAM3_API_BASE_URL, file.sam3BaseUrl) ?? DEFAULT_SAM3_API_BASE_URL;
  const imageApiBaseUrl =
    highestPrecedence(cli.imageBaseUrl, env.IMAGE_API_BASE_URL, file.imageBaseUrl) ?? enhancementApiBaseUrl;

  const apiKey = highestPrecedence(cli.apiKey, env.API_KEY);
  if (!apiKey) {
    throw new ConfigError('API key is required: pass --api-key or set the API_KEY environment variable');
  }

  // SAM3_POLL_INTERVAL_MS is the canonical name; SAM3_POLL_INTERVAL is kept as
  // a deprecated alias. Both are milliseconds (unlike the per-tool
  // poll_interval argument, which is seconds).
  const sam3PollIntervalMs = parseSam3WaitInt(
    highestPrecedence(cli.sam3PollIntervalMs, env.SAM3_POLL_INTERVAL_MS, env.SAM3_POLL_INTERVAL),
    'SAM3_POLL_INTERVAL_MS',
    SAM3_POLL_INTERVAL_MS_BOUNDS,
    DEFAULT_SAM3_POLL_INTERVAL_MS
  );
  const sam3PollMaxAttempts = parseSam3WaitInt(
    highestPrecedence(cli.sam3PollMaxAttempts, env.SAM3_POLL_MAX_ATTEMPTS),
    'SAM3_POLL_MAX_ATTEMPTS',
    SAM3_POLL_MAX_ATTEMPTS_BOUNDS,
    DEFAULT_SAM3_POLL_MAX_ATTEMPTS
  );

  return { enhancementApiBaseUrl, imageApiBaseUrl, sam3ApiBaseUrl, apiKey, sam3PollIntervalMs, sam3PollMaxAttempts };
}
