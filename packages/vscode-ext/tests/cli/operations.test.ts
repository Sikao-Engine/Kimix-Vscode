import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { login, logout, mcpAuth, mcpResetAuth, mcpTest, getModels, getMCPServers, addMCPServer } from "../../src/cli/operations";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

function mockSpawn(success = true, stdoutLines: string[] = [], stderr = "", exitCode = 0) {
  const proc = new EventEmitter() as any;
  const stdout = new EventEmitter() as any;
  stdout.resume = vi.fn();
  const stderrEmitter = new EventEmitter() as any;
  stderrEmitter.resume = vi.fn();
  proc.stdout = stdout;
  proc.stderr = stderrEmitter;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();

  (spawn as any).mockReturnValue(proc);

  setTimeout(() => {
    stdoutLines.forEach((line) => stdout.emit("data", Buffer.from(line + "\n")));
    if (stderr) stderrEmitter.emit("data", Buffer.from(stderr));
    if (success) {
      proc.emit("close", exitCode);
    } else {
      proc.emit("error", new Error("spawn error"));
    }
  }, 0);
  return proc;
}

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when CLI exits 0", async () => {
    mockSpawn(true, ['{"type":"verification_url","data":{"verification_url":"http://example.com"}}']);
    const onUrl = vi.fn();
    const result = await login({ executable: "kimi", onUrl });
    expect(result.success).toBe(true);
    expect(onUrl).toHaveBeenCalledWith("http://example.com");
  });

  it("returns failure on error", async () => {
    mockSpawn(false, [], "auth failed");
    const result = await login({ executable: "kimi" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("spawn error");
  });
});

describe("logout", () => {
  it("returns success when CLI exits 0", async () => {
    mockSpawn(true);
    const result = await logout({ executable: "kimi" });
    expect(result.success).toBe(true);
  });

  it("returns failure on error", async () => {
    mockSpawn(false, [], "not logged in");
    const result = await logout({ executable: "kimi" });
    expect(result.success).toBe(false);
  });
});

describe("mcpAuth", () => {
  it("spawns correct command", async () => {
    mockSpawn(true);
    await mcpAuth("server1", { executable: "kimi" });
    expect(spawn).toHaveBeenCalledWith("kimi", ["mcp", "auth", "server1"], expect.any(Object));
  });
});

describe("mcpResetAuth", () => {
  it("spawns correct command", async () => {
    mockSpawn(true);
    await mcpResetAuth("server1", { executable: "kimi" });
    expect(spawn).toHaveBeenCalledWith("kimi", ["mcp", "reset-auth", "server1"], expect.any(Object));
  });
});

describe("mcpTest", () => {
  it("returns success on exit 0", async () => {
    mockSpawn(true, ["ok"]);
    const result = await mcpTest("server1", { executable: "kimi" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("ok");
  });

  it("returns failure on error", async () => {
    mockSpawn(false, [], "failed");
    const result = await mcpTest("server1", { executable: "kimi" });
    expect(result.success).toBe(false);
  });
});

describe("getModels", () => {
  it("returns empty array", () => {
    expect(getModels()).toEqual([]);
  });
});

describe("getMCPServers", () => {
  it("returns empty array", () => {
    expect(getMCPServers()).toEqual([]);
  });
});

describe("addMCPServer", () => {
  it("returns empty array", () => {
    expect(addMCPServer({ name: "x", command: "y" })).toEqual([]);
  });
});
