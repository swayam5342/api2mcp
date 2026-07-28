import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

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

/** Error thrown for invalid or missing configuration. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const CONFIG_FILE_NAMES = [
  "api2mcp.json",
  "api2mcp.config.json",
  ".api2mcp.json",
] as const;

const stringRecord = z.record(z.string());

const fileSchema = z
  .object({
    url: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    headers: stringRecord.optional(),
    fixedParams: stringRecord.optional(),
    toolPrefix: z.string().optional(),
    debug: z.boolean().optional(),
  })
  .strict();

/**
 * Parse a JSON object string into a string→string record. Non-string values
 * (numbers, booleans) are coerced to strings; nested objects are rejected.
 */
function parseJsonRecord(input: string, label: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ConfigError(`${label}: invalid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${label}: expected a JSON object`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value === "object") {
      throw new ConfigError(
        `${label}: value for "${key}" must be a string, number, or boolean`,
      );
    }
    out[key] = String(value);
  }
  return out;
}

/** Parse a `--headers` / `API_HEADERS` value (JSON object string). */
export function parseHeaders(input: string): Record<string, string> {
  return parseJsonRecord(input, "headers");
}

/**
 * Parse a `--fixed-params` / `API_FIXED_PARAMS` value. Accepts a JSON object
 * string or `key=value` pairs (multiple pairs separated by commas). Values
 * containing commas or `=` must use the JSON form.
 */
export function parseFixedParams(input: string): Record<string, string> {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new ConfigError("fixed-params: empty value");
  }
  if (trimmed.startsWith("{")) {
    return parseJsonRecord(trimmed, "fixed-params");
  }
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new ConfigError(
        `fixed-params: expected key=value or a JSON object, got "${pair.trim()}"`,
      );
    }
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

function parseTimeout(input: string, label: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${label}: expected a positive integer (ms), got "${input}"`);
  }
  return n;
}

function parseBooleanEnv(input: string): boolean {
  return !["", "0", "false", "no", "off"].includes(input.trim().toLowerCase());
}

/** Build a partial config from environment variables. */
function configFromEnv(env: Record<string, string | undefined>): Partial<Api2McpConfig> {
  const out: Partial<Api2McpConfig> = {};
  if (env.OPENAPI_URL) out.url = env.OPENAPI_URL;
  if (env.API_BASE_URL) out.baseUrl = env.API_BASE_URL;
  if (env.API_TIMEOUT) out.timeout = parseTimeout(env.API_TIMEOUT, "API_TIMEOUT");
  if (env.API_HEADERS) out.headers = parseHeaders(env.API_HEADERS);
  if (env.API_FIXED_PARAMS) out.fixedParams = parseFixedParams(env.API_FIXED_PARAMS);
  if (env.DEBUG !== undefined) out.debug = parseBooleanEnv(env.DEBUG);
  return out;
}

/** Load and validate the first config file found in `cwd`, if any. */
async function configFromFile(cwd: string): Promise<Partial<Api2McpConfig>> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = resolve(cwd, name);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError(`${name}: invalid JSON`);
    }
    const result = fileSchema.safeParse(parsed);
    if (!result.success) {
      const hint =
        typeof parsed === "object" && parsed !== null && "openapiUrl" in parsed
          ? ' (this project uses "url", not "openapiUrl")'
          : "";
      throw new ConfigError(
        `${name}: ${result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}${hint}`,
      );
    }
    return Object.fromEntries(
      Object.entries(result.data).filter(([, v]) => v !== undefined),
    ) as Partial<Api2McpConfig>;
  }
  return {};
}

/** Merge partial configs, later sources winning per field. */
function merge(...layers: Partial<Api2McpConfig>[]): Partial<Api2McpConfig> {
  const out: Partial<Api2McpConfig> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        (out as Record<string, unknown>)[key] = value;
      }
    }
  }
  return out;
}

/** Options for {@link resolveConfig}; primarily for testing. */
export interface ResolveOptions {
  /** Environment to read from (default: `process.env`). */
  env?: Record<string, string | undefined>;
  /** Directory searched for config files (default: `process.cwd()`). */
  cwd?: string;
}

/**
 * Resolve configuration by merging CLI flags, environment variables, and a
 * config file (api2mcp.json / api2mcp.config.json / .api2mcp.json), with
 * precedence CLI > env > file. Throws {@link ConfigError} if no spec `url`
 * is provided by any source, or if any source is malformed.
 */
export async function resolveConfig(
  cliFlags: Partial<Api2McpConfig>,
  options: ResolveOptions = {},
): Promise<Api2McpConfig> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const fromFile = await configFromFile(cwd);
  const fromEnv = configFromEnv(env);
  const merged = merge(fromFile, fromEnv, cliFlags);

  if (!merged.url) {
    throw new ConfigError(
      "no spec provided: pass --url, set OPENAPI_URL, or add \"url\" to a config file",
    );
  }
  return merged as Api2McpConfig;
}

const REDACTED = "***";

/**
 * Copy of the config safe for logging: all header and fixed-param values are
 * replaced with "***". Every value in those maps is treated as a secret.
 */
export function redactConfig(config: Api2McpConfig): Api2McpConfig {
  const redactValues = (rec: Record<string, string> | undefined) =>
    rec === undefined
      ? undefined
      : Object.fromEntries(Object.keys(rec).map((k) => [k, REDACTED]));
  const out: Api2McpConfig = { ...config };
  const headers = redactValues(config.headers);
  const fixedParams = redactValues(config.fixedParams);
  if (headers !== undefined) out.headers = headers;
  if (fixedParams !== undefined) out.fixedParams = fixedParams;
  return out;
}
