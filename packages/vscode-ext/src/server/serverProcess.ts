import { ChildProcess, spawn, spawnSync } from "node:child_process";
import * as net from "node:net";
import { Logger } from "../logger";

export type ProcessStatus = "stopped" | "starting" | "running" | "error";

export interface ServerProcessConfig {
  /** Executable name or absolute path, e.g. "opencode". */
  executable: string;
  /** Working directory the server runs in (the workspace root). */
  cwd: string;
  host?: string;
  basePort?: number;
  /** Extra environment variables passed to the child process. */
  env?: Record<string, string>;
  startupTimeoutMs?: number;
}

/**
 * Owns the lifecycle of a single `<executable> serve` child process.
 *
 * One instance per workspace. Picks a free port, spawns the server, polls
 * `/global/health` until ready, and tears the process down on dispose.
 *
 * ## Cleanup guarantees
 *
 * 1. **Explicit** — `stop()` / `kill()` terminates the entire process tree
 *    (process group on Unix, taskkill /t on Windows).
 * 2. **Graceful then forceful** — SIGTERM (or taskkill /f) followed by
 *    SIGKILL after a timeout if the process hasn't exited.
 * 3. **Process-exit safety net** — `process.on('exit')` / SIGTERM / SIGINT /
 *    SIGHUP handlers are registered to clean up if the Node.js process exits
 *    unexpectedly (e.g. VS Code extension host crash).
 * 4. **Race-condition safe** — The `exit` event handler coordinates with
 *    `kill()` via a `_killInProgress` flag so that state isn't corrupted.
 */
export class ServerProcess {
  private child: ChildProcess | undefined;
  private _status: ProcessStatus = "stopped";
  private _port = 0;
  private _lastError: string | undefined;
  private readonly config: Required<Omit<ServerProcessConfig, "env">> & {
    env?: Record<string, string>;
  };

  /** True while a kill / stop is in progress (prevents races with `exit` handler). */
  private _killInProgress = false;

  /** Reference to the process-exit safety-net handler, used for clean-up. */
  private _exitHandler: (() => void) | undefined;

  constructor(config: ServerProcessConfig) {
    this.config = {
      executable: config.executable,
      cwd: config.cwd,
      host: config.host ?? "127.0.0.1",
      basePort: config.basePort ?? 4096,
      startupTimeoutMs: config.startupTimeoutMs ?? 20_000,
      env: config.env,
    };
  }

  get status(): ProcessStatus {
    return this._status;
  }

  get port(): number {
    return this._port;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  get isRunning(): boolean {
    return this._status === "running" && this.child !== undefined;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Start the server (idempotent: returns immediately if already running). */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this._status = "starting";
    this._lastError = undefined;

    this._port = await findFreePort(this.config.host, this.config.basePort);

    const args = [
      "serve",
      "--hostname",
      this.config.host,
      "--port",
      String(this._port),
    ];

    Logger.info(
      `[server] spawning ${this.config.executable} ${args.join(" ")} (cwd=${this.config.cwd})`,
    );

    this.child = spawn(this.config.executable, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      shell: process.platform === "win32",
      windowsHide: true,
      // detached: false (default) — child stays in our process group
    });

    this.child.stdout?.on("data", (d) =>
      Logger.debug(`[server:out] ${String(d).trimEnd()}`),
    );
    this.child.stderr?.on("data", (d) =>
      Logger.debug(`[server:err] ${String(d).trimEnd()}`),
    );

    // ── Exit handler —────────────────────────────────────────────
    // Must coordinate with kill() to avoid race conditions:
    //   - If kill() initiated the exit, we still clear child ref
    //     but don't override status ("stopped" was already set).
    //   - If exit was unexpected (crash), update status to "error".
    this.child.on("exit", (code, signal) => {
      Logger.warn(`[server] exited code=${code} signal=${signal}`);
      if (!this._killInProgress) {
        // Unexpected exit — update state
        this.child = undefined;
        if (this._status !== "stopped") {
          this._status = "error";
          this._lastError = `process exited (code=${code}, signal=${signal})`;
        }
      } else {
        // Kill was intentional — clear ref but keep "stopped" status
        this.child = undefined;
      }
    });

    this.child.on("error", (err) => {
      Logger.error(`[server] spawn error`, String(err));
      this._status = "error";
      this._lastError = String(err);
    });

    // ── Process-exit safety net ──────────────────────────────────
    this.registerProcessExitHandler();

    const ok = await this.waitForHealth();
    if (!ok) {
      this._status = "error";
      this._lastError =
        this._lastError ?? "server did not become healthy in time";
      await this.kill();
      throw new Error(this._lastError);
    }
    this._status = "running";
    Logger.info(`[server] healthy on port ${this._port}`);
  }

