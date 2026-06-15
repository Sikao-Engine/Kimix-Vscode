/**
 * Webview-side mirror of the host/webview message contract.
 * Kept self-contained so the UI bundle has no Node dependencies.
 * Must stay in sync with vscode-ext/src/protocol/messages.ts.
 */

export type PlanMode = "build" | "plan";

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

export interface MessageWithParts {
  info: { id: string; role: string };
  parts: MessagePart[];
}

export interface ServerInfo {
  port?: number;
  pid?: number;
  owned: boolean;
  reused: boolean;
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
}

export type PermissionReply = "once" | "always" | "reject";

export type WebviewToHost =
  | { type: "ready" }
  | { type: "startServer" }
  | { type: "stopServer" }
  | { type: "restartServer" }
  | { type: "sendPrompt"; text: string }
  | { type: "abort" }
  | { type: "newSession" }
  | { type: "selectSession"; sessionId: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "selectAgent"; agent: string }
  | { type: "selectModel"; providerID: string; modelID: string }
  | { type: "setPlanMode"; mode: PlanMode }
  | { type: "compactContext" }
  | { type: "respondPermission"; permissionId: string; reply: PermissionReply }
  | { type: "refresh" };

export type HostToWebview =
  | { type: "state"; state: UIState }
  | { type: "messages"; sessionId: string; messages: MessageWithParts[] }
  | {
      type: "streamText";
      sessionId: string;
      kind: "text" | "reasoning";
      delta: string;
      full: string;
    }
  | {
      type: "streamTool";
      sessionId: string;
      toolName: string;
      status: string;
      title: string;
      callID: string;
      input: string;
    }
  | { type: "streamIdle"; sessionId: string }
  | {
      type: "permission";
      sessionId: string;
      permissionId: string;
      title: string;
    }
  | { type: "error"; message: string };
