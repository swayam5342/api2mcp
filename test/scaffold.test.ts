import { describe, expect, it } from "vitest";
import { resolveConfig, createServer } from "../src/index.js";

describe("public API surface", () => {
  it("exports resolveConfig and createServer", () => {
    expect(typeof resolveConfig).toBe("function");
    expect(typeof createServer).toBe("function");
  });
});
