export interface VSCodeAPI {
  postMessage(message: unknown): void;
  setState<T>(state: T): void;
  getState<T>(): T | undefined;
}

export interface WebviewMessage {
  type: "rpc" | "event";
  payload: RpcRequest | StreamEvent;
}

export interface RpcRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: string | number;
  result?: unknown;
  error?: { message: string; code?: string };
}

export interface ExtensionConfig {
  yoloMode: boolean;
  autosave: boolean;
  executablePath: string;
  enableNewConversationShortcut: boolean;
  useCtrlEnterToSend: boolean;
  environmentVariables: Record<string, string>;
  showThinkingContent: boolean;
  showThinkingExpanded: boolean;
  editorContext: "never" | "onConversationStart" | "onFileChange";
  version: string;
  defaultModel?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export interface FileChange {
  path: string;
  status: "Added" | "Modified" | "Deleted";
  additions: number;
  deletions: number;
}

export interface Mention {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | { type: "text"; text: string }[];
  toolCalls?: ToolCall[];
  thinking?: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  is_error?: boolean;
}

export interface TextChunkEvent {
  type: "text_chunk";
  text: string;
}

export interface ThinkingChunkEvent {
  type: "thinking_chunk";
  text: string;
}

export interface ToolCallEvent {
  type: "ToolCall";
  payload: ToolCall;
}

export interface ToolCallPartEvent {
  type: "ToolCallPart";
  payload: { id: string; arguments_part: string };
}

export interface ToolResultEvent {
  type: "ToolResult";
  payload: ToolResult;
}

export interface StatusUpdateEvent {
  type: "StatusUpdate";
  payload: { status: string; message?: string };
}

export interface StreamCompleteEvent {
  type: "stream_complete";
  result: TurnResult;
}

export interface StreamErrorEvent {
  type: "error";
  code: string;
  message: string;
  phase?: "preflight" | "runtime";
}

export interface SessionStartEvent {
  type: "session_start";
  sessionId: string;
  model: string;
}

export interface NewConversationEvent {
  type: "new_conversation";
}

export type StreamEvent =
  | TextChunkEvent
  | ThinkingChunkEvent
  | ToolCallEvent
  | ToolCallPartEvent
  | ToolResultEvent
  | StatusUpdateEvent
  | StreamCompleteEvent
  | StreamErrorEvent
  | SessionStartEvent
  | NewConversationEvent;

export interface TurnResult {
  status: "finished" | "interrupted" | "error";
  output?: string;
  error?: string;
}

export interface Session {
  sessionId: string;
  model: string;
  messages: ChatMessage[];
  isLoading: boolean;
}
