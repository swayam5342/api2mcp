import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Api2McpConfig } from "./config.js";

/**
 * Build an MCP server wired to the configured upstream API: loads the spec,
 * registers one tool per operation, and proxies tool calls upstream. The
 * caller connects a transport (the CLI uses stdio).
 *
 * Implemented in a later increment.
 */
export async function createServer(_config: Api2McpConfig): Promise<McpServer> {
  throw new Error("not implemented yet");
}