  // ── Lifecycle: stop / kill ──────────────────────────────────────

  /** Stop the server process gracefully. */
  async stop(): Promise<void> {
    this._status = "stopped";
    await this.kill();
  }

  /**
   * Terminate the child process (and its entire process tree).
   *
   * - **Unix**: sends SIGTERM to the process group (negative PID), waits up to
   *   3 s for graceful exit, then sends SIGKILL.
   * - **Windows**: runs `taskkill /pid <pid> /t /f` and awaits completion.
   */
  private async kill(): Promise<void> {
    if (!this.child || this._killInProgress) {
      return;
    }
    this._killInProgress = true;

    try {
      if (process.platform === "win32") {
        await this.killWindows();
      } else {
        await this.killUnix();
      }
    } catch (err) {
      Logger.warn(`[server] kill failed`, String(err));
    }

    this.child = undefined;
    this._killInProgress = false;
  }

  /**
   * Windows: run `taskkill /pid <pid> /t /f` and await completion (5 s timeout).
   */
  private async killWindows(): Promise<void> {
    const pid = this.child?.pid;
    if (!pid) {
      return;
    }

    return new Promise<void>((resolve) => {
      const proc = spawn(
        "taskkill",
        ["/pid", String(pid), "/t", "/f"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(); // resolve anyway after timeout — best-effort
      }, 5000);
      proc.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(); // don't reject — best-effort cleanup
      });
    });
  }

  /**
   * Unix: send SIGTERM to the process group, wait up to 3 s, then SIGKILL.
   */
  private async killUnix(): Promise<void> {
    const pid = this.child?.pid;
    if (!pid) {
      return;
    }

    // Send SIGTERM to the entire process group (negative PID).
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Process group may not exist; fall back to direct child kill
      this.child?.kill("SIGTERM");
    }

    // Wait up to 3 s for graceful exit, then force SIGKILL.
    try {
      await this.waitForExit(3000);
    } catch {
      // Graceful timeout — force kill
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        this.child?.kill("SIGKILL");
      }
    }
  }

  /**
   * Wait for the child process to exit (up to `timeoutMs`).
   * Resolves when the child exits. Rejects on timeout.
   */
  private waitForExit(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.child) {
        return resolve();
      }
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ── Process-exit safety net ─────────────────────────────────────

  /**
   * Register handlers so that if the Node.js process exits unexpectedly
   * (VS Code extension host crash, SIGKILL, etc.), we still try to clean up
   * the child process.
   *
   * These handlers are best-effort — on process exit, async operations may
   * not complete, but we try.
   */
  private registerProcessExitHandler(): void {
    // Unregister any previous handler first (idempotent)
    this.unregisterProcessExitHandler();

    const handler = (): void => {
      // Fire-and-forget on process exit — best-effort cleanup
      this.kill();
    };
    process.on("exit", handler);
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
    process.on("SIGHUP", handler);
    this._exitHandler = handler;
  }

  private unregisterProcessExitHandler(): void {
    if (this._exitHandler) {
      process.off("exit", this._exitHandler);
      process.off("SIGTERM", this._exitHandler);
      process.off("SIGINT", this._exitHandler);
      process.off("SIGHUP", this._exitHandler);
      this._exitHandler = undefined;
    }
  }

  // ── Health check ────────────────────────────────────────────────

  private async waitForHealth(): Promise<boolean> {
    const deadline = Date.now() + this.config.startupTimeoutMs;
    const url = `http://${this.config.host}:${this._port}/global/health`;
    while (Date.now() < deadline) {
      if (this._status === "error") {
        return false;
      }
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const data = (await resp.json()) as { healthy?: boolean };
          if (data?.healthy) {
            return true;
          }
        }
      } catch {
        /* not up yet */
      }
      await delay(500);
    }
    return false;
  }
}

