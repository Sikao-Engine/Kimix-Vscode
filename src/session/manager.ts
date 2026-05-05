import * as path from "node:path";
import * as fs from "node:fs";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { SessionOptions, Session, Turn, SessionInfo, ForkOptions, ForkResult, HistoryEntry } from "./types";
import { CliClient } from "../cli/client";
import { StreamEvent, TurnResult } from "../protocol/types";

const debug = require("debug")("kimi-sdk:session");

export class SessionManager {
  createSession(options: SessionOptions): Session {
    const client = new CliClient();
    const sessionId = options.sessionId ?? randomUUID();

    const session: Session = {
      sessionId,
      model: options.model,
      thinking: options.thinking,
      yoloMode: options.yoloMode,
      executable: options.executable,
      env: options.env,
      prompt(content: unknown): Turn {
        const turnEvents: StreamEvent[] = [];
        let resolveTurn: ((value: TurnResult) => void) | null = null;
        let rejectTurn: ((reason: Error) => void) | null = null;
        let done = false;
        let interrupted = false;

        client.pushEvent = (event) => {
          turnEvents.push(event as StreamEvent);
        };

        const resultPromise = new Promise<TurnResult>((resolve, reject) => {
          resolveTurn = resolve;
          rejectTurn = reject;
        });

        // Start CLI and send prompt
        client
          .start({ ...options, sessionId })
          .then(async () => {
            try {
              const result = await client.request("prompt", { content });
              done = true;
              resolveTurn?.({ status: "finished", output: JSON.stringify(result) });
            } catch (err) {
              done = true;
              rejectTurn?.(err instanceof Error ? err : new Error(String(err)));
            }
          })
          .catch((err) => {
            done = true;
            rejectTurn?.(err instanceof Error ? err : new Error(String(err)));
          });

        return {
          get result() {
            return resultPromise;
          },
          resolveResult: resolveTurn!,
          rejectResult: rejectTurn!,
          get interrupted() {
            return interrupted;
          },
          interrupt() {
            interrupted = true;
            client.stop();
          },
          async *[Symbol.asyncIterator]() {
            let index = 0;
            while (true) {
              if (index < turnEvents.length) {
                yield turnEvents[index++];
              } else if (done) {
                return;
              } else {
                await new Promise<void>((resolve) => {
                  const check = () => {
                    if (index < turnEvents.length || done) {
                      resolve();
                    } else {
                      setTimeout(check, 50);
                    }
                  };
                  check();
                });
              }
            }
          },
        };
      },
      close() {
        client.stop();
      },
    };

    return session;
  }

  async forkSession(options: ForkOptions): Promise<ForkResult | null> {
    const { workDir, sourceSessionId, turnIndex } = options;
    const sourceDir = path.join(workDir, ".kimi", "sessions", sourceSessionId);
    const wirePath = path.join(sourceDir, "wire.jsonl");
    const contextPath = path.join(sourceDir, "context.jsonl");

    try {
      await fs.promises.access(wirePath);
    } catch {
      throw new Error(`Source session not found: ${sourceSessionId}`);
    }

    const newSessionId = randomUUID();
    const newDir = path.join(workDir, ".kimi", "sessions", newSessionId);
    await fs.promises.mkdir(newDir, { recursive: true });

    const wireLines = await this.readTurns(wirePath, turnIndex);
    if (wireLines.length === 0) {
      await fs.promises.rm(newDir, { recursive: true, force: true });
      throw new Error(`Turn ${turnIndex} not found in session`);
    }

    await fs.promises.writeFile(path.join(newDir, "wire.jsonl"), wireLines.join("\n") + "\n");

    try {
      const contextLines = await this.readContext(contextPath, turnIndex);
      if (contextLines.length > 0) {
        await fs.promises.writeFile(
          path.join(newDir, "context.jsonl"),
          contextLines.join("\n") + "\n",
        );
      }
    } catch {
      // ignore
    }

    debug("Forked session %s -> %s at turn %d", sourceSessionId, newSessionId, turnIndex);
    return { sessionId: newSessionId, sessionDir: newDir };
  }

