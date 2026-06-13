import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { CliOptions, LoginResult, LogoutResult, ModelInfo, MCPServer } from "./types";

const debug = require("debug")("kimi-sdk:cli");

function runCli(executable: string, args: string[], options: CliOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    debug("Executing: %s %o", executable, args);
    const proc = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    createInterface({ input: proc.stdout!, terminal: false }).on("line", (line) => {
      stdout += line + "\n";
      if (line.trim() && options.onLine) {
        debug("cli stdout: %s", line);
        options.onLine(line);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (text.trim()) debug("cli stderr: %s", text.trim());
    });

    proc.on("error", (err) => {
      debug("Command error: %O", err);
      reject(new Error(`Failed to run CLI: ${err.message}`));
    });

    proc.on("close", (code) => {
      debug("Command exited with code: %d", code);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const msg = stderr.trim() || stdout.trim() || `CLI exited with code ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

export async function mcpAuth(name: string, options?: CliOptions): Promise<void> {
  const executable = options?.executable ?? "kimi";
  debug("Running MCP auth for: %s", name);
  await runCli(executable, ["mcp", "auth", name], options);
}

export async function mcpResetAuth(name: string, options?: CliOptions): Promise<void> {
  const executable = options?.executable ?? "kimi";
  debug("Running MCP reset-auth for: %s", name);
  await runCli(executable, ["mcp", "reset-auth", name], options);
}

export async function mcpTest(name: string, options?: CliOptions): Promise<{ success: boolean; output?: string }> {
  const executable = options?.executable ?? "kimi";
  debug("Running MCP test for: %s", name);
  try {
    const output = await runCli(executable, ["mcp", "test", name], options);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function login(options?: CliOptions & { onUrl?: (url: string) => void }): Promise<LoginResult> {
  const executable = options?.executable ?? "kimi";
  debug("Running login --json");
  try {
    await runCli(executable, ["login", "--json"], {
      ...options,
      onLine: (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "verification_url" && msg.data?.verification_url) {
            options?.onUrl?.(msg.data.verification_url);
          }
        } catch {
          // ignore
        }
        options?.onLine?.(line);
      },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function logout(options?: CliOptions): Promise<LogoutResult> {
  const executable = options?.executable ?? "kimi";
  debug("Running logout");
  try {
    await runCli(executable, ["logout"], options);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getModels(): ModelInfo[] {
  // Would typically call CLI; returning typed signature
  return [];
}

export function getMCPServers(): MCPServer[] {
  // Would read from workspace state
  return [];
}

export function addMCPServer(server: MCPServer): MCPServer[] {
  return [];
}

export function updateMCPServer(server: MCPServer): MCPServer[] {
  return [];
}

export function removeMCPServer(name: string): MCPServer[] {
  return [];
}
