/**
 * Message protocol between the extension host and the webview.
 *
 * Both sides import this file so the contract stays in one place. The webview
 * package references it via a relative path alias (see webview-ui tsconfig).
 *
 *  - `WebviewToHost`: requests/commands the UI sends to the extension.
 *  - `HostToWebview`: events/replies the extension pushes to the UI.
 */

import type {
  Agent,
  FeatureInfo,
  FileListItem,
  MessageWithParts,
  PermissionReply,
  Provider,
  Session,
  SymbolListItem,
} from "./types";

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

export interface ServerInfo {
  port?: number;
  pid?: number;
  owned: boolean;
  reused: boolean;
  basePort?: number;
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

// ── Webview → Host ──────────────────────────────────────────────────

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

// ── Host → Webview ──────────────────────────────────────────────────

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
  | { type: "aborted"; sessionId: string; turnId?: string }
  | {
      type: "completion";
      sessionId: string;
      turnId?: string;
      status: "success" | "error";
    };
