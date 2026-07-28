import { describe, expect, it } from "vitest";
import { resolveConfig, createServer } from "../src/index.js";
import type { Api2McpConfig } from "../src/index.js";

describe("scaffold", () => {
  it("exports the public API surface", () => {
    expect(typeof resolveConfig).toBe("function");
    expect(typeof createServer).toBe("function");
  });

  it("createServer stub rejects until implemented", async () => {
    const cfg: Api2McpConfig = { url: "./openapi.json" };
    await expect(createServer(cfg)).rejects.toThrow("not implemented");
  });
});
