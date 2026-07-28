/**
 * Minimal stderr logger. stdout is owned by the MCP stdio transport, so all
 * human-facing output must go to stderr. Callers are responsible for
 * redacting secrets before logging (see redactConfig).
 */
export interface Logger {
  debug(message: string): void;
  error(message: string): void;
}

export function createLogger(debugEnabled: boolean): Logger {
  return {
    debug(message) {
      if (debugEnabled) process.stderr.write(`[api2mcp] ${message}\n`);
    },
    error(message) {
      process.stderr.write(`[api2mcp] error: ${message}\n`);
    },
  };
}
