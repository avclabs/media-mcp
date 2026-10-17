// Library surface for the legacy all-in-one package. The bin entry
// (server.ts) is deliberately not exported here: importing it starts the
// stdio server.
export {
  ConfigError,
  MediaHostCliOverrides,
  MediaHostConfig,
  MediaHostEnv,
  resolveMediaHostConfig,
} from './config.js';
