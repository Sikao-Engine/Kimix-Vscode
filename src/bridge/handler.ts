import * as vscode from "vscode";
import { BridgeContext } from "./context";
import { FileManager } from "../file/manager";
import { Session, Turn } from "../session/types";
import { SessionManager } from "../session/manager";
import { RpcMethod, WebviewEvent, RpcRequest, RpcResponse } from "../protocol/types";
import { getExtensionConfig } from "../config";
import { handlers } from "./handlers";

export class BridgeHandler {
  private sessions = new Map<string, Session>();
  private turns = new Map<string, Turn>();
  private customWorkDirs = new Map<string, string>();
  private fileManager: FileManager;
  private sessionManager = new SessionManager();

  constructor(
    private broadcast: (event: WebviewEvent, payload: unknown, webviewId?: string) => void,
    private workspaceState: vscode.Memento,
    private reloadWebview: (webviewId: string) => void,
    private showLogs: () => void,
  ) {
    this.fileManager = new FileManager(() => this.workspaceRoot, broadcast);
  }

  get workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  getWorkDir(webviewId: string): string | null {
    return this.customWorkDirs.get(webviewId) ?? this.workspaceRoot;
  }

  setCustomWorkDir(webviewId: string, dir: string | null): void {
    if (dir && dir !== this.workspaceRoot) {
      this.customWorkDirs.set(webviewId, dir);
    } else {
      this.customWorkDirs.delete(webviewId);
    }
    this.sessions.get(webviewId)?.close();
    this.sessions.delete(webviewId);
    this.turns.delete(webviewId);
  }

  requireWorkDir(webviewId: string): string {
    const dir = this.getWorkDir(webviewId);
    if (!dir) throw new Error("No workspace folder open");
    return dir;
  }

  async handle(message: RpcRequest, webviewId: string): Promise<RpcResponse> {
    try {
      const result = await this.dispatch(message.method, message.params, webviewId);
      return { id: message.id, result };
    } catch (err) {
      return {
        id: message.id,
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private async dispatch(method: RpcMethod, params: unknown, webviewId: string): Promise<unknown> {
    const handler = handlers[method];
    if (!handler) throw new Error(`Unknown method: ${method}`);
    return handler(params, this.createContext(webviewId));
  }

  private createContext(webviewId: string): BridgeContext {
    return {
      webviewId,
      workDir: this.getWorkDir(webviewId),
      workspaceRoot: this.workspaceRoot,
      workspaceState: this.workspaceState,
      requireWorkDir: () => this.requireWorkDir(webviewId),
      broadcast: this.broadcast,
      fileManager: this.fileManager,
      reloadWebview: () => this.reloadWebview(webviewId),
      showLogs: this.showLogs,
      getSession: () => this.sessions.get(webviewId),
      getSessionId: () => this.fileManager.getSessionId(webviewId),
      getTurn: () => this.turns.get(webviewId),
      setTurn: (turn) => {
        if (turn) this.turns.set(webviewId, turn);
        else this.turns.delete(webviewId);
      },
      getOrCreateSession: (model, thinking, sessionId) =>
        this.getOrCreateSession(webviewId, model, thinking, sessionId),
      closeSession: async () => {
        const session = this.sessions.get(webviewId);
        if (session) {
          session.close();
          this.sessions.delete(webviewId);
        }
        this.turns.delete(webviewId);
      },
      saveAllDirty: () => this.saveAllDirty(),
      setCustomWorkDir: (dir) => this.setCustomWorkDir(webviewId, dir),
    };
  }

  private async saveAllDirty(): Promise<void> {
    const docs = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
    await Promise.all(docs.map((d) => d.save()));
  }

  private getOrCreateSession(
    webviewId: string,
    model: string,
    thinking: boolean,
    sessionId?: string,
  ): Session {
    const workDir = this.requireWorkDir(webviewId);
    // Simplified; would check executable, env, yoloMode changes
    const existing = this.sessions.get(webviewId);
    if (existing) return existing;

    const config = getExtensionConfig();
    const session = this.sessionManager.createSession({
      workDir,
      model,
      thinking,
      yoloMode: config.yoloMode,
      sessionId,
      executable: "kimi",
      env: config.environmentVariables,
      clientInfo: {
        name: "kimi-code-for-vs-code",
        version: config.version,
      },
    });

    this.sessions.set(webviewId, session);
    this.fileManager.setSessionId(webviewId, session.sessionId);
    return session;
  }

  disposeView(webviewId: string): void {
    this.sessions.get(webviewId)?.close();
    this.sessions.delete(webviewId);
    this.turns.delete(webviewId);
    this.fileManager.disposeView(webviewId);
  }

  async dispose(): Promise<void> {
    this.fileManager.dispose();
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    this.turns.clear();
  }
}
