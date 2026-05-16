import {
  CliErrorCode,
  ProtocolErrorCode,
  LlmErrorCode,
  SessionErrorCode,
  ErrorPhase,
  ErrorCode,
} from "./types";

const ERROR_MESSAGE_MAP: Record<string, string> = {
  [CliErrorCode.CliNotFound]: "Kimi Code CLI not found.",
  [CliErrorCode.SpawnFailed]: "Failed to start Kimi Code CLI.",
  [CliErrorCode.AlreadyStarted]: "A session is already running.",
  [CliErrorCode.StdinNotWritable]: "Failed to communicate with Kimi Code CLI.",
  [CliErrorCode.HandshakeTimeout]: "Connection timed out.",
  [CliErrorCode.ProcessCrashed]: "Process connection lost.",
  [LlmErrorCode.LlmNotSet]: "Authentication failed. Please sign in.",
  [LlmErrorCode.LlmNotSupported]: "This model is not supported.",
  [LlmErrorCode.InvalidState]: "Please wait for the current operation.",
  [LlmErrorCode.ChatProviderError]: "Service temporarily unavailable.",
  [SessionErrorCode.SessionBusy]: "A message is being sent. Please wait.",
  [SessionErrorCode.SessionClosed]: "Session was closed.",
  [SessionErrorCode.TurnInterrupted]: "Stopped by user.",
  [ProtocolErrorCode.InvalidJson]: "Communication format error.",
  [ProtocolErrorCode.InvalidRequest]: "Invalid request.",
  [ProtocolErrorCode.InvalidParams]: "Invalid parameters.",
  [ProtocolErrorCode.InternalError]: "Internal error occurred.",
};

const PREFLIGHT_ERRORS = new Set<string>([
  CliErrorCode.CliNotFound,
  CliErrorCode.SpawnFailed,
  CliErrorCode.AlreadyStarted,
  CliErrorCode.StdinNotWritable,
  CliErrorCode.ProcessCrashed,
  LlmErrorCode.LlmNotSet,
  LlmErrorCode.LlmNotSupported,
  LlmErrorCode.InvalidState,
  SessionErrorCode.SessionBusy,
]);

export function getErrorPhase(code: ErrorCode): ErrorPhase {
  return PREFLIGHT_ERRORS.has(code) ? "preflight" : "runtime";
}

export function getErrorMessage(code: ErrorCode, fallback?: string): string {
  return ERROR_MESSAGE_MAP[code] ?? fallback ?? "An unknown error occurred.";
}

export class KimiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "KimiError";
  }
}

export class CliError extends KimiError {
  constructor(code: CliErrorCode, message: string, details?: unknown) {
    super(code, message, details);
    this.name = "CliError";
  }
}

export class ProtocolError extends KimiError {
  constructor(
    code: ProtocolErrorCode,
    message: string,
    public readonly rawResponse?: string,
  ) {
    super(code, message, rawResponse);
    this.name = "ProtocolError";
  }
}

export class SessionError extends KimiError {
  constructor(code: SessionErrorCode, message: string) {
    super(code, message);
    this.name = "SessionError";
  }
}
