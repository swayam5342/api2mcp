import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const oas3Path = join(fixturesDir, "petstore-oas3.json");

/** Connect a client to the server over an in-memory pair (no stdio). */
async function connect(server: Awaited<ReturnType<typeof createServer>>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("createServer", () => {
  it("registers one tool per operation, visible via tools/list", async () => {
    const server = await createServer({ url: oas3Path });
    const client = await connect(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPet",
      "delete_pets_petId",
      "getPetById",
      "listPets",
    ]);

    const list = tools.find((t) => t.name === "listPets")!;
    expect(list.description).toBe("List all pets");
    const props = list.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["limit", "status"]);
  });

  it("applies the tool prefix and hides fixed params from tools/list", async () => {
    const server = await createServer({
      url: oas3Path,
      toolPrefix: "pets",
      fixedParams: { limit: "10" },
    });
    const client = await connect(server);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("pets_listPets");

    const list = tools.find((t) => t.name === "pets_listPets")!;
    const props = list.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["status"]);
  });

  it("marks required fields in the advertised JSON schema", async () => {
    const server = await createServer({ url: oas3Path });
    const client = await connect(server);

    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "createPet")!;
    expect(create.inputSchema.required).toEqual(["name"]);
  });

  it("fails fast when neither spec nor config provide a base URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "api2mcp-nobase-"));
    const specPath = join(dir, "spec.json");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "NoServers", version: "1.0.0" },
        paths: { "/x": { get: { operationId: "getX", responses: { "200": { description: "ok" } } } } },
      }),
    );
    await expect(createServer({ url: specPath })).rejects.toThrow(/no upstream base URL/);
    // ...but an explicit baseUrl fixes it
    const server = await createServer({ url: specPath, baseUrl: "https://x.example" });
    const client = await connect(server);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["getX"]);
  });

  it("proxies a tool call end-to-end over the MCP protocol (mocked fetch)", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input));
      return new Response('{"id":"p1","name":"Felix"}', { status: 200 });
    }) as typeof fetch;

    const server = await createServer({ url: oas3Path }, { fetchImpl });
    const client = await connect(server);
    const result = await client.callTool({
      name: "getPetById",
      arguments: { petId: "p1" },
    });
    expect(result.isError).toBeUndefined();
    expect(seen).toEqual(["https://petstore.example/v1/pets/p1"]);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe('{"id":"p1","name":"Felix"}');
  });
});
