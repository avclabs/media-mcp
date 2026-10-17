// Library surface for the video-mcp package. The bin entry (server.ts) is
// deliberately not exported here: importing it starts the stdio server.
export { setupVideoEnhancementTools } from './video-enhancement.js';
export { resolveVideoConfig, VideoMcpConfig } from './config.js';
