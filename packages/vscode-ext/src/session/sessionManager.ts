import { EventEmitter } from "node:events";
import { Logger } from "../logger";
import { OpencodeClient } from "../protocol/client";
import { ParsedEvent } from "../protocol/sseParser";
import { PermissionReply, Session } from "../protocol/types";

export interface SessionManagerEvents {
  text: (e: {
    sessionId: string;
    kind: "text" | "reasoning";
    delta: string;
    full: string;
  }) => void;
  tool: (e: {
    sessionId: string;
    toolName: string;
    status: string;
    title: string;
    callID: string;
    input: string;
  }) => void;
  idle: (e: { sessionId: string }) => void;
  permission: (e: {
    sessionId: string;
    permissionId: string;
    title: string;
  }) => void;
  sessionsChanged: () => void;
}

/**
 * Drives a single active session's event stream and tracks the session list.
 *
 * Holds at most one live SSE subscription (for the current session). Switching
 * sessions tears down the old stream and starts a new one.
 */
export class SessionManager extends EventEmitter {
  private client: OpencodeClient;
  private _sessions: Session[] = [];
  private _currentSessionId: string | undefined;
  private streamAbort: AbortController | undefined;
  private streamLoop: Promise<void> | undefined;

  constructor(client: OpencodeClient) {
    super();
    this.client = client;
  }

  get clientInstance(): OpencodeClient {
    return this.client;
  }

  get sessions(): Session[] {
    return this._sessions;
  }

  get currentSessionId(): string | undefined {
    return this._currentSessionId;
  }

  async refreshSessions(): Promise<Session[]> {
    this._sessions = await this.client.listSessions();
    this.emit("sessionsChanged");
    return this._sessions;
  }

  async createSession(title?: string): Promise<Session> {
    const session = await this.client.createSession(title);
    this._sessions = [session, ...this._sessions];
    this.emit("sessionsChanged");
    return session;
  }

  async newSession(title?: string): Promise<Session> {
    const session = await this.createSession(title);
    await this.selectSession(session.id);
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.deleteSession(sessionId);
    this._sessions = this._sessions.filter((s) => s.id !== sessionId);
    if (this._currentSessionId === sessionId) {
      this.stopStream();
      this._currentSessionId = this._sessions[0]?.id;
      if (this._currentSessionId) {
        this.startStream(this._currentSessionId);
      }
    }
    this.emit("sessionsChanged");
  }

  /** Switch the active session and (re)start its event stream. */
  async selectSession(sessionId: string): Promise<void> {
    if (this._currentSessionId === sessionId && this.streamLoop) {
      return;
    }
    this.stopStream();
    this._currentSessionId = sessionId;
    this.startStream(sessionId);
  }

  async sendPrompt(
    text: string,
    opts: {
      agent?: string;
      model?: { providerID: string; modelID: string };
    },
  ): Promise<void> {
    let sessionId = this._currentSessionId;
    if (!sessionId) {
      const session = await this.newSession();
      sessionId = session.id;
    }
    await this.client.sendPromptAsync(sessionId, {
      text,
      agent: opts.agent,
      model: opts.model,
    });
  }

  async abort(): Promise<void> {
    if (this._currentSessionId) {
      await this.client.abortSession(this._currentSessionId);
    }
  }

  async compact(model: {
    providerID: string;
    modelID: string;
  }): Promise<boolean> {
    if (!this._currentSessionId) {
      return false;
    }
    return this.client.summarize(
      this._currentSessionId,
      model.providerID,
      model.modelID,
    );
  }

  async respondPermission(
    permissionId: string,
    reply: PermissionReply,
  ): Promise<void> {
    if (this._currentSessionId) {
      await this.client.respondPermission(
        this._currentSessionId,
        permissionId,
        reply,
      );
    }
  }

  getMessages(sessionId: string) {
    return this.client.getMessages(sessionId);
  }

  dispose(): void {
    this.stopStream();
    this.removeAllListeners();
  }

  // ── Streaming ────────────────────────────────────────────────────

  private startStream(sessionId: string): void {
    const controller = new AbortController();
    this.streamAbort = controller;
    this.streamLoop = this.runStream(sessionId, controller.signal).catch(
      (err) => {
        if (!controller.signal.aborted) {
          Logger.error(`[session] stream error`, String(err));
        }
      },
    );
  }

  private stopStream(): void {
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    this.streamLoop = undefined;
  }

  private async runStream(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const e of this.client.streamEvents(sessionId, { signal })) {
      if (signal.aborted) {
        return;
      }
      this.handleEvent(sessionId, e);
    }
  }

  private handleEvent(sessionId: string, e: ParsedEvent): void {
    switch (e.type) {
      case "text":
      case "reasoning":
        this.emit("text", {
          sessionId,
          kind: e.type,
          delta: e.delta || e.text,
          full: e.text,
        });
        break;
      case "tool":
        this.emit("tool", {
          sessionId,
          toolName: e.toolName,
          status: e.toolStatus,
          title: e.toolTitle,
          callID: e.toolCallID,
          input: e.toolInput,
        });
        break;
      case "permission":
        this.emit("permission", {
          sessionId,
          permissionId: e.permissionID,
          title: e.toolTitle,
        });
        break;
      case "session-idle":
        this.emit("idle", { sessionId });
        break;
      default:
        break;
    }
  }
}
