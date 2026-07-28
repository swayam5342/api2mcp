import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./log.js";
import type { ToolDefinition } from "./tools.js";

/** Everything the proxy needs to build an upstream request. */
export interface ProxyContext {
  baseUrl: string;
  headers: Record<string, string>;
  fixedParams: Record<string, string>;
  /** Milliseconds; undefined = no explicit timeout. */
  timeout: number | undefined;
  logger: Logger;
}

/**
 * Forward a tool call to the upstream API and shape the response as an MCP
 * tool result. Implemented in the proxy increment.
 */
export async function proxyCall(
  _tool: ToolDefinition,
  _args: Record<string, unknown>,
  _ctx: ProxyContext,
): Promise<CallToolResult> {
  throw new Error("proxy not implemented yet");
}
