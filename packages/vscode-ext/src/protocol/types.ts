export enum RpcMethod {
  CheckWorkspace = "checkWorkspace",
  GetInputHistory = "getInputHistory",
  AddInputHistory = "addInputHistory",
  CheckCLI = "checkCLI",
  CheckLoginStatus = "checkLoginStatus",
  Login = "login",
  Logout = "logout",
  SaveConfig = "saveConfig",
  GetExtensionConfig = "getExtensionConfig",
  OpenSettings = "openSettings",
  OpenFolder = "openFolder",
  RunCLI = "runCLI",
  GetModels = "getModels",
  GetMCPServers = "getMCPServers",
  AddMCPServer = "addMCPServer",
  UpdateMCPServer = "updateMCPServer",
  RemoveMCPServer = "removeMCPServer",
  AuthMCP = "authMCP",
  ResetAuthMCP = "resetAuthMCP",
  TestMCP = "testMCP",
  StreamChat = "streamChat",
  AbortChat = "abortChat",
  ResetSession = "resetSession",
  SetPlanMode = "setPlanMode",
  SteerChat = "steerChat",
  RespondApproval = "respondApproval",
  RespondQuestion = "respondQuestion",
  GetKimiSessions = "getKimiSessions",
  GetAllKimiSessions = "getAllKimiSessions",
  GetRegisteredWorkDirs = "getRegisteredWorkDirs",
  SetWorkDir = "setWorkDir",
  BrowseWorkDir = "browseWorkDir",
  LoadKimiSessionHistory = "loadKimiSessionHistory",
  DeleteKimiSession = "deleteKimiSession",
  ForkKimiSession = "forkKimiSession",
  GetProjectFiles = "getProjectFiles",
  GetEditorContext = "getEditorContext",
  InsertText = "insertText",
  PickMedia = "pickMedia",
  OpenFile = "openFile",
  OpenFileDiff = "openFileDiff",
  SaveBaselines = "saveBaselines",
  TrackFiles = "trackFiles",
  ClearTrackedFiles = "clearTrackedFiles",
  RevertFiles = "revertFiles",
  KeepChanges = "keepChanges",
  CheckFileExists = "checkFileExists",
  CheckFilesExist = "checkFilesExist",
  GetImageDataUri = "getImageDataUri",
  ShowLogs = "showLogs",
  ReloadWebview = "reloadWebview",
}

export enum WebviewEvent {
  StreamEvent = "streamEvent",
  LoginUrl = "loginUrl",
  MCPServersChanged = "mcpServersChanged",
  FileChangesUpdated = "fileChangesUpdated",
  FocusInput = "focusInput",
  InsertMention = "insertMention",
  ExtensionConfigChanged = "extensionConfigChanged",
}

export enum CliErrorCode {
  SpawnFailed = "SPAWN_FAILED",
  StdinNotWritable = "STDIN_NOT_WRITABLE",
  ProcessCrashed = "PROCESS_CRASHED",
  CliNotFound = "CLI_NOT_FOUND",
  AlreadyStarted = "ALREADY_STARTED",
  HandshakeTimeout = "HANDSHAKE_TIMEOUT",
}

export enum ProtocolErrorCode {
  InvalidJson = "INVALID_JSON",
  InvalidRequest = "INVALID_REQUEST",
  InvalidParams = "INVALID_PARAMS",
  InternalError = "INTERNAL_ERROR",
  SchemaMismatch = "SCHEMA_MISMATCH",
  UnknownEventType = "UNKNOWN_EVENT_TYPE",
  UnknownRequestType = "UNKNOWN_REQUEST_TYPE",
}

export enum LlmErrorCode {
  LlmNotSet = "LLM_NOT_SET",
  LlmNotSupported = "LLM_NOT_SUPPORTED",
  InvalidState = "INVALID_STATE",
  ChatProviderError = "CHAT_PROVIDER_ERROR",
}

export enum SessionErrorCode {
  SessionBusy = "SESSION_BUSY",
  SessionClosed = "SESSION_CLOSED",
  TurnInterrupted = "TURN_INTERRUPTED",
}

export type ErrorCode =
  | CliErrorCode
  | ProtocolErrorCode
  | LlmErrorCode
  | SessionErrorCode;

export type ErrorPhase = "preflight" | "runtime";

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  baselineSaved?: boolean;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  is_error?: boolean;
}

export interface TextChunk {
  type: "text_chunk";
  payload: { text: string };
}

export interface ThinkingChunk {
  type: "thinking_chunk";
  payload: { text: string };
}

export interface ToolCallEvent {
  type: "ToolCall";
  payload: ToolCall;
}

export interface ToolCallPartEvent {
  type: "ToolCallPart";
  payload: {
    id: string;
    arguments_part: string;
  };
}

export interface ToolResultEvent {
  type: "ToolResult";
  payload: ToolResult;
}

export interface StatusUpdateEvent {
  type: "StatusUpdate";
  payload: {
    status: string;
    message?: string;
  };
}

export interface StreamCompleteEvent {
  type: "stream_complete";
  payload: {
    result: TurnResult;
  };
}

export interface StreamErrorEvent {
  type: "error";
  payload: {
    code: string;
    message: string;
    phase?: ErrorPhase;
  };
}

export interface SessionStartEvent {
  type: "session_start";
  payload: {
    sessionId: string;
    model: string;
  };
}

export interface NewConversationEvent {
  type: "new_conversation";
}

export type StreamEvent =
  | TextChunk
  | ThinkingChunk
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

export interface RpcRequest {
  id: string | number;
  method: RpcMethod;
  params?: unknown;
}

export interface RpcResponse {
  id: string | number;
  result?: unknown;
  error?: {
    message: string;
    code?: string;
  };
}

export interface WebviewMessage {
  type: "rpc" | "event";
  payload: RpcRequest | StreamEvent;
}

export interface FileChange {
  path: string;
  status: "Added" | "Modified" | "Deleted";
  additions: number;
  deletions: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type ThinkingMode = "always" | "switch" | "none";
