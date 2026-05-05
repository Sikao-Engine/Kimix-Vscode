import {
  CliErrorCode,
  LlmErrorCode,
  SessionErrorCode,
  ProtocolErrorCode,
  ErrorPhase,
} from "../protocol/types";
import { KimiError, CliError, ProtocolError, SessionError } from "../protocol/errors";

export function normalizeError(error: unknown): string {
  if (error instanceof KimiError) {
    return error.code;
  }
  if (error instanceof Error) {
    // Map common error messages to known codes
    if (error.message.includes("CLI not found")) return CliErrorCode.CliNotFound;
    if (error.message.includes("spawn")) return CliErrorCode.SpawnFailed;
    if (error.message.includes("already running")) return CliErrorCode.AlreadyStarted;
    if (error.message.includes("stdin")) return CliErrorCode.StdinNotWritable;
    if (error.message.includes("crashed") || error.message.includes("exited"))
      return CliErrorCode.ProcessCrashed;
    if (error.message.includes("timeout")) return CliErrorCode.HandshakeTimeout;
    if (error.message.includes("not set") || error.message.includes("auth"))
      return LlmErrorCode.LlmNotSet;
    if (error.message.includes("not supported")) return LlmErrorCode.LlmNotSupported;
    if (error.message.includes("busy")) return SessionErrorCode.SessionBusy;
    if (error.message.includes("closed")) return SessionErrorCode.SessionClosed;
    if (error.message.includes("interrupted")) return SessionErrorCode.TurnInterrupted;
    return error.message;
  }
  return String(error);
}

export function classifyErrorPhase(errorCode: string): ErrorPhase {
  const preflightCodes = new Set<string>([
    CliErrorCode.CliNotFound,
    CliErrorCode.SpawnFailed,
    CliErrorCode.AlreadyStarted,
    CliErrorCode.StdinNotWritable,
    CliErrorCode.ProcessCrashed,
    CliErrorCode.HandshakeTimeout,
    LlmErrorCode.LlmNotSet,
    LlmErrorCode.LlmNotSupported,
    LlmErrorCode.InvalidState,
    SessionErrorCode.SessionBusy,
  ]);
  return preflightCodes.has(errorCode) ? "preflight" : "runtime";
}

export function isFatalError(error: unknown): boolean {
  if (error instanceof CliError) {
    return [
      CliErrorCode.CliNotFound,
      CliErrorCode.SpawnFailed,
      CliErrorCode.ProcessCrashed,
    ].includes(error.code as CliErrorCode);
  }
  return false;
}