  private async readTurns(filePath: string, turnIndex: number): Promise<string[]> {
    const lines: string[] = [];
    let turn = -1;
    let lastCompleteIndex = -1;

    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const type = msg.message?.type;
        if (type === "TurnBegin") {
          if (turn > turnIndex) break;
          turn++;
        }
        lines.push(line);
        if (type === "TurnEnd" && turn === turnIndex) {
          lastCompleteIndex = lines.length;
        }
      } catch {
        if (turn >= 0 && turn <= turnIndex) lines.push(line);
      }
    }

    if (lastCompleteIndex > 0) {
      return lines.slice(0, lastCompleteIndex);
    }

    // Fallback to last complete turn
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        if (JSON.parse(lines[i]).message?.type === "TurnEnd") {
          debug("Target turn incomplete, truncating to last complete turn");
          return lines.slice(0, i + 1);
        }
      } catch {
        continue;
      }
    }

    debug("No complete turn found in session");
    return [];
  }

  private async readContext(filePath: string, turnIndex: number): Promise<string[]> {
    const lines: string[] = [];
    let userTurn = -1;

    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const role = msg.role;
        if (role === "_checkpoint" || role === "_usage") {
          lines.push(line);
          continue;
        }
        if (role === "user") {
          if (userTurn > turnIndex) break;
          userTurn++;
        } else if (role === "assistant" && userTurn > turnIndex + 1) {
          break;
        }
        lines.push(line);
      } catch {
        lines.push(line);
      }
    }

    return this.pruneIncompleteToolCalls(lines);
  }

  private pruneIncompleteToolCalls(lines: string[]): string[] {
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();
    const assistantIndices: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const msg = JSON.parse(lines[i]);
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (tc.id) toolCallIds.add(tc.id);
          }
          if (msg.tool_calls.length > 0) assistantIndices.push(i);
        } else if (msg.role === "tool" && msg.tool_call_id) {
          toolResultIds.add(msg.tool_call_id);
        }
      } catch {
        continue;
      }
    }

    const hasIncomplete = [...toolCallIds].some((id) => !toolResultIds.has(id));
    if (!hasIncomplete) return lines;

    for (let i = assistantIndices.length - 1; i >= 0; i--) {
      const idx = assistantIndices[i];
      try {
        const msg = JSON.parse(lines[idx]);
        const ids = (msg.tool_calls || []).map((tc: { id?: string }) => tc.id).filter(Boolean);
        if (ids.some((id: string) => !toolResultIds.has(id))) {
          debug("Removing incomplete assistant message at index %d", idx);
          const before = lines.slice(0, idx);
          const after = lines.slice(idx + 1).filter((l) => {
            try {
              const m = JSON.parse(l);
              return m.role === "_checkpoint" || m.role === "_usage";
            } catch {
              return false;
            }
          });
          return [...before, ...after];
        }
      } catch {
        continue;
      }
    }

    return lines;
  }

  async loadSessionHistory(workDir: string, sessionId: string): Promise<HistoryEntry[]> {
    const sessionDir = path.join(workDir, ".kimi", "sessions", sessionId);
    const wirePath = path.join(sessionDir, "wire.jsonl");
    const entries: HistoryEntry[] = [];

    try {
      const content = await fs.promises.readFile(wirePath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.message?.type === "TextChunk") {
            entries.push({ role: "assistant", content: msg.message.payload?.text });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    return entries;
  }

  async deleteSession(workDir: string, sessionId: string): Promise<boolean> {
    const sessionDir = path.join(workDir, ".kimi", "sessions", sessionId);
    try {
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async getSessions(workDir: string): Promise<SessionInfo[]> {
    const sessionsDir = path.join(workDir, ".kimi", "sessions");
    try {
      const dirs = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
      return dirs
        .filter((d) => d.isDirectory())
        .map((d) => ({
          sessionId: d.name,
          createdAt: new Date().toISOString(),
          model: "unknown",
        }));
    } catch {
      return [];
    }
  }

  async getAllSessions(workspaceRoot: string): Promise<SessionInfo[]> {
    return this.getSessions(workspaceRoot);
  }

  async getRegisteredWorkDirs(workspaceRoot: string): Promise<string[]> {
    const workDirsPath = path.join(workspaceRoot, ".kimi", "workdirs.json");
    try {
      return JSON.parse(await fs.promises.readFile(workDirsPath, "utf-8"));
    } catch {
      return [];
    }
  }
}
