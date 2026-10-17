// Library surface for the image-mcp package. The bin entry (server.ts) is
// deliberately not exported here: importing it starts the stdio server.
export { setupImageEnhancementTools } from './image-enhancement.js';
export { resolveImageConfig, ImageMcpConfig } from './config.js';
