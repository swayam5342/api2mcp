import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listOperations, loadSpec } from "../src/openapi.js";
import { proxyCall, DEFAULT_TIMEOUT_MS } from "../src/proxy.js";
import type { ProxyContext } from "../src/proxy.js";
import { mapOperationsToTools } from "../src/tools.js";
import type { ToolDefinition } from "../src/tools.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const oas3Path = join(fixturesDir, "petstore-oas3.json");

interface Captured {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Mock fetch that records the request and returns a canned response. */
function mockFetch(response: { status?: number; body?: string } = {}) {
  const calls: Captured[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : String(init.body),
    });
    const body = response.body ?? '{"ok":true}';
    return new Response(body === "" ? null : body, {
      status: response.status ?? 200,
    });
  }) as typeof fetch;
  return { impl, calls };
}

function makeCtx(over: Partial<ProxyContext> = {}): { ctx: ProxyContext; logs: string[] } {
  const logs: string[] = [];
  const ctx: ProxyContext = {
    baseUrl: "https://upstream.example/v1",
    headers: {},
    fixedParams: {},
    timeout: undefined,
    logger: {
      debug: (m) => logs.push(m),
      error: (m) => logs.push(m),
    },
    ...over,
  };
  return { ctx, logs };
}

async function fixtureTool(name: string): Promise<ToolDefinition> {
  const tools = mapOperationsToTools(listOperations(await loadSpec(oas3Path)));
  const tool = tools.find((t) => t.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

const simpleTool = (over: Partial<ToolDefinition>): ToolDefinition => ({
  name: "t",
  description: "",
  method: "get",
  pathTemplate: "/things",
  params: [],
  hiddenParams: [],
  inputSchema: {},
  ...over,
});

describe("request building", () => {
  it("interpolates path params and appends query params", async () => {
    const tool = await fixtureTool("getPetById");
    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl });

    const result = await proxyCall(tool, { petId: "a/b" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(calls[0]!.url.href).toBe("https://upstream.example/v1/pets/a%2Fb");
    expect(calls[0]!.method).toBe("GET");
  });

  it("sends query params and configured headers", async () => {
    const tool = await fixtureTool("listPets");
    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({
      fetchImpl: impl,
      headers: { Authorization: "Bearer sk-secret" },
    });

    await proxyCall(tool, { limit: 5, status: "sold" }, ctx);
    const call = calls[0]!;
    expect(call.url.searchParams.get("limit")).toBe("5");
    expect(call.url.searchParams.get("status")).toBe("sold");
    expect(call.headers.Authorization).toBe("Bearer sk-secret");
  });

  it("assembles the JSON body from flattened fields", async () => {
    const tool = await fixtureTool("createPet");
    const { impl, calls } = mockFetch({ status: 201 });
    const { ctx } = makeCtx({ fetchImpl: impl });

    await proxyCall(tool, { name: "Felix", age: 3 }, ctx);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!)).toEqual({ name: "Felix", age: 3 });
    expect(call.headers["Content-Type"]).toBe("application/json");
  });

  it("maps renamed body fields back to their upstream names", async () => {
    const tool = simpleTool({
      method: "post",
      params: [
        { name: "id", upstreamName: "id", in: "query", required: true },
        { name: "body_id", upstreamName: "id", in: "body", required: false },
      ],
    });
    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl });

    await proxyCall(tool, { id: "q1", body_id: "b1" }, ctx);
    expect(calls[0]!.url.searchParams.get("id")).toBe("q1");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ id: "b1" });
  });

  it("sends a bodyRoot argument as the whole body", async () => {
    const tool = simpleTool({
      method: "put",
      params: [{ name: "body", upstreamName: "body", in: "bodyRoot", required: true }],
    });
    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl });

    await proxyCall(tool, { body: ["a", "b"] }, ctx);
    expect(JSON.parse(calls[0]!.body!)).toEqual(["a", "b"]);
  });

  it("errors on a missing required argument without calling upstream", async () => {
    const tool = await fixtureTool("getPetById");
    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl });

    const result = await proxyCall(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/missing required argument "petId"/);
    expect(calls).toHaveLength(0);
  });
});

