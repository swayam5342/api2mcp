/** Resolved configuration for an api2mcp server. */
export interface Api2McpConfig {
  /** OpenAPI/Swagger spec — local file path or URL. */
  url: string;
  /** Upstream base URL; overrides the spec's servers/host+basePath. */
  baseUrl?: string;
  /** Upstream request timeout in milliseconds. */
  timeout?: number;
  /** Headers sent with every upstream request. */
  headers?: Record<string, string>;
  /** Params injected into every upstream request but hidden from the LLM. */
  fixedParams?: Record<string, string>;
  /** Prefix applied to every generated tool name. */
  toolPrefix?: string;
  /** Verbose logging to stderr (secrets redacted). */
  debug?: boolean;
}

/**
 * Resolve configuration by merging CLI flags, environment variables, and a
 * config file (api2mcp.json / api2mcp.config.json / .api2mcp.json), with
 * precedence CLI > env > file.
 *
 * Implemented in the next increment.
 */
export async function resolveConfig(
  _cliFlags: Partial<Api2McpConfig>,
): Promise<Api2McpConfig> {
  throw new Error("not implemented yet");
}
