# @swayam5342/api2mcp

Serve any OpenAPI 3.x / Swagger 2.x API as a local [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server over stdio. Every operation in the spec becomes an MCP tool; when a tool is called, the request is proxied to the real upstream HTTP API with your configured auth.

It does exactly two things:

1. **Serve** — given a spec (file path or URL), run an MCP server on stdio so Claude Desktop, Claude Code, and other MCP clients can launch it as a subprocess. One spec → one server.
2. **Proxy** — forward tool calls to the upstream API using the method/path/params from the spec, injecting your configured headers and fixed params, and return the response.

No telemetry, no database, no eval. The only network egress is the upstream calls you configure (plus fetching the spec itself if you pass a URL).

## Quick start

```bash
npx @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json
```

That's a running MCP server on stdio — every Petstore endpoint is now a tool. Point an MCP client at it (see below) and ask it to list pets.

## Install

```bash
# no install needed
npx @swayam5342/api2mcp --url ./openapi.json

# or globally
npm install -g @swayam5342/api2mcp
api2mcp --url ./openapi.json
```

Requires Node.js >= 18.

## Use with Claude Desktop

Add to your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": [
        "-y",
        "@swayam5342/api2mcp",
        "--url",
        "https://petstore3.swagger.io/api/v3/openapi.json"
      ]
    }
  }
}
```

Restart Claude Desktop; the spec's operations appear as tools named after their `operationId` (e.g. `addPet`, `getPetById`).

## CLI reference

```text
api2mcp --url <spec> [options]
```

| Flag | Short | Description |
| ---- | ----- | ----------- |
| `--url <url>` | `-u` | OpenAPI/Swagger spec — file path or URL |
| `--base-url <url>` | `-b` | Upstream base URL (overrides the spec's `servers` / `host`+`basePath`) |
| `--headers <json>` | — | Upstream headers as a JSON object string |
| `--prefix <prefix>` | `-p` | Prefix for generated tool names (`myapi_listPets`) |
| `--timeout <ms>` | `-t` | Upstream request timeout in ms (default 30000) |
| `--fixed-params <params>` | `-f` | Params injected into every upstream request, hidden from the LLM (`key=value` pairs or JSON) |
| `--debug` | `-d` | Verbose logging to stderr (secrets redacted) |

`--headers` intentionally has no short flag: `-h` shows help.

## Configuration

Every flag can also come from environment variables or a config file. Precedence: **CLI flags > environment variables > config file**.

### Environment variables

| Variable | Meaning |
| -------- | ------- |
| `OPENAPI_URL` | Spec file path or URL |
| `API_BASE_URL` | Upstream base URL |
| `API_TIMEOUT` | Timeout in ms |
| `API_HEADERS` | Headers as a JSON object string |
| `API_FIXED_PARAMS` | Fixed params (`key=value` or JSON) |
| `DEBUG` | Debug logging (`0`/`false`/`off` disable) |

### Config file

The first of `api2mcp.json`, `api2mcp.config.json`, `.api2mcp.json` found in the working directory is used:

```json
{
  "url": "https://api.example.com/openapi.json",
  "baseUrl": "https://api.example.com",
  "timeout": 30000,
  "headers": { "Authorization": "Bearer your-token" },
  "fixedParams": { "apiKey": "your-key" },
  "toolPrefix": "myapi"
}
```

## Passing secrets safely

**Don't put API keys in `--headers` or `--fixed-params` on the command line** — process arguments are visible to other users on the machine (`ps`). Use your MCP client's `env` field instead:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@swayam5342/api2mcp", "--url", "https://api.example.com/openapi.json"],
      "env": {
        "API_HEADERS": "{\"Authorization\":\"Bearer YOUR_TOKEN\"}",
        "API_FIXED_PARAMS": "apiKey=YOUR_KEY"
      }
    }
  }
}
```

All header and fixed-param values are redacted (`***`) from every log line and error message, including upstream error bodies that echo them back.

## Fixed params: auth the LLM never sees

Fixed params are injected into **every** upstream request but are stripped from the tool schemas, so the model never sees the key and cannot leak or misuse it:

```bash
API_FIXED_PARAMS="apiKey=YOUR_KEY" npx @swayam5342/api2mcp --url ./openapi.json
```

- If the spec declares a matching parameter (query, or a body property), the value is injected in that declared location.
- Unknown keys are sent as query parameters.
- Accepts `key=value`, comma-separated `a=1,b=2`, or a JSON object string.

## How operations become tools

| Spec | Tool |
| ---- | ---- |
| `operationId: listPets` | tool `listPets` (with `--prefix pets`: `pets_listPets`) |
| no operationId, `GET /pets/{petId}` | tool `get_pets_petId` |
| `summary` / `description` | tool description (fallback: `GET /pets`) |
| path/query/header params | top-level input fields, required per the spec |
| JSON request body (object) | properties flattened into top-level input fields |
| JSON request body (non-object) | single `body` input field |

v1 limitations: JSON request bodies only (no multipart/form-urlencoded), cookie params ignored, and every operation is registered directly (no on-demand mode for very large specs).

## Worked example: Petstore

```bash
npx @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json --prefix pets --debug
```

stderr shows the redacted config and `registered N tools ...`, then the server waits on stdio. In Claude Desktop:

```json
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": [
        "-y",
        "@swayam5342/api2mcp",
        "--url", "https://petstore3.swagger.io/api/v3/openapi.json",
        "--prefix", "pets"
      ]
    }
  }
}
```

Then ask Claude: *"Find available pets in the store"* — it calls `pets_findPetsByStatus` with `status: "available"`, the call is proxied to `https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available`, and the JSON response comes back as the tool result.

## Library API

```ts
import { createServer, resolveConfig } from "@swayam5342/api2mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = await resolveConfig({ url: "./openapi.json" }); // merges env + config file
const server = await createServer(config);                      // an SDK McpServer, tools registered
await server.connect(new StdioServerTransport());               // or any other transport
```

Exports: `createServer(config, options?)`, `resolveConfig(cliFlags, options?)`, and the types `Api2McpConfig`, `CreateServerOptions`. `options.fetchImpl` lets you swap the HTTP layer (e.g. for tests).

## License

MIT
