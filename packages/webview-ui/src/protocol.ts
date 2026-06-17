/**
 * Webview-side mirror of the host/webview message contract.
 * Kept self-contained so the UI bundle has no Node dependencies.
 * Must stay in sync with vscode-ext/src/protocol/messages.ts.
 */

export type PlanMode = "build" | "plan";

export type PlanPhase =
  | "idle"
  | "generating"
  | "reviewing"
  | "revising"
  | "implementing";

export interface PlanFileInfo {
  path: string;
  absolutePath: string;
  exists: boolean;
}

export interface PlanState {
  phase: PlanPhase;
  planFile?: PlanFileInfo;
  requirement?: string;
  revisionPrompt?: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
}

export interface Session {
  id: string;
  title?: string;
  updatedAt?: string;
}

export interface Agent {
  name: string;
  description?: string;
}

export interface Model {
  id: string;
  name?: string;
}

export interface Provider {
  id: string;
  name?: string;
  models: Model[];
}

export interface MessagePart {
  type: string;
  text?: string;
  tool?: string;
  state?: Record<string, unknown>;
}

export interface MessageInfo {
  id: string;
  role: "user" | "assistant" | "system";
  modelID?: string;
  providerID?: string;
  agent?: string;
  cost?: number;
  tokens?: Record<string, unknown>;
  createdAt?: string;
}

export interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface ServerInfo {
  port?: number;
  pid?: number;
  owned: boolean;
  reused: boolean;
}

/**
 * A server capability advertised via `GET /experimental/features`.
 * Extension features are disabled when the key is absent or `enabled` is false.
 */
export interface FeatureInfo {
  enabled: boolean;
  title?: string;
  description?: string;
}

export interface UIState {
  status: "stopped" | "starting" | "running" | "error";
  serverError?: string;
  serverInfo?: ServerInfo;
  sessions: Session[];
  currentSessionId?: string;
  agents: Agent[];
  providers: Provider[];
  selectedAgent?: string;
  selectedModel?: { providerID: string; modelID: string };
  planMode: PlanMode;
  planState: PlanState;
  showThinking: boolean;
  autoScroll: boolean;
  enableMentions: boolean;
  /** Server capabilities from `GET /experimental/features`. Missing key = unavailable. */
  features: Record<string, FeatureInfo>;
}

export interface FileListItem {
  path: string;
  label: string;
}

export interface SymbolListItem {
  name: string;
  path: string;
  kind?: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface FileRef {
  id: string;
  path: string;
  label: string;
  kind: "file" | "symbol";
}

export type PermissionReply = "once" | "always" | "reject";

export type WebviewToHost =
  | { type: "ready" }
  | { type: "startServer" }
  | { type: "stopServer" }
  | { type: "restartServer" }
  | { type: "sendPrompt"; text: string; turnId?: string }
  | { type: "abort"; turnId?: string }
  | { type: "newSession" }
  | { type: "selectSession"; sessionId: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "selectAgent"; agent: string }
  | { type: "selectModel"; providerID: string; modelID: string }
  | { type: "setPlanMode"; mode: PlanMode }
  | { type: "generatePlan"; text: string; turnId?: string }
  | { type: "revisePlan"; feedback: string; turnId?: string }
  | { type: "implementPlan" }
  | { type: "discardPlan" }
  | { type: "compactContext" }
  | { type: "respondPermission"; permissionId: string; reply: PermissionReply }
  | { type: "refresh" }
  | { type: "requestFileList"; query?: string }
  | { type: "requestWorkspaceSymbols"; query: string }
  | { type: "openPlanFile" };

export type HostToWebview =
  | { type: "state"; state: UIState }
  | { type: "planState"; state: PlanState }
  | { type: "messages"; sessionId: string; messages: MessageWithParts[] }
  | {
      type: "streamText";
      sessionId: string;
      turnId?: string;
      kind: "text" | "reasoning";
      delta: string;
      full: string;
    }
  | {
      type: "streamTool";
      sessionId: string;
      turnId?: string;
      toolName: string;
      status: string;
      title: string;
      callID: string;
      input: string;
    }
  | { type: "streamIdle"; sessionId: string; turnId?: string }
  | {
      type: "permission";
      sessionId: string;
      permissionId: string;
      title: string;
    }
  | { type: "error"; message: string }
  | { type: "fileList"; files: FileListItem[] }
  | { type: "workspaceSymbols"; symbols: SymbolListItem[] }
  | { type: "aborted"; sessionId: string; turnId?: string };
