import * as vscode from "vscode";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Thin wrapper around a VS Code OutputChannel. The extension owns a single
 * shared instance, configured once during activation.
 */
class LoggerImpl {
  private channel: vscode.OutputChannel | undefined;
  private rawChannel: vscode.OutputChannel | undefined;
  private level: LogLevel = "info";

  configure(name: string, level: LogLevel): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(name);
    }
    if (!this.rawChannel) {
      this.rawChannel = vscode.window.createOutputChannel(`${name} — Raw Comm`);
    }
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  show(): void {
    this.channel?.show(true);
  }

  showRaw(): void {
    this.rawChannel?.show(true);
  }

  /** Log raw communication data (HTTP request/response, SSE events, bridge messages). */
  raw(message: string, data?: unknown): void {
    const ts = new Date().toISOString();
    let line = `[${ts}] ${message}`;
    if (data !== undefined) {
      line += " " + safeStringify(data);
    }
    this.rawChannel?.appendLine(line);
  }

  debug(message: string, data?: unknown): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("error", message, data);
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (data !== undefined) {
      line += " " + safeStringify(data);
    }
    this.channel?.appendLine(line);
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const Logger = new LoggerImpl();
