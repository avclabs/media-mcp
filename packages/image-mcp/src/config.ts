// Image MCP host configuration. Layers: CLI > environment > bundled config
// file > built-in default. An unset image base falls back to the RESOLVED
// enhancement base (HTTP_API_BASE_URL / --base-url chain) — this fallback is a
// compatibility contract with deployed clients and must not be removed.

import {
  ConfigError,
  ConfigLayers,
  highestPrecedence,
  readStringKey,
  resolveApiKey,
  resolveEnhancementApiBaseUrl,
} from '@avclabs.ai/media-mcp-core';

export { ConfigError };

export interface ImageMcpConfig {
  imageApiBaseUrl: string;
  apiKey: string;
}

export function resolveImageConfig(layers: {
  cli?: { imageBaseUrl?: string; baseUrl?: string; apiKey?: string };
  env?: { API_KEY?: string; IMAGE_API_BASE_URL?: string; HTTP_API_BASE_URL?: string };
  file?: Record<string, unknown>;
}): ImageMcpConfig {
  const base: ConfigLayers = layers;
  const enhancementApiBaseUrl = resolveEnhancementApiBaseUrl(base);
  const imageApiBaseUrl =
    highestPrecedence(layers.cli?.imageBaseUrl, layers.env?.IMAGE_API_BASE_URL, readStringKey(layers.file, 'imageBaseUrl')) ??
    enhancementApiBaseUrl;
  return {
    imageApiBaseUrl,
    apiKey: resolveApiKey(base),
  };
}
