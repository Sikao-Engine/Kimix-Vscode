import * as vscode from "vscode";
import { KimixConfig, readConfig } from "../config";
import { Logger } from "../logger";
import { OpencodeClient } from "../protocol/client";
import {
  HostToWebview,
  PlanMode,
  ServerInfo,
  UIState,
  WebviewToHost,
} from "../protocol/messages";
import {
  ServerLifecycleManager,
  ServerLifecycleManagerConfig,
  StartResult,
} from "../server/serverManager";
import { SessionManager } from "../session/sessionManager";

type Listener = (msg: HostToWebview) => void;

export interface ServerStatusInfo {
  status: UIState["status"];
  info?: ServerInfo;
  error?: string;
}

/**
 * Central orchestrator: owns the server process, the protocol client and the
 * session manager, and exposes a single `handleMessage` / `onMessage` bridge
 * that any number of webviews (sidebar + tabs) attach to.
 */
export class KimixController implements vscode.Disposable {
  private config: KimixConfig;
  private server: ServerLifecycleManager | undefined;
  private client: OpencodeClient | undefined;
  private sessions: SessionManager | undefined;
  private listeners = new Set<Listener>();

  private planMode: PlanMode = "build";
  private selectedAgent: string | undefined;
  private selectedModel: { providerID: string; modelID: string } | undefined;
  private serverStatus: UIState["status"] = "stopped";
  private serverError: string | undefined;

