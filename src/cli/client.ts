import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { CliErrorCode, ProtocolErrorCode } from "../protocol/types";
import { CliError, ProtocolError } from "../protocol/errors";
import { ToolCallRequest, ToolCallResponse, HookRequest, HookResponse } from "./types";
import * as vscode from "vscode";

const debug = require("debug")("kimi-sdk:cli");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export type PushEventFn = (event: unknown) => void;
export type ToolHandler = (args: Record<string, unknown>) => Promise<{ output: string; message?: string }>;
export type HookHandler = (request: HookRequest) => Promise<HookResponse>;

export class CliClient {
  process: ChildProcess | null = null;
  readline: ReturnType<typeof createInterface> | null = null;
  requestId = 0;
  stderrBuffer = "";
  pendingRequests = new Map<number | string, PendingRequest>();
  pushEvent: PushEventFn | null = null;
  finishEvents: (() => void) | null = null;
  externalToolHandlers = new Map<string, ToolHandler>();
  hookHandlers = new Map<string, HookHandler>();

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  async start(options: {
    workDir: string;
    model: string;
    thinking: boolean;
    yoloMode: boolean;
    sessionId?: string;
    executable: string;
    env: Record<string, string>;
    clientInfo: { name: string; version: string };
  }): Promise<void> {
    if (this.process) {
      throw new CliError(CliErrorCode.AlreadyStarted, "A session is already running.");
    }

    const args = ["run", "--jsonrpc"];
    if (options.model) args.push("--model", options.model);
    if (options.thinking) args.push("--thinking");
    if (options.yoloMode) args.push("--yolo");
    if (options.sessionId) args.push("--session-id", options.sessionId);
    args.push("--client-info", JSON.stringify(options.clientInfo));
    args.push(options.workDir);

    debug("Spawning CLI: %s %o", options.executable, args);

    const proc = spawn(options.executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      cwd: options.workDir,
    });

    this.process = proc;

    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      throw new CliError(CliErrorCode.SpawnFailed, "Failed to start process pipes");
    }

    proc.on("error", (err) => {
      debug("Process error: %O", err);
      this.emitError(CliErrorCode.SpawnFailed, `Failed to start CLI: ${err.message}`);
    });

    proc.on("close", (code) => {
      debug("Process exited with code: %d", code);
      if (code !== 0) {
        this.emitError(
          CliErrorCode.ProcessCrashed,
          `CLI exited with code ${code ?? "unknown"}`,
        );
      }
      this.process = null;
      this.readline = null;
      this.finishEvents?.();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderrBuffer += text;
      debug("stderr: %s", text.trim());
    });

    this.readline = createInterface({ input: proc.stdout, terminal: false });
    this.readline.on("line", (line) => this.handleLine(line));

    await this.handshake();
  }

  private async handshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new CliError(CliErrorCode.HandshakeTimeout, "Connection timed out."));
      }, 30000);

      const check = () => {
        if (!this.isRunning) {
          clearTimeout(timeout);
          reject(new CliError(CliErrorCode.ProcessCrashed, "Process crashed during handshake"));
          return;
        }
        // Handshake completes when first line is processed
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 500);
      };
      check();
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.readline?.close();
    this.readline = null;
    for (const req of this.pendingRequests.values()) {
      req.reject(new CliError(CliErrorCode.ProcessCrashed, "Session closed"));
    }
    this.pendingRequests.clear();
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      throw new CliError(CliErrorCode.StdinNotWritable, "Cannot write to CLI");
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.writeLine(message);
    });
  }

  writeLine(line: string): void {
    debug(">>> %s", line.length > 500 ? line.slice(0, 500) + "..." : line);
    this.process?.stdin?.write(line + "\n");
  }

  private handleLine(line: string): void {
    debug("<<< %s", line.length > 500 ? line.slice(0, 500) + "..." : line);
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      this.emitParseError(ProtocolErrorCode.InvalidJson, "Failed to parse JSON", line);
      return;
    }

    const msg = data as { id?: number; method?: string; error?: { code: number; message: string }; result?: unknown; params?: unknown };

    if (msg.id && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        req.reject(
          new ProtocolError(
            ProtocolErrorCode.InternalError,
            msg.error.message,
            JSON.stringify(msg),
          ),
        );
      } else {
        req.resolve(msg.result);
      }
      return;
    }

    if (msg.method) {
      if (msg.method === "request" && msg.id) {
        this.handleServerRequest(msg.id, msg.params as { type: string; payload: unknown });
      } else if (msg.method === "event") {
        this.handleNotification(msg.method, msg.params);
      }
    }
  }

  private handleNotification(_method: string, params: unknown): void {
    const event = params as { type?: string; payload?: unknown } | undefined;
    if (!event?.type) {
      this.emitParseError(ProtocolErrorCode.SchemaMismatch, "Event missing type");
      return;
    }
    this.pushEvent?.(event);
  }

  private async handleServerRequest(id: number, params: { type?: string; payload?: unknown }): Promise<void> {
    if (!params?.type) {
      this.emitParseError(ProtocolErrorCode.SchemaMismatch, "Request missing type");
      return;
    }

    if (params.type === "ToolCallRequest") {
      await this.handleToolCallRequest(id, params.payload as ToolCallRequest);
      return;
    }

    if (params.type === "HookRequest") {
      await this.handleHookRequest(id, params.payload as HookRequest);
      return;
    }

    this.pushEvent?.(params);
  }

  private async handleToolCallRequest(id: number, request: ToolCallRequest): Promise<void> {
    const handler = this.externalToolHandlers.get(request.name);
    let result: ToolCallResponse["return_value"];

    if (!handler) {
      result = {
        is_error: true,
        output: `Unknown external tool: ${request.name}`,
        message: `Tool "${request.name}" is not registered`,
        display: [],
      };
    } else {
      try {
        const args = request.arguments ? JSON.parse(request.arguments) : {};
        const res = await handler(args);
        result = {
          is_error: false,
          output: res.output,
          message: res.message ?? "",
          display: [],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          is_error: true,
          output: message,
          message: `Tool execution failed: ${message}`,
          display: [],
        };
      }
    }

    this.writeLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: { tool_call_id: request.id, return_value: result },
      }),
    );
  }

  private async handleHookRequest(id: number, request: HookRequest): Promise<void> {
    let action: "allow" | "deny" = "allow";
    let reason = "";
    const handler = this.hookHandlers.get(request.subscription_id);

    if (handler) {
      try {
        const res = await handler(request);
        action = res.action;
        reason = res.reason ?? "";
      } catch (err) {
        debug("Hook handler error for subscription %s: %O", request.subscription_id, err);
        action = "allow";
      }
    } else {
      this.pushEvent?.(request);
    }

    this.writeLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: { action, reason },
      }),
    );
  }

  private emitParseError(code: ProtocolErrorCode, message: string, raw?: string): void {
    debug("Parse error [%s]: %s", code, message);
    this.pushEvent?.({ type: "protocol_error", code, message, raw });
  }

  private emitError(code: CliErrorCode, message: string): void {
    debug("CLI error [%s]: %s", code, message);
    this.pushEvent?.({ type: "cli_error", code, message });
  }
}
