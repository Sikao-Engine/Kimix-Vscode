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
  MessageWithParts,
  PermissionReply,
  Provider,
  Session,
} from "./types";

export type PlanMode = "build" | "plan";

export interface UIState {
  status: "stopped" | "starting" | "running" | "error";
  serverError?: string;
  sessions: Session[];
  currentSessionId?: string;
  agents: Agent[];
  providers: Provider[];
  selectedAgent?: string;
  selectedModel?: { providerID: string; modelID: string };
  planMode: PlanMode;
}

// ── Webview → Host ──────────────────────────────────────────────────

export type WebviewToHost =
  | { type: "ready" }
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

// ── Host → Webview ──────────────────────────────────────────────────

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
