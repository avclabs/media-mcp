import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// The config.json bundled with the calling package is the only file config
// considered; a config.json in the caller's working directory must never
// silently redirect API traffic. The bundled file is located relative to the
// package entry module (dist/server.js -> <package root>/config.json), not
// relative to this core module.

function parseConfigFile(configPath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (error) {
    console.error(`Error: cannot read config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Error: config file ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export function loadBundledConfig(explicitConfigPath: string | undefined, entryModuleUrl: string): Record<string, unknown> {
  if (explicitConfigPath) {
    const resolved = path.resolve(explicitConfigPath);
    console.error(`Using config file: ${resolved}`);
    return parseConfigFile(resolved);
  }
  const bundledPath = path.resolve(path.dirname(fileURLToPath(entryModuleUrl)), '..', 'config.json');
  if (fs.existsSync(bundledPath)) {
    return parseConfigFile(bundledPath);
  }
  return {};
}
