import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Api2McpConfig } from "./config.js";
import { ConfigError } from "./config.js";
import { createLogger } from "./log.js";
import { baseUrlFromSpec, listOperations, loadSpec } from "./openapi.js";
import { proxyCall } from "./proxy.js";
import type { ProxyContext } from "./proxy.js";
import { mapOperationsToTools } from "./tools.js";

const SERVER_NAME = "api2mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Build an MCP server wired to the configured upstream API: loads the spec,
 * registers one tool per operation, and proxies tool calls upstream. The
 * caller connects a transport (the CLI uses stdio).
 */
export async function createServer(config: Api2McpConfig): Promise<McpServer> {
  const logger = createLogger(config.debug === true);

  const doc = await loadSpec(config.url);
  const baseUrl = config.baseUrl ?? baseUrlFromSpec(doc);
  if (!baseUrl) {
    throw new ConfigError(
      "no upstream base URL: the spec declares none, so pass --base-url (or API_BASE_URL / \"baseUrl\" in a config file)",
    );
  }

  const mapOptions: Parameters<typeof mapOperationsToTools>[1] = {};
  if (config.toolPrefix !== undefined) mapOptions.toolPrefix = config.toolPrefix;
  if (config.fixedParams !== undefined) mapOptions.fixedParams = config.fixedParams;
  const tools = mapOperationsToTools(listOperations(doc), mapOptions);

  const ctx: ProxyContext = {
    baseUrl,
    headers: config.headers ?? {},
    fixedParams: config.fixedParams ?? {},
    timeout: config.timeout,
    logger,
  };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => proxyCall(tool, args, ctx),
    );
  }

  logger.debug(`registered ${tools.length} tools for ${baseUrl}`);
  return server;
}
