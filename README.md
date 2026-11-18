<div align="center">

<img src="docs/icon.svg" width="88" height="88" alt="api2mcp">

# api2mcp

**Your API, as tools Claude can call.**

`@swayam5342/api2mcp` serves any **OpenAPI 3.x / Swagger 2.x** API as a local [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server over **stdio**, written in **TypeScript**. Every operation in the spec **becomes an MCP tool**; when a tool is called, the request is **proxied to the real upstream API with your configured auth**, which the model never sees.

[![npm](https://img.shields.io/npm/v/@swayam5342/api2mcp?style=flat-square&logo=npm&logoColor=white&labelColor=0d3a55&color=4cb3f0)](https://www.npmjs.com/package/@swayam5342/api2mcp)
[![Node](https://img.shields.io/badge/Node.js-18%2B-4cb3f0?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0d3a55)](package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio-4cb3f0?style=flat-square&logo=anthropic&logoColor=white&labelColor=0d3a55)](#use-with-claude-desktop)
[![CI](https://img.shields.io/github/actions/workflow/status/swayam5342/api2mcp/ci.yml?branch=master&style=flat-square&logo=githubactions&logoColor=white&labelColor=0d3a55&color=4cb3f0&label=CI)](.github/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-4cb3f0?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=0d3a55)](LICENSE)

[**Website**](https://github.swayam.li/api2mcp/) &nbsp;&middot;&nbsp; [Quick Start](#quick-start) &nbsp;&middot;&nbsp; [CLI Reference](#cli-reference) &nbsp;&middot;&nbsp; [Passing Secrets Safely](#passing-secrets-safely) &nbsp;&middot;&nbsp; [Library API](#library-api)

</div>

<br>

## Table of Contents

| | |
| :--- | :--- |
| **Overview** | [How It Works](#how-it-works) &middot; [How Operations Become Tools](#how-operations-become-tools) |
| **Setup** | [Prerequisites](#prerequisites) &middot; [Quick Start](#quick-start) &middot; [Install](#install) &middot; [Use with Claude Desktop](#use-with-claude-desktop) &middot; [Use with Claude Code](#use-with-claude-code) |
| **Reference** | [CLI Reference](#cli-reference) &middot; [Configuration](#configuration) &middot; [Library API](#library-api) |
| **Security** | [Passing Secrets Safely](#passing-secrets-safely) &middot; [Fixed Params: Auth the LLM Never Sees](#fixed-params-auth-the-llm-never-sees) |
| **Examples** | [Worked Example: Petstore](#worked-example-petstore) &middot; [Verification & Testing](#verification--testing) |

<br>

## How It Works

It does exactly two things:

| | Step | What happens |
| :---: | :--- | :--- |
| 1 | **Serve** | Given a spec (file path or URL), run an MCP server on stdio so Claude Desktop, Claude Code and other MCP clients can launch it as a subprocess. One spec, one server. |
| 2 | **Proxy** | Forward tool calls to the upstream API using the method, path and params from the spec, inject your configured headers and fixed params, and return the response. |

> [!NOTE]
> No telemetry, no database, no eval. The only network egress is the upstream calls you configure, plus fetching the spec itself if you pass a URL.

<br>

## Prerequisites

| Requirement | When |
| :--- | :--- |
| **Node.js 18+** | Always (`npx` or a global install). |
| **An OpenAPI 3.x or Swagger 2.x spec** | A file path or a URL. |
| **pnpm** | Only to build from source. |

<br>

## Quick Start

```bash
npx @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json
```

That's a running MCP server on stdio: every Petstore endpoint is now a tool. Point an MCP client at it ([below](#use-with-claude-desktop)) and ask it to list pets.

<br>

## Install

<details open>
<summary><b>No install</b> (<code>npx</code>)</summary>

```bash
npx @swayam5342/api2mcp --url ./openapi.json
```

</details>

<details>
<summary><b>Global install</b> (<code>npm install -g</code>)</summary>

```bash
npm install -g @swayam5342/api2mcp
api2mcp --url ./openapi.json
```

</details>

<br>

## Use with Claude Desktop

Add this to your Claude Desktop config file:

| OS | Config file |
| :--- | :--- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

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

Restart Claude Desktop; the spec's operations appear as tools named after their `operationId` (for example `addPet`, `getPetById`).

<br>

## Use with Claude Code

```bash
claude mcp add petstore -- npx -y @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json
```

> [!TIP]
> Pass secrets with `-e`, not as arguments: `claude mcp add my-api -e API_HEADERS='{"Authorization":"Bearer YOUR_TOKEN"}' -- npx -y @swayam5342/api2mcp --url https://api.example.com/openapi.json`

<br>

## CLI Reference

```text
api2mcp --url <spec> [options]
```

| Flag | Short | Description |
| :--- | :--- | :--- |
| `--url <url>` | `-u` | OpenAPI/Swagger spec: file path or URL. |
| `--base-url <url>` | `-b` | Upstream base URL (overrides the spec's `servers` / `host`+`basePath`). |
| `--headers <json>` | none | Upstream headers as a JSON object string. |
| `--prefix <prefix>` | `-p` | Prefix for generated tool names (`myapi_listPets`). |
| `--timeout <ms>` | `-t` | Upstream request timeout in ms (default `30000`). |
| `--fixed-params <params>` | `-f` | Params injected into every upstream request, hidden from the LLM (`key=value` pairs or JSON). |
| `--debug` | `-d` | Verbose logging to stderr (secrets redacted). |

> [!NOTE]
> `--headers` intentionally has no short flag: `-h` shows help.

<br>

## Configuration

Every flag can also come from environment variables or a config file. Precedence: **CLI flags > environment variables > config file**.

| Variable | Meaning |
| :--- | :--- |
| `OPENAPI_URL` | Spec file path or URL. |
| `API_BASE_URL` | Upstream base URL. |
| `API_TIMEOUT` | Timeout in ms. |
| `API_HEADERS` | Headers as a JSON object string. |
| `API_FIXED_PARAMS` | Fixed params (`key=value` or JSON). |
| `DEBUG` | Debug logging (`0`, `false` or `off` disable it). |

The first of `api2mcp.json`, `api2mcp.config.json` or `.api2mcp.json` found in the working directory is used:

<details open>
<summary><b>Config file</b> (<code>api2mcp.json</code>)</summary>

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

</details>

<br>

## Passing Secrets Safely

> [!IMPORTANT]
> **Don't put API keys in `--headers` or `--fixed-params` on the command line.** Process arguments are visible to other users on the machine (`ps`). Use your MCP client's `env` field instead.

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

<br>

## Fixed Params: Auth the LLM Never Sees

Fixed params are injected into **every** upstream request but are stripped from the tool schemas, so the model never sees the key and cannot leak or misuse it:

```bash
API_FIXED_PARAMS="apiKey=YOUR_KEY" npx @swayam5342/api2mcp --url ./openapi.json
```

| Case | Where the value goes |
| :--- | :--- |
| The spec declares a matching parameter (query, or a body property) | Injected in that declared location. |
| The key isn't declared | Sent as a query parameter. |

Accepts `key=value`, comma-separated `a=1,b=2`, or a JSON object string.

<br>

## How Operations Become Tools

| Spec | Tool |
| :--- | :--- |
| `operationId: listPets` | Tool `listPets` (with `--prefix pets`: `pets_listPets`). |
| No operationId, `GET /pets/{petId}` | Tool `get_pets_petId`. |
| `summary` / `description` | Tool description (fallback: `GET /pets`). |
| Path, query and header params | Top-level input fields, required per the spec. |
| JSON request body (object) | Properties flattened into top-level input fields. |
| JSON request body (non-object) | A single `body` input field. |

> [!WARNING]
> v1 limitations: JSON request bodies only (no multipart or form-urlencoded), cookie params are ignored, and every operation is registered directly (no on-demand mode for very large specs).

<br>

## Worked Example: Petstore

<details open>
<summary><b>Run it with a prefix and debug logs</b> (<code>--prefix pets --debug</code>)</summary>

```bash
npx @swayam5342/api2mcp --url https://petstore3.swagger.io/api/v3/openapi.json --prefix pets --debug
```

stderr shows the redacted config and `registered N tools ...`, then the server waits on stdio.

</details>

<details>
<summary><b>The same server in Claude Desktop</b> (<code>claude_desktop_config.json</code>)</summary>

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

</details>

Then ask Claude *"Find available pets in the store"*. It calls `pets_findPetsByStatus` with `status: "available"`, the call is proxied to `https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available`, and the JSON response comes back as the tool result.

<br>

## Library API

```ts
import { createServer, resolveConfig } from "@swayam5342/api2mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = await resolveConfig({ url: "./openapi.json" }); // merges env + config file
const server = await createServer(config);                      // an SDK McpServer, tools registered
await server.connect(new StdioServerTransport());               // or any other transport
```

| Export | What it is |
| :--- | :--- |
| `createServer(config, options?)` | Builds an MCP SDK `McpServer` with every operation registered as a tool. `options.fetchImpl` swaps the HTTP layer (for example in tests). |
| `resolveConfig(cliFlags, options?)` | Merges CLI flags, environment variables and the config file, in that precedence. |
| `Api2McpConfig`, `CreateServerOptions` | Types. |

<br>

## Verification & Testing

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

The same four steps run in GitHub Actions on every push and pull request to `master` (`.github/workflows/ci.yml`). Tests use the Petstore OpenAPI 3 and Swagger 2 specs in `test/fixtures/`.

<br>

## License

MIT
