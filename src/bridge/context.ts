import * as vscode from "vscode";
import { FileManager } from "../file/manager";
import { Session, Turn } from "../session/types";
import { WebviewEvent } from "../protocol/types";

export interface BridgeContext {
  webviewId: string;
  workDir: string | null;
  workspaceRoot: string | null;
  workspaceState: vscode.Memento;
  requireWorkDir(): string;
  broadcast(event: WebviewEvent, payload: unknown, webviewId?: string): void;
  fileManager: FileManager;
  reloadWebview(): void;
  showLogs(): void;
  getSession(): Session | undefined;
  getSessionId(): string | null;
  getTurn(): Turn | undefined;
  setTurn(turn: Turn | null): void;
  getOrCreateSession(model: string, thinking: boolean, sessionId?: string): Session;
  closeSession(): Promise<void>;
  saveAllDirty(): Promise<void>;
  setCustomWorkDir(dir: string | null): void;
}
