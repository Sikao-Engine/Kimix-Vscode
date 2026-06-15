import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ── Module-level mocks ──────────────────────────────────────────────

interface ChildMock {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  /** Emit an event on the internal EventEmitter. */
  emit: (event: string, ...args: unknown[]) => boolean;
  ee: EventEmitter;
}

/** The most recently created "server" child mock (not taskkill). */
let currentServerChild: ChildMock | null = null;

/**
 * Create a mock child process.
 *
 * @param emitExitImmediately If true, emit 'exit' right away on next tick
 *   (used for taskkill spawns so they resolve immediately).
 */
function createChildMock(
  pid = 12345,
  emitExitImmediately = false,
): ChildMock {
  const ee = new EventEmitter();
  const kill = vi.fn(() => {
    setImmediate(() => {
      ee.emit("exit", 0, "SIGTERM");
    });
  });
  const on = vi.fn(
    (event: string, listener: (...args: unknown[]) => void) => {
      ee.on(event, listener);
      return mock;
    },
  );
  const once = vi.fn(
    (event: string, listener: (...args: unknown[]) => void) => {
      ee.once(event, listener);
      return mock;
    },
  );

  const mock: ChildMock = {
    pid,
    kill,
    on,
    once,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    emit: (event: string, ...args: unknown[]) => ee.emit(event, ...args),
    ee,
  };

  // For taskkill spawn, emit 'exit' on next tick so the caller resolves
  if (emitExitImmediately) {
    setImmediate(() => {
      ee.emit("exit", 0, null);
    });
  }

  return mock;
}

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn((cmd: string) => {
      if (cmd === "taskkill") {
        // taskkill spawn: emit exit immediately (PID doesn't exist, process fails fast)
        return createChildMock(99999, true);
      }
      // "Real" server spawn
      const mock = createChildMock(12345, false);
      currentServerChild = mock;
      return mock;
    }),
  };
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ServerProcess", () => {
  let ServerProcess: typeof import("../src/server/serverProcess").ServerProcess;
  let server: InstanceType<typeof ServerProcess>;

  beforeEach(async () => {
    currentServerChild = null;
    const mod = await import("../src/server/serverProcess");
    ServerProcess = mod.ServerProcess;
    server = new ServerProcess({
      executable: "test-server",
      cwd: "/tmp",
      startupTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    currentServerChild = null;
  });

  // ── Constructor and basic properties ─────────────────────────────

  describe("constructor and properties", () => {
    it("initializes with 'stopped' status", () => {
      expect(server.status).toBe("stopped");
      expect(server.isRunning).toBe(false);
      expect(server.lastError).toBeUndefined();
    });
  });

  // ── stop() with a healthy server ─────────────────────────────────

  describe("stop() with a healthy server", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response),
        ),
      );
    });

    it("stop() sets status to 'stopped' and kills child", async () => {
      await server.start();
      expect(currentServerChild).not.toBeNull();
      expect(server.status).toBe("running");

      await server.stop();
      expect(server.status).toBe("stopped");

      // On Unix, the fallback child.kill should have been called
      // since process.kill(-12345, ...) throws ESRCH.
      if (process.platform !== "win32") {
        expect(currentServerChild?.kill).toHaveBeenCalled();
      }
    });

    it("stop() is idempotent — calling twice does not error", async () => {
      await server.start();
      expect(server.status).toBe("running");

      await server.stop();
      expect(server.status).toBe("stopped");

      // Second stop should be a no-op
      await server.stop();
      expect(server.status).toBe("stopped");
    });
  });

  // ── Race condition: exit fires during kill ───────────────────────

  describe("race condition: exit event during kill", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response),
        ),
      );
    });

    it("does not orphan child when exit fires during kill", async () => {
      await server.start();
      expect(currentServerChild).not.toBeNull();
      expect(server.status).toBe("running");

      await server.stop();
      expect(server.status).toBe("stopped");
    });
  });

  // ── Process exit safety net ──────────────────────────────────────

  describe("process exit safety net", () => {
    it("registers process exit handlers on start", async () => {
      const exitSpy = vi
        .spyOn(process, "on")
        .mockImplementation(() => process);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response),
        ),
      );

      await server.start();

      expect(exitSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(exitSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(exitSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(exitSpy).toHaveBeenCalledWith("SIGHUP", expect.any(Function));
    });
  });

  // ── Start failure path ───────────────────────────────────────────

  describe("start failure (health check fails)", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ healthy: false }),
          } as Response),
        ),
      );
    });

    it("throws and kills the child if health check never passes", async () => {
      // Health check loops for ~1s then calls kill().
      await expect(server.start()).rejects.toThrow(
        "server did not become healthy in time",
      );
      expect(server.status).toBe("error");
    });
  });

  // ── Process group fallback ───────────────────────────────────────

  describe("process group fallback", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response),
        ),
      );
    });

    it("falls back to child.kill when process group kill throws ESRCH", async () => {
      await server.start();
      expect(currentServerChild).not.toBeNull();

      // The real process.kill(-12345, ...) throws ESRCH (fake PID),
      // so the fallback this.child.kill('SIGTERM') is used.
      await server.stop();
      expect(server.status).toBe("stopped");

      // On non-Windows, child.kill should have been called as fallback
      if (process.platform !== "win32") {
        expect(currentServerChild?.kill).toHaveBeenCalledWith("SIGTERM");
      }
    });
  });
});
