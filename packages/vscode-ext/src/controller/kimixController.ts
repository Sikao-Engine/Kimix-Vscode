import * as vscode from "vscode";
import { KimixConfig, readConfig } from "../config";
import { Logger } from "../logger";
import { PlanManager } from "../plan/planManager";
import { OpencodeClient } from "../protocol/client";
import {
  HostToWebview,
  PlanMode,
  PlanPhase,
  PlanState,
  ServerInfo,
  UIState,
  WebviewToHost,
} from "../protocol/messages";
import type { FeatureInfo, FileListItem, SymbolListItem } from "../protocol/types";
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
  planPhase?: PlanPhase;
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
  private planManager: PlanManager | undefined;
  private listeners = new Set<Listener>();

  private planMode: PlanMode = "build";
  private selectedAgent: string | undefined;
  private selectedModel: { providerID: string; modelID: string } | undefined;
  private serverStatus: UIState["status"] = "stopped";
  private serverError: string | undefined;

  /** Id of the turn currently being streamed; echoed back in SSE events. */
  private currentTurnId: string | undefined;

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
    Logger.raw("[BRIDGE] → webview", msg.type);
    for (const l of this.listeners) {
      l(msg);
    }
  }

  /** Handle a message coming from any attached webview. */
  async handleMessage(msg: WebviewToHost): Promise<void> {
    Logger.raw("[BRIDGE] ← webview", msg.type);
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
      case "sendPrompt": {
        if (this.planMode === "plan" && this.config.planModeEnabled) {
          await this.planManager?.enterPlanning(msg.text, msg.turnId);
        } else {
          this.currentTurnId = msg.turnId;
          await this.sessions?.sendPrompt(this.decoratePrompt(msg.text), {
            agent: this.selectedAgent,
            model: this.selectedModel,
          });
        }
        break;
      }
      case "generatePlan": {
        await this.planManager?.enterPlanning(msg.text, msg.turnId);
        break;
      }
      case "revisePlan": {
        await this.planManager?.revisePlan(msg.feedback, msg.turnId);
        break;
      }
      case "implementPlan": {
        await this.handleImplementPlan();
        break;
      }
      case "discardPlan": {
        await this.planManager?.discardPlan();
        break;
      }
      case "abort": {
        if (
          this.planManager &&
          (this.planManager.getState().phase === "generating" ||
            this.planManager.getState().phase === "revising")
        ) {
          const planTurnId = this.planManager.getCurrentTurnId();
          this.planManager.abortPlanning();
          this.post({
            type: "aborted",
            sessionId: "",
            turnId: planTurnId,
          });
          break;
        }
        const abortedTurnId = this.currentTurnId;
        // Fire the abort request in the background so the UI recovers instantly.
        this.sessions
          ?.abort()
          .catch((err) =>
            Logger.error("[controller] background abort failed", String(err)),
          );
        this.currentTurnId = undefined;
        this.post({
          type: "aborted",
          sessionId: this.sessions?.currentSessionId ?? "",
          turnId: abortedTurnId,
        });
        break;
      }
      case "newSession":
        this.currentTurnId = undefined;
        await this.sessions?.newSession();
        this.pushState();
        await this.pushMessages();
        break;
      case "selectSession":
        this.currentTurnId = undefined;
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
      case "requestFileList":
        await this.handleRequestFileList(msg.query);
        break;
      case "requestWorkspaceSymbols":
        await this.handleRequestWorkspaceSymbols(msg.query);
        break;
      case "openPlanFile":
        await this.openPlanFileInEditor();
        break;
    }
  }

  // ── Workspace mention lookups ──────────────────────────────────

  private async handleRequestFileList(query?: string): Promise<void> {
    if (!this.config.enableMentions) {
      this.post({ type: "fileList", files: [] });
      return;
    }
    const pattern = query ? `**/*${query}*` : "**/*";
    try {
      const uris = await vscode.workspace.findFiles(
        pattern,
        "**/node_modules/**",
        200,
      );
      const files: FileListItem[] = uris
        .map((uri) => {
          const relative = vscode.workspace.asRelativePath(uri, false);
          return { path: relative, label: relative };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      this.post({ type: "fileList", files });
    } catch (err) {
      Logger.error("[controller] file list failed", String(err));
      this.post({ type: "fileList", files: [] });
    }
  }

  private async handleRequestWorkspaceSymbols(query: string): Promise<void> {
    if (!this.config.enableMentions) {
      this.post({ type: "workspaceSymbols", symbols: [] });
      return;
    }
    try {
      const items =
        (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          query,
        )) ?? [];
      const symbols: SymbolListItem[] = items.slice(0, 200).map((item) => ({
        name: item.name,
        path: vscode.workspace.asRelativePath(item.location.uri, false),
        kind: vscode.SymbolKind[item.kind],
        range: item.location.range
          ? {
              start: {
                line: item.location.range.start.line,
                character: item.location.range.start.character,
              },
              end: {
                line: item.location.range.end.line,
                character: item.location.range.end.character,
              },
            }
          : undefined,
      }));
      this.post({ type: "workspaceSymbols", symbols });
    } catch (err) {
      Logger.error("[controller] workspace symbols failed", String(err));
      this.post({ type: "workspaceSymbols", symbols: [] });
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

  async generatePlan(): Promise<void> {
    const text = await vscode.window.showInputBox({
      prompt: "Describe what to plan",
      placeHolder: "e.g. Add a settings page to the webview",
    });
    if (!text) {
      return;
    }
    await this.ensureStarted();
    await this.planManager?.enterPlanning(text);
  }

  async implementPlan(): Promise<void> {
    await this.ensureStarted();
    await this.handleImplementPlan();
  }

  async discardPlan(): Promise<void> {
    await this.planManager?.discardPlan();
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
    if (this.planManager) {
      this.planManager.updateConfig({
        planFilePath: config.planFilePath,
        planAgent: config.planAgent,
        planMaxAttempts: config.planMaxAttempts,
        openPlanFileAfterGeneration: config.openPlanFileAfterGeneration,
      });
    }
  }

  getServerStatus(): ServerStatusInfo {
    return {
      status: this.serverStatus,
      info: this.server?.info,
      error: this.serverError,
      planPhase: this.planManager?.getState().phase,
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
        autoFallbackPort: this.config.autoFallbackPort,
        env: this.config.environmentVariables,
        pidFilePath: this.pidFilePath,
      };
      this.server = new ServerLifecycleManager(serverConfig);
    }

    const result = await this.server.start();

    if (result.kind === "started") {
      const port = result.info.port;
      if (!port) {
        this.serverStatus = "error";
        this.serverError = "server started but reported no port";
        this.pushState();
        return;
      }
      await this.afterStart(port);
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
        const port = followUp.info.port;
        if (!port) {
          this.serverStatus = "error";
          this.serverError = "server started but reported no port";
          this.pushState();
          return;
        }
        await this.afterStart(port);
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
      rawLog: (m, d) => Logger.raw(m, d),
    });

    this.sessions = new SessionManager(this.client);
    this.wireSessionEvents(this.sessions);

    this.planManager = new PlanManager(
      this.workspaceRoot,
      this.sessions,
      {
        planFilePath: this.config.planFilePath,
        planAgent: this.config.planAgent,
        planMaxAttempts: this.config.planMaxAttempts,
        openPlanFileAfterGeneration: this.config.openPlanFileAfterGeneration,
      },
    );
    this.wirePlanEvents(this.planManager);

    await this.loadInitialData();
    this.serverStatus = "running";
    this.pushState();
  }

  private resetAfterStop(): void {
    this.sessions?.dispose();
    this.sessions = undefined;
    this.client = undefined;
    this.features = {};
    this.serverStatus = "stopped";
    this.serverError = undefined;
    this.currentTurnId = undefined;
  }

  private wireSessionEvents(sm: SessionManager): void {
    sm.on("text", (e) =>
      this.post({
        type: "streamText",
        sessionId: e.sessionId,
        turnId: this.currentTurnId,
        kind: e.kind,
        delta: e.delta,
        full: e.full,
      }),
    );
    sm.on("tool", (e) =>
      this.post({
        type: "streamTool",
        sessionId: e.sessionId,
        turnId: this.currentTurnId,
        toolName: e.toolName,
        status: e.status,
        title: e.title,
        callID: e.callID,
        input: e.input,
      }),
    );
    sm.on("idle", (e) => {
      this.post({
        type: "streamIdle",
        sessionId: e.sessionId,
        turnId: this.currentTurnId,
      });
      this.post({
        type: "completion",
        sessionId: e.sessionId,
        turnId: this.currentTurnId,
        status: "success",
      });
    });
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
    this.features = await this.client.listFeatures().catch(() => ({}));
    this.planManager?.setAgents(agents);

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
  private features: Record<string, FeatureInfo> = {};

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
      planState: this.planManager?.getState() ?? idlePlanState(),
      showThinking: this.config.showThinking,
      autoScroll: this.config.autoScroll,
      enableMentions: this.config.enableMentions,
      features: this.features,
    };
    this.post({ type: "state", state });
    this._onDidChangeServerStatus.fire(this.getServerStatus());
  }

  async dispose(): Promise<void> {
    this.planManager?.dispose();
    await this.server?.dispose();
    this.resetAfterStop();
    this.listeners.clear();
    this._onDidChangeServerStatus.dispose();
  }

  // ── Plan mode helpers ────────────────────────────────────────────

  private wirePlanEvents(pm: PlanManager): void {
    pm.on("state", (state) => {
      this.post({ type: "planState", state });
      this._onDidChangeServerStatus.fire(this.getServerStatus());
    });
    pm.on("text", (delta, full, kind, turnId) =>
      this.post({
        type: "streamText",
        sessionId: pm.getState().planFile?.absolutePath ?? "plan",
        turnId,
        kind,
        delta,
        full,
      }),
    );
    pm.on("idle", () => {
      if (this.config.openPlanFileAfterGeneration) {
        this.openPlanFileInEditor().catch((err) =>
          Logger.error("[controller] open plan file failed", String(err)),
        );
      }
    });
    pm.on("error", (message) => this.post({ type: "error", message }));
    pm.on("aborted", (turnId) =>
      this.post({ type: "aborted", sessionId: "", turnId }),
    );
  }

  private async handleImplementPlan(): Promise<void> {
    this.planMode = "build";
    this.pushState();
    await this.planManager?.implementPlan(this.selectedAgent, this.selectedModel);
  }

  private async openPlanFileInEditor(): Promise<void> {
    const abs = this.planManager?.getState().planFile?.absolutePath;
    if (!abs) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(abs);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

function idlePlanState(): PlanState {
  return {
    phase: "idle",
    attempt: 0,
    maxAttempts: 3,
  };
}
