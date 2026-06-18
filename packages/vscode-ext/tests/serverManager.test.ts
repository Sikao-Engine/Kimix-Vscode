import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ── In-memory file system for PID file tests ───────────────────────────────

interface FsState {
  files: Map<string, string>;
  dirs: Set<string>;
}

const fsState: FsState = {
  files: new Map(),
  dirs: new Set(),
};

function resetFs(): void {
  fsState.files.clear();
  fsState.dirs.clear();
}

vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => fsState.files.has(p)),
  unlinkSync: vi.fn((p: string) => {
    fsState.files.delete(p);
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (p: string) => {
    const data = fsState.files.get(p);
    if (data === undefined) {
      const err = new Error("ENOENT");
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return data;
  }),
  writeFile: vi.fn(async (p: string, data: string) => {
    fsState.files.set(p, data);
  }),
  mkdir: vi.fn(async (p: string) => {
    fsState.dirs.add(typeof p === "string" ? p : String(p));
  }),
  unlink: vi.fn(async (p: string) => {
    fsState.files.delete(p);
  }),
}));

// ── Child-process mock ─────────────────────────────────────────────────────

interface MockChild {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  emit: (event: string, ...args: unknown[]) => boolean;
  _ee: EventEmitter;
}

let nextPid = 10000;
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
let currentServerMock: MockChild | undefined;

