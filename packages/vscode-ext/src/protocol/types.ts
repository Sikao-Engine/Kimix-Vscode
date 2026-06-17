/**
 * Wire types for the opencode-compatible HTTP / SSE protocol.
 *
 * These mirror the subset of the opencode server surface that the extension
 * consumes. They are intentionally permissive (most fields optional) so the
 * client keeps working across minor server version changes.
 */

export interface Session {
  id: string;
  title?: string;
  parentID?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Raw server payload, preserved for fields not modelled here. */
  raw?: Record<string, unknown>;
}

export interface Agent {
  name: string;
  description?: string;
  mode?: string;
  builtIn?: boolean;
  raw?: Record<string, unknown>;
}

export interface Model {
  id: string;
  name?: string;
  providerID?: string;
  raw?: Record<string, unknown>;
}

export interface Provider {
  id: string;
  name?: string;
  models: Model[];
  raw?: Record<string, unknown>;
}

export type PartType =
  | "text"
  | "reasoning"
  | "tool"
  | "step-start"
  | "step-finish"
  | "file"
  | "unknown";

export interface MessagePart {
  type: PartType;
  text?: string;
  tool?: string;
  reason?: string;
  state?: Record<string, unknown>;
  raw?: Record<string, unknown>;
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

export interface PromptBody {
  text: string;
  agent?: string;
  /** opencode prompt model field is `{ providerID, modelID }`. */
  model?: { providerID: string; modelID: string };
}

export type PermissionReply = "once" | "always" | "reject";

/** A workspace file reference shown in the @ mention picker. */
export interface FileListItem {
  path: string;
  label: string;
}

/** A workspace symbol reference shown in the @ mention picker. */
export interface SymbolListItem {
  name: string;
  path: string;
  kind?: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/** A file/symbol reference attached to a composer prompt. */
export interface FileRef {
  id: string;
  path: string;
  label: string;
  kind: "file" | "symbol";
}
