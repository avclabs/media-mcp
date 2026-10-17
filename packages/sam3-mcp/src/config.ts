// SAM3 MCP host configuration. Layers: CLI > environment > bundled config
// file > built-in default. The sync wait is bounded by two independent limits:
// at most SAM3_POLL_MAX_ATTEMPTS status queries and a time budget of
// interval x attempts. SAM3_POLL_INTERVAL_MS is the canonical name;
// SAM3_POLL_INTERVAL is kept as a deprecated alias.

import {
  ConfigError,
  ConfigLayers,
  DEFAULT_SAM3_POLL_INTERVAL_MS,
  DEFAULT_SAM3_POLL_MAX_ATTEMPTS,
  highestPrecedence,
  parseBoundedInt,
  resolveApiKey,
  resolveSam3ApiBaseUrl,
  SAM3_POLL_INTERVAL_MS_BOUNDS,
  SAM3_POLL_MAX_ATTEMPTS_BOUNDS,
} from '@avclabs.ai/media-mcp-core';

export interface Sam3McpConfig {
  apiBaseUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  pollMaxAttempts: number;
}

export function resolveSam3Config(layers: {
  cli?: { sam3BaseUrl?: string; apiKey?: string; sam3PollIntervalMs?: string; sam3PollMaxAttempts?: string };
  env?: {
    API_KEY?: string;
    SAM3_API_BASE_URL?: string;
    SAM3_POLL_INTERVAL_MS?: string;
    SAM3_POLL_INTERVAL?: string;
    SAM3_POLL_MAX_ATTEMPTS?: string;
  };
  file?: Record<string, unknown>;
}): Sam3McpConfig {
  const base: ConfigLayers = layers;
  const pollIntervalMs = parseBoundedInt(
    highestPrecedence(layers.cli?.sam3PollIntervalMs, layers.env?.SAM3_POLL_INTERVAL_MS, layers.env?.SAM3_POLL_INTERVAL),
    'SAM3_POLL_INTERVAL_MS',
    SAM3_POLL_INTERVAL_MS_BOUNDS,
    DEFAULT_SAM3_POLL_INTERVAL_MS
  );
  const pollMaxAttempts = parseBoundedInt(
    highestPrecedence(layers.cli?.sam3PollMaxAttempts, layers.env?.SAM3_POLL_MAX_ATTEMPTS),
    'SAM3_POLL_MAX_ATTEMPTS',
    SAM3_POLL_MAX_ATTEMPTS_BOUNDS,
    DEFAULT_SAM3_POLL_MAX_ATTEMPTS
  );
  return {
    apiBaseUrl: resolveSam3ApiBaseUrl(base),
    apiKey: resolveApiKey(base),
    pollIntervalMs,
    pollMaxAttempts,
  };
}

export { ConfigError };
