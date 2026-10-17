// Legacy all-in-one host configuration. Composes the per-package resolvers so
// resolveMediaHostConfig keeps its historical semantics exactly: precedence
// per key is CLI > environment > file config > built-in default, the image
// base derives from the RESOLVED enhancement base, and validation happens
// before any tool is created. New integrations should use the per-function
// packages instead of this one.

import { ConfigError } from '@avclabs.ai/media-mcp-core';
import { resolveVideoConfig } from '@avclabs.ai/video-mcp';
import { resolveImageConfig } from '@avclabs.ai/image-mcp';
import { resolveSam3Config } from '@avclabs.ai/sam3-mcp';

export { ConfigError };

export interface MediaHostCliOverrides {
  baseUrl?: string;
  imageBaseUrl?: string;
  sam3BaseUrl?: string;
  apiKey?: string;
  /** Raw argument text; parsed and bounds-checked by the sam3 resolver. */
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

export function resolveMediaHostConfig(options: {
  cli?: MediaHostCliOverrides;
  env?: MediaHostEnv;
  file?: Record<string, unknown>;
}): MediaHostConfig {
  const video = resolveVideoConfig(options);
  const image = resolveImageConfig(options);
  const sam3 = resolveSam3Config(options);
  return {
    enhancementApiBaseUrl: video.apiBaseUrl,
    imageApiBaseUrl: image.imageApiBaseUrl,
    sam3ApiBaseUrl: sam3.apiBaseUrl,
    apiKey: video.apiKey,
    sam3PollIntervalMs: sam3.pollIntervalMs,
    sam3PollMaxAttempts: sam3.pollMaxAttempts,
  };
}
