import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter, Readable } from "node:stream";
import { CliClient } from "../../src/cli/client";
import { CliErrorCode, ProtocolErrorCode } from "../../src/protocol/types";
import { CliError, ProtocolError } from "../../src/protocol/errors";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

function createMockProc() {
  const proc = new EventEmitter() as any;
  const stdout = new EventEmitter() as any;
  stdout.resume = vi.fn();
  stdout.pause = vi.fn();
  const stderr = new EventEmitter() as any;
  stderr.resume = vi.fn();
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), writable: true };
  proc.exitCode = null;
  proc.kill = vi.fn();
  (spawn as any).mockReturnValue(proc);
  return proc;
}

describe("CliClient", () => {
  let client: CliClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new CliClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    try { client.stop(); } catch { /* ignore */ }
  });

  describe("isRunning", () => {
    it("returns false when process is null", () => {
      expect(client.isRunning).toBe(false);
    });

    it("returns true when process is active", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "model1",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "test", version: "1.0" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      expect(client.isRunning).toBe(true);
      proc.emit("close", 0);
    });
  });

  describe("start", () => {
    it("throws AlreadyStarted if process exists", async () => {
      const proc = createMockProc();
      const p1 = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await p1;
      await expect(
        client.start({
          workDir: "/wd",
          model: "m",
          thinking: false,
          yoloMode: false,
          executable: "kimi",
          env: {},
          clientInfo: { name: "t", version: "1" },
        })
      ).rejects.toThrow(CliError);
      proc.emit("close", 0);
    });

    it("throws SpawnFailed when stdio is missing", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = null;
      proc.stderr = null;
      proc.stdin = null;
      proc.kill = vi.fn();
      (spawn as any).mockReturnValue(proc);
      await expect(
        client.start({
          workDir: "/wd",
          model: "m",
          thinking: false,
          yoloMode: false,
          executable: "kimi",
          env: {},
          clientInfo: { name: "t", version: "1" },
        })
      ).rejects.toThrow("Failed to start process pipes");
    });

    it("passes correct arguments to spawn", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "model1",
        thinking: true,
        yoloMode: true,
        sessionId: "sess-1",
        executable: "kimi",
        env: { KEY: "val" },
        clientInfo: { name: "test", version: "1.0" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      const args = (spawn as any).mock.calls[0][1];
      expect(args).toContain("run");
      expect(args).toContain("--jsonrpc");
      expect(args).toContain("--model");
      expect(args).toContain("model1");
      expect(args).toContain("--thinking");
      expect(args).toContain("--yolo");
      expect(args).toContain("--session-id");
      expect(args).toContain("sess-1");
      proc.emit("close", 0);
    });
  });

  describe("stop", () => {
    it("kills process and cleans up", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      client.stop();
      expect(proc.kill).toHaveBeenCalled();
      expect(client.process).toBeNull();
    });

    it("rejects pending requests on stop", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      const reqPromise = client.request("prompt", { content: "hello" });
      client.stop();
      await expect(reqPromise).rejects.toThrow("Session closed");
    });
  });

  describe("request", () => {
    it("throws StdinNotWritable when process is null", async () => {
      await expect(client.request("prompt", {})).rejects.toThrow("Cannot write to CLI");
    });

    it("writes JSON-RPC message to stdin", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      const reqPromise = client.request("prompt", { content: "hi" });
      proc.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":"ok"}\n'));
      const result = await reqPromise;
      expect(result).toBe("ok");
      expect(proc.stdin.write).toHaveBeenCalled();
      const writeCall = proc.stdin.write.mock.calls[0][0];
      expect(writeCall).toContain('"jsonrpc":"2.0"');
      expect(writeCall).toContain('"method":"prompt"');
      proc.emit("close", 0);
    });

    it("rejects on error response", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      const reqPromise = client.request("prompt", {});
      proc.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"bad"}}\n'));
      await expect(reqPromise).rejects.toThrow(ProtocolError);
      proc.emit("close", 0);
    });
  });

  describe("handleLine", () => {
    it("emits parse error for invalid JSON", async () => {
      const proc = createMockProc();
      const events: any[] = [];
      client.pushEvent = (e) => events.push(e);
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      proc.stdout.emit("data", Buffer.from("not json\n"));
      expect(events.some((e) => e.type === "protocol_error")).toBe(true);
      proc.emit("close", 0);
    });

    it("handles server tool call request", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      client.externalToolHandlers.set("test-tool", async () => ({ output: "done" }));
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"jsonrpc":"2.0","id":99,"method":"request","params":{"type":"ToolCallRequest","payload":{"id":"tc1","name":"test-tool","arguments":"{}"}}}\n'
        )
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(proc.stdin.write).toHaveBeenCalled();
      const lastWrite = proc.stdin.write.mock.calls.at(-1)[0];
      expect(lastWrite).toContain('"tool_call_id":"tc1"');
      proc.emit("close", 0);
    });

    it("handles unknown tool call request", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"jsonrpc":"2.0","id":99,"method":"request","params":{"type":"ToolCallRequest","payload":{"id":"tc1","name":"unknown","arguments":"{}"}}}\n'
        )
      );
      await vi.advanceTimersByTimeAsync(10);
      const lastWrite = proc.stdin.write.mock.calls.at(-1)[0];
      expect(lastWrite).toContain('"is_error":true');
      proc.emit("close", 0);
    });

    it("handles hook request with handler", async () => {
      const proc = createMockProc();
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      client.hookHandlers.set("sub1", async () => ({ action: "deny", reason: "no" }));
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"jsonrpc":"2.0","id":99,"method":"request","params":{"type":"HookRequest","payload":{"subscription_id":"sub1"}}}\n'
        )
      );
      await vi.advanceTimersByTimeAsync(10);
      const lastWrite = proc.stdin.write.mock.calls.at(-1)[0];
      expect(lastWrite).toContain('"action":"deny"');
      proc.emit("close", 0);
    });

    it("handles hook request without handler by pushing event", async () => {
      const proc = createMockProc();
      const events: any[] = [];
      client.pushEvent = (e) => events.push(e);
      const startPromise = client.start({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      vi.advanceTimersByTime(600);
      await startPromise;
      proc.stdout.emit(
        "data",
        Buffer.from(
          '{"jsonrpc":"2.0","id":99,"method":"request","params":{"type":"HookRequest","payload":{"subscription_id":"sub2"}}}\n'
        )
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(events.some((e) => e.subscription_id === "sub2")).toBe(true);
      proc.emit("close", 0);
    });
  });
});
