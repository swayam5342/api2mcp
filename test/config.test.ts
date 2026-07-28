import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  parseFixedParams,
  parseHeaders,
  redactConfig,
  resolveConfig,
} from "../src/config.js";

/** Fresh empty dir so no real config file leaks into tests. */
async function emptyDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "api2mcp-test-"));
}

async function dirWithConfig(name: string, content: unknown): Promise<string> {
  const dir = await emptyDir();
  await writeFile(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content),
  );
  return dir;
}

const noEnv = {};

describe("parseHeaders", () => {
  it("parses a JSON object", () => {
    expect(parseHeaders('{"Authorization":"Bearer x","X-N":1}')).toEqual({
      Authorization: "Bearer x",
      "X-N": "1",
    });
  });

  it("rejects invalid JSON and non-objects", () => {
    expect(() => parseHeaders("not json")).toThrow(ConfigError);
    expect(() => parseHeaders('["a"]')).toThrow(ConfigError);
    expect(() => parseHeaders('{"a":{"nested":1}}')).toThrow(ConfigError);
  });
});

describe("parseFixedParams", () => {
  it("parses key=value", () => {
    expect(parseFixedParams("apiKey=secret123")).toEqual({ apiKey: "secret123" });
  });

  it("parses multiple comma-separated pairs", () => {
    expect(parseFixedParams("a=1, b=2")).toEqual({ a: "1", b: "2" });
  });

  it("keeps = inside values (splits on first =)", () => {
    expect(parseFixedParams("token=abc=def")).toEqual({ token: "abc=def" });
  });

  it("parses JSON form, coercing numbers", () => {
    expect(parseFixedParams('{"key":"v","n":42}')).toEqual({ key: "v", n: "42" });
  });

  it("rejects empty and malformed input", () => {
    expect(() => parseFixedParams("")).toThrow(ConfigError);
    expect(() => parseFixedParams("novalue")).toThrow(ConfigError);
    expect(() => parseFixedParams("=x")).toThrow(ConfigError);
  });
});

describe("resolveConfig precedence", () => {
  it("uses the config file alone", async () => {
    const cwd = await dirWithConfig("api2mcp.json", {
      url: "https://file.example/spec.json",
      baseUrl: "https://file.example",
      timeout: 1000,
    });
    const cfg = await resolveConfig({}, { cwd, env: noEnv });
    expect(cfg).toEqual({
      url: "https://file.example/spec.json",
      baseUrl: "https://file.example",
      timeout: 1000,
    });
  });

  it("env overrides file, per field", async () => {
    const cwd = await dirWithConfig("api2mcp.json", {
      url: "https://file.example/spec.json",
      baseUrl: "https://file.example",
    });
    const cfg = await resolveConfig(
      {},
      { cwd, env: { API_BASE_URL: "https://env.example", API_TIMEOUT: "2000" } },
    );
    expect(cfg.url).toBe("https://file.example/spec.json");
    expect(cfg.baseUrl).toBe("https://env.example");
    expect(cfg.timeout).toBe(2000);
  });

  it("CLI overrides env and file", async () => {
    const cwd = await dirWithConfig("api2mcp.json", {
      url: "https://file.example/spec.json",
    });
    const cfg = await resolveConfig(
      { url: "https://cli.example/spec.json", baseUrl: "https://cli.example" },
      { cwd, env: { OPENAPI_URL: "https://env.example/spec.json" } },
    );
    expect(cfg.url).toBe("https://cli.example/spec.json");
    expect(cfg.baseUrl).toBe("https://cli.example");
  });

  it("checks all three config file names in order", async () => {
    const cwd = await dirWithConfig(".api2mcp.json", { url: "https://dot.example/s.json" });
    const cfg = await resolveConfig({}, { cwd, env: noEnv });
    expect(cfg.url).toBe("https://dot.example/s.json");
  });

  it("errors when no url from any source", async () => {
    const cwd = await emptyDir();
    await expect(resolveConfig({}, { cwd, env: noEnv })).rejects.toThrow(
      /no spec provided/,
    );
  });
});

describe("resolveConfig env parsing", () => {
  it("parses API_HEADERS, API_FIXED_PARAMS, DEBUG", async () => {
    const cwd = await emptyDir();
    const cfg = await resolveConfig(
      {},
      {
        cwd,
        env: {
          OPENAPI_URL: "https://env.example/spec.json",
          API_HEADERS: '{"Authorization":"Bearer t"}',
          API_FIXED_PARAMS: "appKey=k1",
          DEBUG: "true",
        },
      },
    );
    expect(cfg.headers).toEqual({ Authorization: "Bearer t" });
    expect(cfg.fixedParams).toEqual({ appKey: "k1" });
    expect(cfg.debug).toBe(true);
  });

  it("treats DEBUG=0/false as off", async () => {
    const cwd = await emptyDir();
    for (const v of ["0", "false", "off", ""]) {
      const cfg = await resolveConfig(
        { url: "x" },
        { cwd, env: { DEBUG: v } },
      );
      expect(cfg.debug, `DEBUG=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("rejects a bad API_TIMEOUT", async () => {
    const cwd = await emptyDir();
    await expect(
      resolveConfig({ url: "x" }, { cwd, env: { API_TIMEOUT: "soon" } }),
    ).rejects.toThrow(/API_TIMEOUT/);
  });
});

describe("config file validation", () => {
  it("rejects invalid JSON", async () => {
    const cwd = await dirWithConfig("api2mcp.json", "{not json");
    await expect(resolveConfig({}, { cwd, env: noEnv })).rejects.toThrow(/invalid JSON/);
  });

  it("rejects unknown keys, with a hint for prior-art openapiUrl", async () => {
    const cwd = await dirWithConfig("api2mcp.json", {
      openapiUrl: "https://x.example/spec.json",
    });
    await expect(resolveConfig({}, { cwd, env: noEnv })).rejects.toThrow(
      /"url", not "openapiUrl"/,
    );
  });
});

describe("redactConfig", () => {
  it("replaces all header and fixed-param values, leaves the rest", () => {
    const redacted = redactConfig({
      url: "https://api.example/spec.json",
      baseUrl: "https://api.example",
      headers: { Authorization: "Bearer secret", "X-Plain": "also-hidden" },
      fixedParams: { apiKey: "sk-123" },
      toolPrefix: "pets",
    });
    expect(redacted.headers).toEqual({ Authorization: "***", "X-Plain": "***" });
    expect(redacted.fixedParams).toEqual({ apiKey: "***" });
    expect(redacted.url).toBe("https://api.example/spec.json");
    expect(redacted.toolPrefix).toBe("pets");
  });

  it("does not mutate the original", () => {
    const original = { url: "u", headers: { a: "secret" } };
    redactConfig(original);
    expect(original.headers.a).toBe("secret");
  });
});
