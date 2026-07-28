#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import {
  ConfigError,
  parseFixedParams,
  parseHeaders,
  redactConfig,
  resolveConfig,
} from "./config.js";
import type { Api2McpConfig } from "./config.js";
import { createLogger } from "./log.js";
import { SpecError } from "./openapi.js";
import { createServer } from "./server.js";

const program = new Command()
  .name("api2mcp")
  .description(
    "Serve an OpenAPI 3.x / Swagger 2.x spec as an MCP server over stdio, proxying tool calls to the upstream API.\n" +
      "Config precedence: CLI flags > environment variables (OPENAPI_URL, API_BASE_URL, API_TIMEOUT, API_HEADERS, API_FIXED_PARAMS, DEBUG) > config file (api2mcp.json).\n" +
      "Pass secrets via environment variables, not CLI flags — process arguments are visible to other users.",
  )
  .version("0.1.0")
  .option("-u, --url <url>", "OpenAPI/Swagger spec file path or URL")
  .option("-b, --base-url <url>", "upstream base URL (overrides the spec's servers)")
  .option("--headers <json>", 'upstream headers as a JSON object string, e.g. \'{"Authorization":"Bearer ..."}\'')
  .option("-p, --prefix <prefix>", "prefix for generated tool names")
  .option("-t, --timeout <ms>", "upstream request timeout in milliseconds")
  .option(
    "-f, --fixed-params <params>",
    "params injected into every upstream request but hidden from the LLM (key=value pairs or a JSON object)",
  )
  .option("-d, --debug", "verbose logging to stderr (secrets redacted)");

function cliFlags(): Partial<Api2McpConfig> {
  const opts = program.opts<{
    url?: string;
    baseUrl?: string;
    headers?: string;
    prefix?: string;
    timeout?: string;
    fixedParams?: string;
    debug?: boolean;
  }>();
  const cli: Partial<Api2McpConfig> = {};
  if (opts.url !== undefined) cli.url = opts.url;
  if (opts.baseUrl !== undefined) cli.baseUrl = opts.baseUrl;
  if (opts.headers !== undefined) cli.headers = parseHeaders(opts.headers);
  if (opts.prefix !== undefined) cli.toolPrefix = opts.prefix;
  if (opts.timeout !== undefined) {
    const n = Number(opts.timeout);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ConfigError(`--timeout: expected a positive integer (ms), got "${opts.timeout}"`);
    }
    cli.timeout = n;
  }
  if (opts.fixedParams !== undefined) cli.fixedParams = parseFixedParams(opts.fixedParams);
  if (opts.debug === true) cli.debug = true;
  return cli;
}

async function main(): Promise<void> {
  program.parse();
  const config = await resolveConfig(cliFlags());
  const logger = createLogger(config.debug === true);
  logger.debug(`resolved config: ${JSON.stringify(redactConfig(config))}`);

  const server = await createServer(config);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.debug("serving on stdio");
}

main().catch((err: unknown) => {
  // Expected failures get a clean one-line message; anything else keeps its
  // stack so bugs stay debuggable.
  const message =
    err instanceof ConfigError || err instanceof SpecError
      ? err.message
      : err instanceof Error
        ? (err.stack ?? err.message)
        : String(err);
  process.stderr.write(`api2mcp: ${message}\n`);
  process.exit(1);
});