/** Find a free TCP port starting from `from`, scanning upward. */
export async function findFreePort(
  host: string,
  from: number,
  avoid?: Set<number>,
): Promise<number> {
  for (let port = from; port < from + 1000; port++) {
    if (avoid?.has(port)) {
      continue;
    }
    if (await isPortFree(host, port)) {
      return port;
    }
  }
  throw new Error(`no free port found from ${from}`);
}

/** Best-effort check that a PID is still alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Try to find the PID listening on a given TCP port (best-effort, cross-platform). */
export async function findPidByPort(
  _host: string,
  port: number,
): Promise<number | undefined> {
  return process.platform === "win32"
    ? findPidByPortWindows(port)
    : findPidByPortUnix(port);
}

function findPidByPortWindows(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const proc = spawn("netstat", ["-ano", "-p", "tcp"], {
      windowsHide: true,
    });
    let stdout = "";
    proc.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(undefined);
    }, 5000);
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    proc.on("exit", () => {
      clearTimeout(timeout);
      const regex = new RegExp(
        `TCP\\s+[^:]+:${port}\\s+.*LISTENING\\s+(\\d+)`,
        "i",
      );
      const match = stdout.match(regex);
      resolve(match ? Number(match[1]) : undefined);
    });
  });
}

function findPidByPortUnix(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const proc = spawn("lsof", ["-iTCP:" + port, "-sTCP:LISTEN", "-t", "-P"], {
      windowsHide: true,
    });
    let stdout = "";
    proc.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(undefined);
    }, 5000);
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    proc.on("exit", () => {
      clearTimeout(timeout);
      const pid = Number(stdout.trim().split(/\s+/)[0]);
      resolve(Number.isFinite(pid) ? pid : undefined);
    });
  });
}

/**
 * Terminate a process tree by PID.
 *
 * - Windows: `taskkill /pid <pid> /t /f`
 * - Unix: SIGTERM to process group, wait up to `gracefulMs`, then SIGKILL.
 */
export async function killProcessTree(
  pid: number,
  options?: { gracefulMs?: number },
): Promise<void> {
  if (process.platform === "win32") {
    return killProcessTreeWindows(pid);
  }
  return killProcessTreeUnix(pid, options?.gracefulMs ?? 3000);
}

function killProcessTreeWindows(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(
      "taskkill",
      ["/pid", String(pid), "/t", "/f"],
      { windowsHide: true, stdio: "ignore" },
    );
    const timeout = setTimeout(() => {
      proc.kill();
      resolve();
    }, 5000);
    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    proc.on("error", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function killProcessTreeUnix(pid: number, gracefulMs: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  try {
    await waitForProcessExit(pid, gracefulMs);
  } catch {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = (): void => {
      try {
        process.kill(pid, 0);
      } catch {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("timeout"));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/** Synchronous process-tree kill for use inside `process.on('exit')` handlers. */
export function killProcessTreeSync(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawnSync(
        "taskkill",
        ["/pid", String(pid), "/t", "/f"],
        { windowsHide: true, stdio: "ignore", timeout: 3000 },
      );
    } catch {
      // best-effort
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // best-effort
    }
  }
}

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
