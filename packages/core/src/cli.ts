// Command-line argument helpers. Server packages declare only the flags they
// own; unrecognized arguments are ignored, matching the historical parser.

/** Extracts the value of a repeated `--flag value` style argument list into a key map. */
export function parseFlagValues(args: string[], flagToKey: Record<string, string>): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = flagToKey[args[i]];
    if (key !== undefined && i + 1 < args.length) {
      overrides[key] = args[i + 1];
      i++;
    }
  }
  return overrides;
}

/** Returns the path given to `--config`, if present. */
export function extractConfigPath(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}
