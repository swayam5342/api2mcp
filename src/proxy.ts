import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./log.js";
import type { ToolDefinition } from "./tools.js";

/** Applied when no timeout is configured. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Everything the proxy needs to build an upstream request. */
export interface ProxyContext {
  baseUrl: string;
  headers: Record<string, string>;
  fixedParams: Record<string, string>;
  /** Milliseconds; undefined = DEFAULT_TIMEOUT_MS. */
  timeout: number | undefined;
  logger: Logger;
  /** HTTP implementation; tests inject a mock. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Replace every configured secret value occurring in `text` with "***". */
function redact(text: string, ctx: ProxyContext): string {
  let out = text;
  for (const secret of [...Object.values(ctx.headers), ...Object.values(ctx.fixedParams)]) {
    if (secret === "") continue;
    out = out.split(secret).join("***");
    // Secrets also show up percent-encoded inside URLs.
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join("***");
  }
  return out;
}

interface UpstreamRequest {
  url: URL;
  headers: Record<string, string>;
  body: unknown | undefined;
}

/**
 * Assemble the upstream request from tool args and fixed params.
 * Throws Error with a user-facing message on unusable input.
 */
function buildRequest(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ProxyContext,
): UpstreamRequest {
  let path = tool.pathTemplate;
  const query: Array<[string, string]> = [];
  const headers: Record<string, string> = { ...ctx.headers };
  let bodyRoot: unknown;
  const bodyFields: Record<string, unknown> = {};
  let hasBodyFields = false;

  const place = (
    where: ToolDefinition["params"][number]["in"],
    upstreamName: string,
    value: unknown,
  ) => {
    switch (where) {
      case "path": {
        const encoded = encodeURIComponent(String(value));
        const before = path;
        path = path.replace(`{${upstreamName}}`, encoded);
        if (path === before) {
          throw new Error(`path template has no {${upstreamName}} placeholder`);
        }
        break;
      }
      case "query":
        query.push([upstreamName, String(value)]);
        break;
      case "header":
        headers[upstreamName] = String(value);
        break;
      case "body":
        bodyFields[upstreamName] = value;
        hasBodyFields = true;
        break;
      case "bodyRoot":
        bodyRoot = value;
        break;
    }
  };

  for (const p of tool.params) {
    const value = args[p.name];
    if (value === undefined) {
      if (p.required) throw new Error(`missing required argument "${p.name}"`);
      continue;
    }
    place(p.in, p.upstreamName, value);
  }

  // Fixed params: spec-declared ones go where the spec says; unknown keys
  // default to query. Values come from config, never from the LLM.
  const declared = new Map(tool.hiddenParams.map((p) => [p.upstreamName, p.in]));
  for (const [key, value] of Object.entries(ctx.fixedParams)) {
    place(declared.get(key) ?? "query", key, value);
  }

  if (/[{}]/.test(path)) {
    throw new Error(`unresolved path parameters in ${path}`);
  }

  const base = ctx.baseUrl.endsWith("/") ? ctx.baseUrl.slice(0, -1) : ctx.baseUrl;
  const url = new URL(base + path);
  for (const [key, value] of query) url.searchParams.append(key, value);

  const body = bodyRoot !== undefined ? bodyRoot : hasBodyFields ? bodyFields : undefined;
  if (body !== undefined && headers["Content-Type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }
  return { url, headers, body };
}

/**
 * Forward a tool call to the upstream API and shape the response as an MCP
 * tool result. All failures (bad args, network, timeout, non-2xx) become
 * `isError` tool results rather than protocol errors, so the LLM can react.
 */
export async function proxyCall(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ProxyContext,
): Promise<CallToolResult> {
  let request: UpstreamRequest;
  try {
    request = buildRequest(tool, args, ctx);
  } catch (err) {
    return errorResult(
      `${tool.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const method = tool.method.toUpperCase();
  ctx.logger.debug(redact(`→ ${method} ${request.url.href}`, ctx));

  const timeout = ctx.timeout ?? DEFAULT_TIMEOUT_MS;
  const doFetch = ctx.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(request.url, {
      method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const message = isTimeout
      ? `upstream request timed out after ${timeout}ms`
      : `upstream request failed: ${err instanceof Error ? err.message : String(err)}`;
    ctx.logger.debug(redact(`✗ ${method} ${request.url.pathname}: ${message}`, ctx));
    return errorResult(redact(`${tool.name}: ${message}`, ctx));
  }

  const text = await response.text();
  ctx.logger.debug(redact(`← ${response.status} ${method} ${request.url.pathname}`, ctx));

  if (!response.ok) {
    return errorResult(
      redact(
        `${tool.name}: upstream returned ${response.status} ${response.statusText}\n${text}`,
        ctx,
      ),
    );
  }
  return {
    content: [{ type: "text", text: text === "" ? `(empty response, status ${response.status})` : text }],
  };
}
