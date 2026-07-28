import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(root, "dist", "cli.js");
const oas3Path = join(root, "test", "fixtures", "petstore-oas3.json");

/** Env with all api2mcp variables neutralized so host env can't interfere. */
const cleanEnv = {
  ...process.env,
  OPENAPI_URL: "",
  API_BASE_URL: "",
  API_TIMEOUT: "",
  API_HEADERS: "",
  API_FIXED_PARAMS: "",
  DEBUG: "",
};

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the built CLI. Resolves when the process exits, or — for the
 * long-running server case — when stderr matches `untilStderr` (the process
 * is then killed and code is null).
 */
function runCli(
  args: string[],
  opts: { cwd?: string; untilStderr?: RegExp } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: opts.cwd ?? root,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      if (!done) {
        done = true;
        reject(new Error(`CLI timed out; stderr so far:\n${stderr}`));
      }
    }, 10_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (opts.untilStderr?.test(stderr)) {
        child.kill();
        finish(null);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => finish(code));
  });
}

describe("CLI", () => {
  it("--help prints usage with the documented flags and exits 0", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    for (const flag of [
      "--url",
      "--base-url",
      "--headers",
      "--prefix",
      "--timeout",
      "--fixed-params",
      "--debug",
    ]) {
      expect(stdout).toContain(flag);
    }
    expect(stdout).toMatch(/secrets via environment variables/i);
  });

  it("fails cleanly when no spec is provided anywhere", async () => {
    const emptyCwd = await mkdtemp(join(tmpdir(), "api2mcp-cli-"));
    const { code, stderr } = await runCli([], { cwd: emptyCwd });
    expect(code).toBe(1);
    expect(stderr).toMatch(/no spec provided/);
    expect(stderr).not.toMatch(/at .*\.js/); // clean message, no stack trace
  });

  it("fails cleanly on an unloadable spec", async () => {
    const emptyCwd = await mkdtemp(join(tmpdir(), "api2mcp-cli-"));
    const { code, stderr } = await runCli(["--url", "./does-not-exist.json"], {
      cwd: emptyCwd,
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/failed to load spec/);
  });

  it("rejects a malformed --timeout", async () => {
    const { code, stderr } = await runCli(["--url", oas3Path, "--timeout", "soon"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/--timeout/);
  });

  it("rejects malformed --headers JSON", async () => {
    const { code, stderr } = await runCli(["--url", oas3Path, "--headers", "not-json"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/headers/);
  });

  it("starts serving with --debug, logging redacted config only", async () => {
    const { stderr } = await runCli(
      [
        "--url",
        oas3Path,
        "--debug",
        "--headers",
        '{"Authorization":"Bearer sk-cli-secret"}',
        "--fixed-params",
        "apiKey=sk-cli-fixed",
      ],
      { untilStderr: /serving on stdio/ },
    );
    expect(stderr).toMatch(/resolved config/);
    expect(stderr).toMatch(/registered 4 tools/);
    expect(stderr).toContain("***");
    expect(stderr).not.toContain("sk-cli-secret");
    expect(stderr).not.toContain("sk-cli-fixed");
  });
});
