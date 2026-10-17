// Host configuration primitives shared by every media MCP server package.
// Each server package owns a thin resolver that declares only its own keys on
// top of these helpers; precedence, validation, and defaults live here so the
// per-package resolvers can never disagree about layering.

export const DEFAULT_ENHANCEMENT_API_BASE_URL = 'https://mcp.avc.ai/enhance';
export const DEFAULT_SAM3_API_BASE_URL = 'https://mcp.avc.ai/sam';

export const SAM3_POLL_INTERVAL_MS_BOUNDS = { min: 500, max: 60000 } as const;
export const SAM3_POLL_MAX_ATTEMPTS_BOUNDS = { min: 1, max: 1000 } as const;
export const DEFAULT_SAM3_POLL_INTERVAL_MS = 2000;
export const DEFAULT_SAM3_POLL_MAX_ATTEMPTS = 25;

export class ConfigError extends Error {}

// Loose layer shapes: a blank value means "not provided" at every layer, so a
// resolved address is never empty and a blank override cannot mask a valid
// lower layer. File values arrive untyped from JSON and are narrowed by the
// per-package resolvers with readStringKey.
export interface ConfigLayers {
  cli?: Record<string, string | undefined>;
  env?: Record<string, string | undefined>;
  file?: Record<string, unknown>;
}

export function readStringKey(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function highestPrecedence(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

export function parseBoundedInt(
  raw: string | undefined,
  name: string,
  bounds: { min: number; max: number },
  fallback: number
): number {
  if (raw === undefined) return fallback;
  // Number.parseInt would silently truncate "2.5" or "1000abc"; a value that
  // is not a canonical base-10 integer fails closed instead.
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new ConfigError(`Invalid ${name} "${raw}": expected an integer between ${bounds.min} and ${bounds.max}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new ConfigError(`Invalid ${name} "${raw}": expected an integer between ${bounds.min} and ${bounds.max}`);
  }
  return parsed;
}

export function resolveEnhancementApiBaseUrl(layers: ConfigLayers): string {
  return (
    highestPrecedence(layers.cli?.baseUrl, layers.env?.HTTP_API_BASE_URL, readStringKey(layers.file, 'baseUrl')) ??
    DEFAULT_ENHANCEMENT_API_BASE_URL
  );
}

export function resolveSam3ApiBaseUrl(layers: ConfigLayers): string {
  return (
    highestPrecedence(layers.cli?.sam3BaseUrl, layers.env?.SAM3_API_BASE_URL, readStringKey(layers.file, 'sam3BaseUrl')) ??
    DEFAULT_SAM3_API_BASE_URL
  );
}

export function resolveApiKey(layers: ConfigLayers): string {
  const apiKey = highestPrecedence(layers.cli?.apiKey, layers.env?.API_KEY);
  if (!apiKey) {
    throw new ConfigError('API key is required: pass --api-key or set the API_KEY environment variable');
  }
  return apiKey;
}