function createMockChild(pid: number, exitImmediately = false): MockChild {
  const ee = new EventEmitter();
  const kill = vi.fn((signal?: string | number) => {
    // simulate graceful exit on kill
    setImmediate(() => {
      ee.emit("exit", signal === "SIGKILL" ? 1 : 0, signal ?? "SIGTERM");
    });
  });
  const on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    ee.on(event, listener);
    return mock;
  });
  const once = vi.fn(
    (event: string, listener: (...args: unknown[]) => void) => {
      ee.once(event, listener);
      return mock;
    },
  );
  const mock: MockChild = {
    pid,
    kill,
    on,
    once,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    emit: (event: string, ...args: unknown[]) => ee.emit(event, ...args),
    _ee: ee,
  };
  if (exitImmediately) {
    setImmediate(() => {
      ee.emit("exit", 0, null);
    });
  }
  return mock;
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    if (cmd === "taskkill") {
      return createMockChild(99999, true);
    }
    const mock = createMockChild(nextPid++);
    currentServerMock = mock;
    return mock;
  }),
  spawnSync: vi.fn(),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ServerLifecycleManager", () => {
  let ServerLifecycleManager: typeof import("../src/server/serverManager").ServerLifecycleManager;
  let manager: InstanceType<typeof ServerLifecycleManager>;

  beforeEach(async () => {
    resetFs();
    spawnCalls.length = 0;
    currentServerMock = undefined;
    nextPid = 10000;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // The default free port returned by createManager is 4097; make that
        // healthy while leaving the base port (4096) unoccupied.
        const port = Number(new URL(url).port);
        if (port === 4097) {
          return {
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }),
    );

    const mod = await import("../src/server/serverManager");
    ServerLifecycleManager = mod.ServerLifecycleManager;

    manager = createManager();
  });

  afterEach(async () => {
    await manager.dispose().catch(() => {
      // ignore
    });
    vi.restoreAllMocks();
  });

  function makePortHealthy(...ports: number[]): void {
    const healthyPorts = new Set(ports);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const urlPort = Number(new URL(url).port);
        if (healthyPorts.has(urlPort)) {
          return {
            ok: true,
            json: async () => ({ healthy: true }),
          } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }),
    );
  }

  function createManager(overrides?: {
    autoFallbackPort?: boolean;
    findFreePort?: (host: string, from: number, avoid?: Set<number>) => Promise<number>;
    findPidByPort?: (host: string, port: number) => Promise<number | undefined>;
  }) {
    return new ServerLifecycleManager({
      executable: "test-server",
      cwd: "/tmp",
      host: "127.0.0.1",
      basePort: 4096,
      autoFallbackPort: overrides?.autoFallbackPort ?? true,
      startupTimeoutMs: 500,
      pidFilePath: "/tmp/kimix-server/test.json",
      findFreePort:
        overrides?.findFreePort ??
        (async (_host, from, avoid) => {
          for (let p = from + 1; p < from + 10; p++) {
            if (!avoid?.has(p)) {
              return p;
            }
          }
          throw new Error("no free port");
        }),
      findPidByPort:
        overrides?.findPidByPort ?? (async () => undefined),
    });
  }

  it("spawns a new server and writes a PID file", async () => {
    const result = await manager.start();
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.owned).toBe(true);
    expect(result.info.reused).toBe(false);
    expect(result.info.port).toBe(4097);
    expect(typeof result.info.pid).toBe("number");

    const written = fsState.files.get("/tmp/kimix-server/test.json");
    expect(written).toBeDefined();
    const record = JSON.parse(written!);
    expect(record.port).toBe(4097);
    expect(record.pid).toBe(result.info.pid);
    expect(record.token).toBeDefined();
  });

  it("returns immediately when already running", async () => {
    await manager.start();
    const before = currentServerMock;
    const result = await manager.start();
    expect(result.kind).toBe("started");
    expect(currentServerMock).toBe(before);
  });

  it("automatically falls back to the next free port when base port is occupied", async () => {
    makePortHealthy(4096, 4097);
    const m = createManager({
      findPidByPort: async () => 7777,
    });
    const result = await m.start();
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.port).toBe(4097);
    expect(result.info.owned).toBe(true);
    expect(result.info.reused).toBe(false);
    expect(result.info.basePort).toBe(4096);
  });

  it("returns foreign when autoFallbackPort is disabled", async () => {
    makePortHealthy(4096);
    const m = createManager({
      autoFallbackPort: false,
      findPidByPort: async () => 7777,
    });
    const result = await m.start();
    expect(result.kind).toBe("foreign");
    if (result.kind !== "foreign") {
      return;
    }
    expect(result.port).toBe(4096);
    expect(result.pid).toBe(7777);
  });

  it("reuses a foreign server when asked", async () => {
    makePortHealthy(4096);
    const m = createManager({
      findPidByPort: async () => 7777,
    });
    const result = await m.start({ reuseForeign: true });
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.owned).toBe(false);
    expect(result.info.reused).toBe(true);
    expect(result.info.port).toBe(4096);
    expect(result.info.pid).toBe(7777);

    // Stopping a reused foreign server must not kill it.
    const taskkillBefore = spawnCalls.filter((c) => c.cmd === "taskkill").length;
    await m.stop();
    const taskkillAfter = spawnCalls.filter((c) => c.cmd === "taskkill").length;
    expect(taskkillAfter).toBe(taskkillBefore);
  });

  it("falls back to the next port when asked", async () => {
    makePortHealthy(4096, 4097);
    const m = createManager({
      findPidByPort: async () => 7777,
      findFreePort: async (_host, from, avoid) => {
        for (let p = from; p < from + 10; p++) {
          if (!avoid?.has(p)) {
            return p;
          }
        }
        throw new Error("no free port");
      },
    });
    const result = await m.start({ fallbackToNextPort: true });
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.port).toBe(4097);
    expect(result.info.owned).toBe(true);
  });

  it("picks the next free port when multiple consecutive ports are occupied", async () => {
    makePortHealthy(4096, 4097, 4098);
    const occupied = new Set([4096, 4097]);
    const m = createManager({
      findPidByPort: async () => 7777,
      findFreePort: async (_host, from, avoid) => {
        for (let p = from; p < from + 10; p++) {
          if (!avoid?.has(p) && !occupied.has(p)) {
            return p;
          }
        }
        throw new Error("no free port");
      },
    });
    const result = await m.start();
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.port).toBe(4098);
    expect(result.info.owned).toBe(true);
    expect(result.info.reused).toBe(false);
  });

  it("adopts a previous instance from the PID file", async () => {
    makePortHealthy(4096);
    fsState.files.set(
      "/tmp/kimix-server/test.json",
      JSON.stringify({ pid: 8888, port: 4096, token: "old", startedAt: new Date().toISOString() }),
    );

    // Make the recorded PID look alive.
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number) => {
        if (pid === 8888 && signal === 0) {
          return true;
        }
        const err = new Error("ESRCH");
        (err as NodeJS.ErrnoException).code = "ESRCH";
        throw err;
      });

    const result = await manager.start();
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.reused).toBe(true);
    expect(result.info.owned).toBe(true);
    expect(result.info.pid).toBe(8888);

    killSpy.mockRestore();
  });

  it("stops an owned server and removes the PID file", async () => {
    const started = await manager.start();
    expect(started.kind).toBe("started");
    const pid = started.kind === "started" ? started.info.pid : undefined;
    expect(pid).toBeDefined();

    await manager.stop();
    expect(manager.status).toBe("stopped");
    expect(fsState.files.has("/tmp/kimix-server/test.json")).toBe(false);
  });

  it("clears a stale PID file and spawns fresh", async () => {
    fsState.files.set(
      "/tmp/kimix-server/test.json",
      JSON.stringify({ pid: 8888, port: 4096, token: "old", startedAt: new Date().toISOString() }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH");
      (err as NodeJS.ErrnoException).code = "ESRCH";
      throw err;
    });

    const result = await manager.start();
    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      return;
    }
    expect(result.info.reused).toBe(false);
  });

  it("returns an error when health check fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ healthy: false }),
        } as Response),
      ),
    );

    const result = await manager.start();
    expect(result.kind).toBe("error");
  });
});
