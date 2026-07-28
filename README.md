# @swayam/api2mcp

Serve any OpenAPI 3.x / Swagger 2.x API as a local [MCP](https://modelcontextprotocol.io) server over stdio. Each operation in the spec becomes an MCP tool; tool calls are proxied to the real upstream HTTP API with your configured auth.

> Status: pre-release, under active development. Docs will be completed before 0.1.0 is published.

## Quick start

```bash
npx @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json
```

## What it does

1. **Serve** — given a spec (file path or URL), runs an MCP server on stdio so Claude Desktop and other MCP clients can launch it as a subprocess.
2. **Proxy** — when a tool is called, forwards the request to the upstream API using the method/path/params from the spec, injecting configured headers and fixed params.

Nothing else: no telemetry, no database, no network egress except the upstream calls you configure.

## License

MIT