  private _ensurePromise: Promise<void> | undefined;
  private _onDidChangeServerStatus = new vscode.EventEmitter<ServerStatusInfo>();
  public readonly onDidChangeServerStatus = this._onDidChangeServerStatus.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly pidFilePath: string,
  ) {
    this.config = readConfig();
  }

  // ── Webview bridge ─────────────────────────────────────────────

  onMessage(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private post(msg: HostToWebview): void {
    for (const l of this.listeners) {
      l(msg);
    }
  }

  /** Handle a message coming from any attached webview. */
  async handleMessage(msg: WebviewToHost): Promise<void> {
    try {
      await this.dispatch(msg);
    } catch (err) {
      Logger.error(`[controller] handleMessage ${msg.type}`, String(err));
      this.post({ type: "error", message: String(err) });
    }
  }

  private async dispatch(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.ensureStarted();
        this.pushState();
        break;
      case "startServer":
        await this.startServer();
        break;
      case "stopServer":
        await this.stopServer();
        break;
      case "restartServer":
        await this.restartServer();
        break;
      case "refresh":
        await this.sessions?.refreshSessions();
        this.pushState();
        break;
      case "sendPrompt":
        await this.sessions?.sendPrompt(this.decoratePrompt(msg.text), {
          agent: this.selectedAgent,
          model: this.selectedModel,
        });
        break;
      case "abort":
        await this.sessions?.abort();
        break;
      case "newSession":
        await this.sessions?.newSession();
        this.pushState();
        await this.pushMessages();
        break;
      case "selectSession":
        await this.sessions?.selectSession(msg.sessionId);
        this.pushState();
        await this.pushMessages();
        break;
      case "deleteSession":
        await this.sessions?.deleteSession(msg.sessionId);
        this.pushState();
        await this.pushMessages();
        break;
      case "selectAgent":
        this.selectedAgent = msg.agent;
        this.pushState();
        break;
      case "selectModel":
        this.selectedModel = {
          providerID: msg.providerID,
          modelID: msg.modelID,
        };
        this.pushState();
        break;
      case "setPlanMode":
        this.planMode = msg.mode;
        this.pushState();
        break;
      case "compactContext":
        if (this.selectedModel) {
          await this.sessions?.compact(this.selectedModel);
        }
        break;
      case "respondPermission":
        await this.sessions?.respondPermission(msg.permissionId, msg.reply);
        break;
    }
  }

  // ── Commands (exposed to palette / menus) ──────────────────────

  async newConversation(): Promise<void> {
    await this.ensureStarted();
    await this.sessions?.newSession();
    this.pushState();
    await this.pushMessages();
  }

  togglePlanMode(): void {
    this.planMode = this.planMode === "build" ? "plan" : "build";
    this.pushState();
  }

  async compactContext(): Promise<void> {
    if (this.selectedModel) {
      await this.sessions?.compact(this.selectedModel);
    }
  }

  async restart(): Promise<void> {
    await this.restartServer();
  }

  async startServer(): Promise<void> {
    await this.ensureStarted();
  }

  async stopServer(): Promise<void> {
    await this.server?.stop();
    this.resetAfterStop();
    this.pushState();
  }

  async restartServer(): Promise<void> {
    await this.stopServer();
    await this.ensureStarted();
  }

  onConfigChanged(config: KimixConfig): void {
    this.config = config;
  }

  getServerStatus(): ServerStatusInfo {
    return {
      status: this.serverStatus,
      info: this.server?.info,
      error: this.serverError,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  private ensureStarted(): Promise<void> {
    if (this._ensurePromise) {
      return this._ensurePromise;
    }
    this._ensurePromise = this.doEnsureStarted().finally(() => {
      this._ensurePromise = undefined;
    });
    return this._ensurePromise;
  }

  private async doEnsureStarted(): Promise<void> {
    if (this.server?.status === "running" && this.sessions) {
      return;
    }

    this.serverStatus = "starting";
    this.serverError = undefined;
    this.pushState();

    if (!this.server) {
      const serverConfig: ServerLifecycleManagerConfig = {
        executable: this.config.executable,
        cwd: this.workspaceRoot,
        host: this.config.host,
        basePort: this.config.basePort,
        env: this.config.environmentVariables,
        pidFilePath: this.pidFilePath,
      };
      this.server = new ServerLifecycleManager(serverConfig);
    }

    const result = await this.server.start();

    if (result.kind === "started") {
      await this.afterStart(result.info.port ?? this.config.basePort);
      return;
    }

    if (result.kind === "foreign") {
      const pidText = result.pid ? ` (PID ${result.pid})` : "";
      const choice = await vscode.window.showInformationMessage(
        `An opencode server is already running on port ${result.port}${pidText}.`,
        { modal: false },
        "Reuse",
        "Stop & start new",
        "Start on another port",
      );

      let followUp: StartResult | undefined;

      if (choice === "Reuse") {
        followUp = await this.server.start({ reuseForeign: true });
      } else if (choice === "Stop & start new") {
        followUp = await this.server.start({ killForeign: true });
      } else if (choice === "Start on another port") {
        followUp = await this.server.start({ fallbackToNextPort: true });
      }

      if (followUp?.kind === "started") {
        await this.afterStart(followUp.info.port ?? this.config.basePort);
        return;
      }

      if (followUp?.kind === "error" || followUp?.kind === "foreign") {
        this.serverStatus = "error";
        this.serverError =
          followUp.kind === "error"
            ? followUp.error
            : "existing server is still occupying the port";
        this.pushState();
        return;
      }

      // User dismissed the prompt.
      this.serverStatus = "stopped";
      this.pushState();
      return;
    }

    // error
    this.serverStatus = "error";
    this.serverError = result.error;
    this.pushState();
  }

  private async afterStart(port: number): Promise<void> {
    this.client = new OpencodeClient({
      host: this.config.host,
      port,
      log: (m, d) => Logger.debug(m, d),
    });

    this.sessions = new SessionManager(this.client);
    this.wireSessionEvents(this.sessions);

    await this.loadInitialData();
    this.serverStatus = "running";
    this.pushState();
  }

  private resetAfterStop(): void {
    this.sessions?.dispose();
    this.sessions = undefined;
    this.client = undefined;
    this.serverStatus = "stopped";
    this.serverError = undefined;
  }

  private wireSessionEvents(sm: SessionManager): void {
    sm.on("text", (e) =>
      this.post({
        type: "streamText",
        sessionId: e.sessionId,
        kind: e.kind,
        delta: e.delta,
        full: e.full,
      }),
    );
    sm.on("tool", (e) =>
      this.post({
        type: "streamTool",
        sessionId: e.sessionId,
        toolName: e.toolName,
        status: e.status,
        title: e.title,
        callID: e.callID,
        input: e.input,
      }),
    );
    sm.on("idle", (e) =>
      this.post({ type: "streamIdle", sessionId: e.sessionId }),
    );
    sm.on("permission", (e) =>
      this.post({
        type: "permission",
        sessionId: e.sessionId,
        permissionId: e.permissionId,
        title: e.title,
      }),
    );
    sm.on("sessionsChanged", () => this.pushState());
  }

  private async loadInitialData(): Promise<void> {
    if (!this.client || !this.sessions) {
      return;
    }
    const [agents, providers] = await Promise.all([
      this.client.listAgents().catch(() => []),
      this.client.listProviders().catch(() => []),
    ]);
    this.agents = agents;
    this.providers = providers;

    if (!this.selectedAgent && agents.length > 0) {
      this.selectedAgent = agents[0].name;
    }
    if (!this.selectedModel) {
      const first = providers.find((p) => p.models.length > 0);
      if (first) {
        this.selectedModel = {
          providerID: first.id,
          modelID: first.models[0].id,
        };
      }
    }

    const sessions = await this.sessions.refreshSessions();
    if (sessions.length > 0) {
      await this.sessions.selectSession(sessions[0].id);
      await this.pushMessages();
    }
  }

  private agents: UIState["agents"] = [];
  private providers: UIState["providers"] = [];

  private decoratePrompt(text: string): string {
    if (this.planMode === "plan") {
      return `[Plan Mode: produce a plan, do not edit files]\n\n${text}`;
    }
    return text;
  }

  private async pushMessages(): Promise<void> {
    const id = this.sessions?.currentSessionId;
    if (!id || !this.sessions) {
      return;
    }
    const messages = await this.sessions.getMessages(id);
    this.post({ type: "messages", sessionId: id, messages });
  }

  pushState(): void {
    const state: UIState = {
      status: this.serverStatus,
      serverError: this.serverError,
      serverInfo: this.server?.info,
      sessions: this.sessions?.sessions ?? [],
      currentSessionId: this.sessions?.currentSessionId,
      agents: this.agents,
      providers: this.providers,
      selectedAgent: this.selectedAgent,
      selectedModel: this.selectedModel,
      planMode: this.planMode,
    };
    this.post({ type: "state", state });
    this._onDidChangeServerStatus.fire(this.getServerStatus());
  }

  async dispose(): Promise<void> {
    await this.server?.dispose();
    this.resetAfterStop();
    this.listeners.clear();
    this._onDidChangeServerStatus.dispose();
  }
}
