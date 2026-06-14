import { ChildProcess, spawn } from "node:child_process";
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
 */
export class ServerProcess {
  private child: ChildProcess | undefined;
  private _status: ProcessStatus = "stopped";
  private _port = 0;
  private _lastError: string | undefined;
  private readonly config: Required<Omit<ServerProcessConfig, "env">> & {
    env?: Record<string, string>;
  };

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
    });

    this.child.stdout?.on("data", (d) =>
      Logger.debug(`[server:out] ${String(d).trimEnd()}`),
    );
    this.child.stderr?.on("data", (d) =>
      Logger.debug(`[server:err] ${String(d).trimEnd()}`),
    );
    this.child.on("exit", (code, signal) => {
      Logger.warn(`[server] exited code=${code} signal=${signal}`);
      this.child = undefined;
      if (this._status !== "stopped") {
        this._status = "error";
        this._lastError = `process exited (code=${code}, signal=${signal})`;
      }
    });
    this.child.on("error", (err) => {
      Logger.error(`[server] spawn error`, String(err));
      this._status = "error";
      this._lastError = String(err);
    });

    const ok = await this.waitForHealth();
    if (!ok) {
      this._status = "error";
      this._lastError =
        this._lastError ?? "server did not become healthy in time";
      this.kill();
      throw new Error(this._lastError);
    }
    this._status = "running";
    Logger.info(`[server] healthy on port ${this._port}`);
  }

  /** Stop the server process. */
  stop(): void {
    this._status = "stopped";
    this.kill();
  }

  private kill(): void {
    if (!this.child) {
      return;
    }
    try {
      if (process.platform === "win32" && this.child.pid) {
        spawn("taskkill", ["/pid", String(this.child.pid), "/t", "/f"], {
          windowsHide: true,
        });
      } else {
        this.child.kill("SIGTERM");
      }
    } catch (err) {
      Logger.warn(`[server] kill failed`, String(err));
    }
    this.child = undefined;
  }

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
export async function findFreePort(host: string, from: number): Promise<number> {
  for (let port = from; port < from + 200; port++) {
    if (await isPortFree(host, port)) {
      return port;
    }
  }
  throw new Error(`no free port found from ${from}`);
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
