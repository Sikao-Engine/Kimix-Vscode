import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "../logger";
import {
  findFreePort,
  findPidByPort,
  isProcessAlive,
  killProcessTree,
  killProcessTreeSync,
  ServerProcess,
} from "./serverProcess";

export type ManagerStatus = "stopped" | "starting" | "running" | "error" | "stopping";

export interface ServerInfo {
  port?: number;
  pid?: number;
  owned: boolean;
  reused: boolean;
  basePort?: number;
}

export type StartResult =
  | { kind: "started"; info: ServerInfo }
  | { kind: "foreign"; port: number; pid?: number }
  | { kind: "error"; error: string };

export interface ServerLifecycleManagerConfig {
  /** Executable name or absolute path, e.g. "opencode". */
  executable: string;
  /** Working directory the server runs in. */
  cwd: string;
  host?: string;
  basePort?: number;
  /** Extra environment variables passed to the child process. */
  env?: Record<string, string>;
  startupTimeoutMs?: number;
  /** Absolute path to the JSON PID/state file. */
  pidFilePath: string;
  /** When true (default), silently fall back to the next free port if the base port is occupied by a foreign process. */
  autoFallbackPort?: boolean;
  /** Optional override for testing. */
  findFreePort?: (host: string, from: number, avoid?: Set<number>) => Promise<number>;
  /** Optional override for testing. */
  findPidByPort?: (host: string, port: number) => Promise<number | undefined>;
}

interface PidFileRecord {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

/**
 * Owns the lifecycle of one opencode-like server per workspace.
 *
 * - Uses a persisted PID file to recover from extension-host crashes.
 * - Probes the configured port before spawning to avoid duplicate servers.
 * - Allows the user to reuse or kill a foreign process.
 * - Guarantees cleanup on explicit stop, dispose and abrupt Node exit.
 */
export class ServerLifecycleManager {
  private readonly config: Required<
      Omit<
        ServerLifecycleManagerConfig,
        "env" | "findFreePort" | "findPidByPort" | "autoFallbackPort"
      >
    > & {
      env?: Record<string, string>;
      autoFallbackPort: boolean;
      findFreePort: (host: string, from: number, avoid?: Set<number>) => Promise<number>;
      findPidByPort: (host: string, port: number) => Promise<number | undefined>;
    };

  private readonly token: string;
  private _status: ManagerStatus = "stopped";
  private _info: ServerInfo = { owned: false, reused: false };
  private _lastError: string | undefined;

  /** Reference to a process we spawned ourselves. */
  private spawnedServer: ServerProcess | undefined;

  /** PID we are currently responsible for (spawned or adopted). */
  private activePid: number | undefined;

  /** Serializes start/stop/restart operations. */
  private _lifecycleLock: Promise<unknown> = Promise.resolve();

  /** Process-exit safety-net handler reference. */
  private _exitHandler: (() => void) | undefined;

  constructor(config: ServerLifecycleManagerConfig) {
    this.config = {
      executable: config.executable,
      cwd: config.cwd,
      host: config.host ?? "127.0.0.1",
      basePort: config.basePort ?? 4096,
      startupTimeoutMs: config.startupTimeoutMs ?? 20_000,
      pidFilePath: config.pidFilePath,
      autoFallbackPort: config.autoFallbackPort ?? true,
      env: config.env,
      findFreePort: config.findFreePort ?? findFreePort,
      findPidByPort: config.findPidByPort ?? findPidByPort,
    };
    this.token = generateToken();
  }

  get status(): ManagerStatus {
    return this._status;
  }