describe("fixed params", () => {
  it("injects unknown fixed params as query, invisible to the schema", async () => {
    const tools = mapOperationsToTools(listOperations(await loadSpec(oas3Path)), {
      fixedParams: { apiKey: "sk-fixed" },
    });
    const tool = tools.find((t) => t.name === "listPets")!;
    expect(Object.keys(tool.inputSchema)).not.toContain("apiKey");

    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl, fixedParams: { apiKey: "sk-fixed" } });
    await proxyCall(tool, { status: "sold" }, ctx);
    expect(calls[0]!.url.searchParams.get("apiKey")).toBe("sk-fixed");
  });

  it("injects a fixed param that shadows a spec query param in place", async () => {
    const tools = mapOperationsToTools(listOperations(await loadSpec(oas3Path)), {
      fixedParams: { limit: "10" },
    });
    const tool = tools.find((t) => t.name === "listPets")!;
    expect(Object.keys(tool.inputSchema)).not.toContain("limit");

    const { impl, calls } = mockFetch();
    const { ctx } = makeCtx({ fetchImpl: impl, fixedParams: { limit: "10" } });
    await proxyCall(tool, { status: "sold" }, ctx);
    expect(calls[0]!.url.searchParams.get("limit")).toBe("10");
  });

  it("injects a fixed param declared as a body field into the body", async () => {
    const tools = mapOperationsToTools(listOperations(await loadSpec(oas3Path)), {
      fixedParams: { tag: "internal" },
    });
    const tool = tools.find((t) => t.name === "createPet")!;
    expect(Object.keys(tool.inputSchema)).not.toContain("tag");

    const { impl, calls } = mockFetch({ status: 201 });
    const { ctx } = makeCtx({ fetchImpl: impl, fixedParams: { tag: "internal" } });
    await proxyCall(tool, { name: "Rex" }, ctx);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: "Rex", tag: "internal" });
  });
});

describe("responses and errors", () => {
  it("returns the upstream body as text content", async () => {
    const tool = simpleTool({});
    const { impl } = mockFetch({ body: '{"pets":[]}' });
    const { ctx } = makeCtx({ fetchImpl: impl });

    const result = await proxyCall(tool, {}, ctx);
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe('{"pets":[]}');
  });

  it("notes empty responses instead of returning nothing", async () => {
    const tool = simpleTool({ method: "delete" });
    const { impl } = mockFetch({ status: 204, body: "" });
    const { ctx } = makeCtx({ fetchImpl: impl });

    const result = await proxyCall(tool, {}, ctx);
    expect((result.content[0] as { text: string }).text).toMatch(/empty response, status 204/);
  });

  it("maps non-2xx responses to isError with status and body", async () => {
    const tool = simpleTool({});
    const { impl } = mockFetch({ status: 404, body: '{"error":"nope"}' });
    const { ctx } = makeCtx({ fetchImpl: impl });

    const result = await proxyCall(tool, {}, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/404/);
    expect(text).toMatch(/nope/);
  });

  it("maps network failures to isError", async () => {
    const tool = simpleTool({});
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { ctx } = makeCtx({ fetchImpl: failing });

    const result = await proxyCall(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/fetch failed/);
  });

  it("maps timeouts to isError mentioning the configured timeout", async () => {
    const tool = simpleTool({});
    const timingOut = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
        );
      });
    }) as typeof fetch;
    const { ctx } = makeCtx({ fetchImpl: timingOut, timeout: 50 });

    const result = await proxyCall(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/timed out after 50ms/);
  });

  it("has a default timeout", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });
});

describe("redaction", () => {
  it("redacts header and fixed-param values from logs and error text", async () => {
    const tool = simpleTool({});
    const { impl } = mockFetch({ status: 500, body: "boom sk-fixed leaked" });
    const { ctx, logs } = makeCtx({
      fetchImpl: impl,
      headers: { Authorization: "Bearer sk-header" },
      fixedParams: { apiKey: "sk-fixed" },
    });

    const result = await proxyCall(tool, {}, ctx);

    const allLogs = logs.join("\n");
    expect(allLogs).not.toContain("sk-fixed");
    expect(allLogs).not.toContain("sk-header");
    expect(allLogs).toContain("***"); // the fixed param appears in the logged URL, redacted

    const errText = (result.content[0] as { text: string }).text;
    expect(errText).not.toContain("sk-fixed"); // even upstream echoes get scrubbed
    expect(errText).toContain("***");
  });
});
