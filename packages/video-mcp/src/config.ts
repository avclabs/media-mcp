// Video MCP host configuration. Layers: CLI > environment > bundled config
// file > built-in default. Validation happens here, before any tool is created
// or request is made; error messages never echo secret values.

import { ConfigError, ConfigLayers, resolveApiKey, resolveEnhancementApiBaseUrl } from '@avclabs.ai/media-mcp-core';

export { ConfigError };

export interface VideoMcpConfig {
  apiBaseUrl: string;
  apiKey: string;
}

export function resolveVideoConfig(layers: {
  cli?: { baseUrl?: string; apiKey?: string };
  env?: { API_KEY?: string; HTTP_API_BASE_URL?: string };
  file?: Record<string, unknown>;
}): VideoMcpConfig {
  const base: ConfigLayers = layers;
  return {
    apiBaseUrl: resolveEnhancementApiBaseUrl(base),
    apiKey: resolveApiKey(base),
  };
}