  get info(): ServerInfo {
    return { ...this._info };
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  /**
   * Start or attach to a server.
   *
   * - If the configured port already has a healthy server that we own (via PID
   *   file), adopt it.
   * - If the port has a healthy foreign server, fall back to the next free
   *   port by default (`autoFallbackPort`). Return `foreign` only when fallback
   *   is disabled and no explicit action option is supplied.
   * - Otherwise spawn a new process on a free port.
   */
  start(options?: {
    reuseForeign?: boolean;
    killForeign?: boolean;
    fallbackToNextPort?: boolean;
  }): Promise<StartResult> {
    return this.withLock(() => this._start(options));
  }

  /** Stop the managed server. Foreign (non-owned) servers are detached, not killed. */
  stop(): Promise<void> {
    return this.withLock(() => this._stop());
  }

  /** Stop then start. */
  async restart(options?: {
    reuseForeign?: boolean;
    killForeign?: boolean;
    fallbackToNextPort?: boolean;
  }): Promise<StartResult> {
    await this.stop();
    return this.start(options);
  }

  /** Stop and clear all state. */
  dispose(): Promise<void> {
    return this.stop();
  }

  // ── Core lifecycle ────────────────────────────────────────────────────────

  private async _start(options?: {
    reuseForeign?: boolean;
    killForeign?: boolean;
    fallbackToNextPort?: boolean;
  }): Promise<StartResult> {
    if (this._status === "running" || this._status === "starting") {
      return { kind: "started", info: this.info };
    }

    this._setStatus("starting");
    this._lastError = undefined;

    try {
      // 1. Try to adopt a server we already own from a previous session.
      const record = await this.readPidFile();
      if (record) {
        const alive = isProcessAlive(record.pid);
        const healthy = alive && (await this.isHealthy(record.port));
        if (alive && healthy) {
          Logger.info(
            `[server-manager] adopting previous instance pid=${record.pid} port=${record.port}`,
          );
          this.activePid = record.pid;
    this._info = {
      port: record.port,
      pid: record.pid,
      owned: true,
      reused: true,
      basePort: this.config.basePort,
    };
          await this.writePidFile(record.port, record.pid);
          this._setStatus("running");
          this.registerExitHandler();
          return { kind: "started", info: this.info };
        }
        Logger.info(
          `[server-manager] clearing stale PID file (pid=${record.pid} alive=${alive} healthy=${healthy})`,
        );
        await this.deletePidFile();
      }

      // 2. Probe the configured base port for a foreign process.
      const basePort = this.config.basePort;
      const foreignPid = await this.config.findPidByPort(this.config.host, basePort);
      const foreignHealthy = await this.isHealthy(basePort);

      if (foreignHealthy) {
        if (options?.reuseForeign) {
          Logger.info(
            `[server-manager] reusing foreign server port=${basePort} pid=${foreignPid ?? "unknown"}`,
          );
          this.activePid = foreignPid;
          this._info = {
            port: basePort,
            pid: foreignPid,
            owned: false,
            reused: true,
            basePort: this.config.basePort,
          };
          this._setStatus("running");
          return { kind: "started", info: this.info };
        }

        if (options?.killForeign) {
          if (foreignPid) {
            Logger.info(
              `[server-manager] killing foreign server pid=${foreignPid} port=${basePort}`,
            );
            await killProcessTree(foreignPid);
            await delay(500);
          }
          if (await this.isHealthy(basePort)) {
            const msg = foreignPid
              ? `failed to stop existing server on port ${basePort}`
              : `cannot stop existing server on port ${basePort}: PID unknown`;
            this._setStatus("error", msg);
            return { kind: "error", error: msg };
          }
          // Fall through to spawn on the now-free base port.
        }

        const shouldFallback =
          options?.fallbackToNextPort || this.config.autoFallbackPort;
        if (!shouldFallback) {
          Logger.info(
            `[server-manager] detected foreign server port=${basePort} pid=${foreignPid ?? "unknown"}`,
          );
          return { kind: "foreign", port: basePort, pid: foreignPid };
        }

        Logger.info(
          `[server-manager] base port ${basePort} occupied by pid=${foreignPid ?? "unknown"}; falling back to next free port`,
        );
      }

      // 3. Spawn a new process on a free port.
      const avoidPorts = foreignHealthy ? new Set([basePort]) : undefined;
      const port = await this.config.findFreePort(
        this.config.host,
        basePort,
        avoidPorts,
      );

      const server = new ServerProcess({
        executable: this.config.executable,
        cwd: this.config.cwd,
        host: this.config.host,
        basePort: port,
        env: this.config.env,
        startupTimeoutMs: this.config.startupTimeoutMs,
      });

      try {
        await server.start();
      } catch (err) {
        await server.stop().catch(() => {
          // ignore secondary errors
        });
        const msg = String(err);
        this._setStatus("error", msg);
        return { kind: "error", error: msg };
      }

      const pid = server.pid;
      if (!pid) {
        await server.stop().catch(() => {
          // ignore
        });
        const msg = "spawned server has no PID";
        this._setStatus("error", msg);
        return { kind: "error", error: msg };
      }

      this.spawnedServer = server;
      this.activePid = pid;
      this._info = { port, pid, owned: true, reused: false, basePort: this.config.basePort };
      await this.writePidFile(port, pid);
      this._setStatus("running");
      this.registerExitHandler();

      // If the spawned server exits unexpectedly, move us into error state.
      // ServerProcess already logs the exit; we just react to status changes.
      this.watchSpawnedServer(server);

      Logger.info(`[server-manager] spawned new server pid=${pid} port=${port}`);
      return { kind: "started", info: this.info };
    } catch (err) {
      const msg = String(err);
      this._setStatus("error", msg);
      return { kind: "error", error: msg };
    }
  }

  private async _stop(): Promise<void> {
    if (
      this._status !== "running" &&
      this._status !== "starting" &&
      this._status !== "error"
    ) {
      return;
    }

    const previousStatus = this._status;
    this._setStatus("stopping");

    if (this._info.owned && this.activePid) {
      Logger.info(`[server-manager] stopping owned server pid=${this.activePid}`);
      await killProcessTree(this.activePid);
    }

    // If we spawned it, also let ServerProcess clean up its own listeners.
    if (this.spawnedServer) {
      await this.spawnedServer.stop().catch(() => {
        // ignore secondary errors
      });
      this.spawnedServer = undefined;
    }

    this.activePid = undefined;
    this._info = { owned: false, reused: false };
    await this.deletePidFile();
    this.unregisterExitHandler();
    this._setStatus("stopped");

    // If stop() interrupted a start that had not completed, surface that.
    if (previousStatus === "starting" && this._lastError) {
      this._setStatus("error", this._lastError);
    }
  }

  // ── Health / port helpers ─────────────────────────────────────────────────

  private async isHealthy(port: number): Promise<boolean> {
    try {
      const resp = await fetch(
        `http://${this.config.host}:${port}/global/health`,
      );
      if (!resp.ok) {
        return false;
      }
      const data = (await resp.json()) as { healthy?: boolean };
      return data?.healthy === true;
    } catch {
      return false;
    }
  }

  // ── PID file ──────────────────────────────────────────────────────────────

  private async readPidFile(): Promise<PidFileRecord | undefined> {
    try {
      const raw = await fsp.readFile(this.config.pidFilePath, "utf8");
      const parsed = JSON.parse(raw) as PidFileRecord;
      if (
        parsed &&
        typeof parsed.pid === "number" &&
        typeof parsed.port === "number"
      ) {
        return parsed;
      }
    } catch {
      // missing or corrupt file
    }
    return undefined;
  }

  private async writePidFile(port: number, pid: number): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(this.config.pidFilePath), { recursive: true });
      const record: PidFileRecord = {
        pid,
        port,
        token: this.token,
        startedAt: new Date().toISOString(),
      };
      await fsp.writeFile(
        this.config.pidFilePath,
        JSON.stringify(record, null, 2),
        "utf8",
      );
    } catch (err) {
      Logger.warn(
        `[server-manager] failed to write PID file`,
        String(err),
      );
    }
  }

  private async deletePidFile(): Promise<void> {
    try {
      await fsp.unlink(this.config.pidFilePath);
    } catch {
      // already gone
    }
  }

  // ── Process-exit safety net ───────────────────────────────────────────────

  private registerExitHandler(): void {
    if (this._exitHandler || !this._info.owned || !this.activePid) {
      return;
    }

    const pid = this.activePid;
    const pidFilePath = this.config.pidFilePath;

    const handler = (): void => {
      try {
        fs.unlinkSync(pidFilePath);
      } catch {
        // best-effort
      }
      killProcessTreeSync(pid);
    };

    this.unregisterExitHandler();
    process.on("exit", handler);
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
    process.on("SIGHUP", handler);
    this._exitHandler = handler;
  }

  private unregisterExitHandler(): void {
    if (this._exitHandler) {
      process.off("exit", this._exitHandler);
      process.off("SIGTERM", this._exitHandler);
      process.off("SIGINT", this._exitHandler);
      process.off("SIGHUP", this._exitHandler);
      this._exitHandler = undefined;
    }
  }

  // ── Spawned-server watch ──────────────────────────────────────────────────

  private watchSpawnedServer(server: ServerProcess): void {
    const check = (): void => {
      if (!this.spawnedServer || this.spawnedServer !== server) {
        return;
      }
      if (server.status === "error" && this._status === "running") {
        this._setStatus("error", server.lastError ?? "server process crashed");
      }
      // poll infrequently; exit event is already handled by ServerProcess
      setTimeout(check, 1000);
    };
    check();
  }

  // ── Concurrency ───────────────────────────────────────────────────────────

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._lifecycleLock.then(() => fn());
    this._lifecycleLock = next.catch(() => {
      /* keep the chain alive */
    });
    return next;
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  private _setStatus(status: ManagerStatus, error?: string): void {
    this._status = status;
    if (error !== undefined) {
      this._lastError = error;
    }
    if (status !== "error") {
      this._lastError = undefined;
    }
  }
}

function generateToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
