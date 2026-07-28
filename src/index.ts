/**
 * @swayam/api2mcp — public library surface.
 *
 * Exports are intentionally minimal: a config type, a config resolver, and a
 * server factory. Everything else is internal.
 */

export type { Api2McpConfig } from "./config.js";
export { resolveConfig } from "./config.js";
export { createServer } from "./server.js";
export type { CreateServerOptions } from "./server.js";

