import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { baseUrlFromSpec, listOperations, loadSpec, SpecError } from "../src/openapi.js";
import type { NormalizedOperation } from "../src/openapi.js";
import { mapOperationsToTools } from "../src/tools.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const oas3Path = join(fixturesDir, "petstore-oas3.json");
const swagger2Path = join(fixturesDir, "petstore-swagger2.json");

function schemaFor(tools: ReturnType<typeof mapOperationsToTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  expect(tool, `tool ${name} exists`).toBeDefined();
  return tool!;
}

describe("OpenAPI 3.x fixture", () => {
  it("loads, lists operations, and derives the base URL", async () => {
    const doc = await loadSpec(oas3Path);
    expect(baseUrlFromSpec(doc)).toBe("https://petstore.example/v1");
    const ops = listOperations(doc);
    expect(ops.map((o) => `${o.method} ${o.path}`).sort()).toEqual([
      "delete /pets/{petId}",
      "get /pets",
      "get /pets/{petId}",
      "post /pets",
    ]);
  });

  it("maps operations to tools per the approved scheme", async () => {
    const ops = listOperations(await loadSpec(oas3Path));
    const tools = mapOperationsToTools(ops);

    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPet",
      "delete_pets_petId", // no operationId → synthesized
      "getPetById",
      "listPets",
    ]);

    const list = schemaFor(tools, "listPets");
    expect(list.description).toBe("List all pets");
    expect(Object.keys(list.inputSchema).sort()).toEqual(["limit", "status"]);
    // optional query params accept absence, enum enforced
    expect(z.object(list.inputSchema).safeParse({}).success).toBe(true);
    expect(z.object(list.inputSchema).safeParse({ status: "available" }).success).toBe(true);
    expect(z.object(list.inputSchema).safeParse({ status: "nope" }).success).toBe(false);

    const get = schemaFor(tools, "getPetById");
    expect(get.description).toBe("Fetch one pet by its id"); // falls back to description
    expect(get.params).toEqual([
      { name: "petId", upstreamName: "petId", in: "path", required: true },
    ]);
    expect(z.object(get.inputSchema).safeParse({}).success).toBe(false);
    expect(z.object(get.inputSchema).safeParse({ petId: "p1" }).success).toBe(true);

    const del = schemaFor(tools, "delete_pets_petId");
    expect(del.description).toBe("DELETE /pets/{petId}"); // no summary/description
    expect(del.method).toBe("delete");
    expect(del.pathTemplate).toBe("/pets/{petId}");
  });

  it("flattens an object request body into top-level fields", async () => {
    const ops = listOperations(await loadSpec(oas3Path));
    const create = schemaFor(mapOperationsToTools(ops), "createPet");

    expect(Object.keys(create.inputSchema).sort()).toEqual(["age", "name", "tag"]);
    const parsed = z.object(create.inputSchema);
    expect(parsed.safeParse({ tag: "cat" }).success).toBe(false); // name required
    expect(parsed.safeParse({ name: "Felix", age: 3 }).success).toBe(true);
    expect(create.params).toContainEqual({
      name: "name",
      upstreamName: "name",
      in: "body",
      required: true,
    });
  });

  it("applies --prefix to every tool name", async () => {
    const ops = listOperations(await loadSpec(oas3Path));
    const tools = mapOperationsToTools(ops, { toolPrefix: "pets" });
    expect(tools.map((t) => t.name).sort()).toEqual([
      "pets_createPet",
      "pets_delete_pets_petId",
      "pets_getPetById",
      "pets_listPets",
    ]);
  });

  it("hides fixed params from the input schema", async () => {
    const ops = listOperations(await loadSpec(oas3Path));
    const tools = mapOperationsToTools(ops, { fixedParams: { limit: "10", name: "x" } });

    const list = schemaFor(tools, "listPets");
    expect(Object.keys(list.inputSchema)).toEqual(["status"]);
    expect(list.params.map((p) => p.name)).toEqual(["status"]);

    const create = schemaFor(tools, "createPet");
    expect(Object.keys(create.inputSchema).sort()).toEqual(["age", "tag"]);
  });
});

describe("Swagger 2.x fixture", () => {
  it("derives base URL from schemes/host/basePath", async () => {
    const doc = await loadSpec(swagger2Path);
    expect(baseUrlFromSpec(doc)).toBe("https://petstore2.example/api");
  });

  it("maps operations, including the in:body parameter", async () => {
    const ops = listOperations(await loadSpec(swagger2Path));
    const tools = mapOperationsToTools(ops);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "createPet",
      "getPetById",
      "listPets",
    ]);

    const list = schemaFor(tools, "listPets");
    expect(z.object(list.inputSchema).safeParse({ limit: 5 }).success).toBe(true);
    expect(z.object(list.inputSchema).safeParse({ limit: "five" }).success).toBe(false);

    const create = schemaFor(tools, "createPet");
    expect(Object.keys(create.inputSchema).sort()).toEqual(["name", "tag"]);
    expect(z.object(create.inputSchema).safeParse({ name: "Rex" }).success).toBe(true);
    expect(z.object(create.inputSchema).safeParse({}).success).toBe(false);
  });
});

describe("edge cases", () => {
  const op = (over: Partial<NormalizedOperation>): NormalizedOperation => ({
    method: "get",
    path: "/x",
    params: [],
    ...over,
  });

  it("sanitizes weird names and dedupes collisions", () => {
    const tools = mapOperationsToTools([
      op({ operationId: "get pets!!" }),
      op({ operationId: "get-pets" }),
      op({ operationId: "get_pets" }),
    ]);
    expect(tools.map((t) => t.name)).toEqual(["get_pets", "get-pets", "get_pets_2"]);
  });

  it("truncates names to 64 chars", () => {
    const tools = mapOperationsToTools([op({ operationId: "a".repeat(100) })]);
    expect(tools[0]!.name).toHaveLength(64);
  });

  it("uses a single body field for non-object bodies", () => {
    const tools = mapOperationsToTools([
      op({
        method: "post",
        operationId: "sendList",
        body: { schema: { type: "array", items: { type: "string" } }, required: true },
      }),
    ]);
    const tool = tools[0]!;
    expect(Object.keys(tool.inputSchema)).toEqual(["body"]);
    expect(tool.params).toEqual([
      { name: "body", upstreamName: "body", in: "bodyRoot", required: true },
    ]);
    expect(z.object(tool.inputSchema).safeParse({ body: ["a"] }).success).toBe(true);
    expect(z.object(tool.inputSchema).safeParse({ body: [1] }).success).toBe(false);
  });

  it("renames body fields that collide with params", () => {
    const tools = mapOperationsToTools([
      op({
        method: "post",
        operationId: "collide",
        params: [{ name: "id", in: "query", required: true }],
        body: {
          schema: { type: "object", properties: { id: { type: "string" } } },
          required: true,
        },
      }),
    ]);
    const tool = tools[0]!;
    expect(Object.keys(tool.inputSchema).sort()).toEqual(["body_id", "id"]);
    expect(tool.params).toContainEqual({
      name: "body_id",
      upstreamName: "id",
      in: "body",
      required: false,
    });
  });

  it("throws SpecError for an unloadable spec", async () => {
    await expect(loadSpec(join(fixturesDir, "missing.json"))).rejects.toThrow(SpecError);
  });
});
