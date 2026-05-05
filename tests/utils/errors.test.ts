import { describe, it, expect } from "vitest";
import { normalizeError, classifyErrorPhase, isFatalError } from "../../src/utils/errors";
import { KimiError, CliError, ProtocolError, SessionError } from "../../src/protocol/errors";
import { CliErrorCode, LlmErrorCode, SessionErrorCode, ProtocolErrorCode } from "../../src/protocol/types";

describe("normalizeError", () => {
  it("returns error code for KimiError instances", () => {
    const err = new KimiError("CUSTOM_CODE", "message");
    expect(normalizeError(err)).toBe("CUSTOM_CODE");
  });

  it("maps CLI not found message", () => {
    expect(normalizeError(new Error("CLI not found in path"))).toBe(CliErrorCode.CliNotFound);
  });

  it("maps spawn errors", () => {
    expect(normalizeError(new Error("spawn ENOENT"))).toBe(CliErrorCode.SpawnFailed);
  });

  it("maps already running message", () => {
    expect(normalizeError(new Error("already running process"))).toBe(CliErrorCode.AlreadyStarted);
  });

  it("maps stdin errors", () => {
    expect(normalizeError(new Error("stdin closed"))).toBe(CliErrorCode.StdinNotWritable);
  });

  it("maps crashed/exited messages", () => {
    expect(normalizeError(new Error("process crashed"))).toBe(CliErrorCode.ProcessCrashed);
    expect(normalizeError(new Error("exited unexpectedly"))).toBe(CliErrorCode.ProcessCrashed);
  });

  it("maps timeout messages", () => {
    expect(normalizeError(new Error("connection timeout"))).toBe(CliErrorCode.HandshakeTimeout);
  });

  it("maps auth/not set messages", () => {
    expect(normalizeError(new Error("api key not set"))).toBe(LlmErrorCode.LlmNotSet);
    expect(normalizeError(new Error("auth failed"))).toBe(LlmErrorCode.LlmNotSet);
  });

  it("maps not supported messages", () => {
    expect(normalizeError(new Error("model not supported"))).toBe(LlmErrorCode.LlmNotSupported);
  });

  it("maps busy messages", () => {
    expect(normalizeError(new Error("session is busy"))).toBe(SessionErrorCode.SessionBusy);
  });

  it("maps closed messages", () => {
    expect(normalizeError(new Error("session closed"))).toBe(SessionErrorCode.SessionClosed);
  });

  it("maps interrupted messages", () => {
    expect(normalizeError(new Error("turn interrupted"))).toBe(SessionErrorCode.TurnInterrupted);
  });

  it("returns Error message for unknown errors", () => {
    expect(normalizeError(new Error("something else"))).toBe("something else");
  });

  it("converts non-Error to string", () => {
    expect(normalizeError(42)).toBe("42");
    expect(normalizeError(null)).toBe("null");
  });
});

describe("classifyErrorPhase", () => {
  it("returns preflight for CLI error codes", () => {
    expect(classifyErrorPhase(CliErrorCode.CliNotFound)).toBe("preflight");
    expect(classifyErrorPhase(CliErrorCode.SpawnFailed)).toBe("preflight");
    expect(classifyErrorPhase(CliErrorCode.AlreadyStarted)).toBe("preflight");
    expect(classifyErrorPhase(CliErrorCode.StdinNotWritable)).toBe("preflight");
    expect(classifyErrorPhase(CliErrorCode.ProcessCrashed)).toBe("preflight");
    expect(classifyErrorPhase(CliErrorCode.HandshakeTimeout)).toBe("preflight");
  });

  it("returns preflight for LLM error codes", () => {
    expect(classifyErrorPhase(LlmErrorCode.LlmNotSet)).toBe("preflight");
    expect(classifyErrorPhase(LlmErrorCode.LlmNotSupported)).toBe("preflight");
    expect(classifyErrorPhase(LlmErrorCode.InvalidState)).toBe("preflight");
  });

  it("returns preflight for session busy", () => {
    expect(classifyErrorPhase(SessionErrorCode.SessionBusy)).toBe("preflight");
  });

  it("returns runtime for other codes", () => {
    expect(classifyErrorPhase(SessionErrorCode.SessionClosed)).toBe("runtime");
    expect(classifyErrorPhase(SessionErrorCode.TurnInterrupted)).toBe("runtime");
    expect(classifyErrorPhase(ProtocolErrorCode.InternalError)).toBe("runtime");
    expect(classifyErrorPhase("UNKNOWN")).toBe("runtime");
  });
});

describe("isFatalError", () => {
  it("returns true for fatal CLI errors", () => {
    expect(isFatalError(new CliError(CliErrorCode.CliNotFound, "not found"))).toBe(true);
    expect(isFatalError(new CliError(CliErrorCode.SpawnFailed, "spawn failed"))).toBe(true);
    expect(isFatalError(new CliError(CliErrorCode.ProcessCrashed, "crashed"))).toBe(true);
  });

  it("returns false for non-fatal CLI errors", () => {
    expect(isFatalError(new CliError(CliErrorCode.AlreadyStarted, "already started"))).toBe(false);
    expect(isFatalError(new CliError(CliErrorCode.HandshakeTimeout, "timeout"))).toBe(false);
  });

  it("returns false for non-CliError errors", () => {
    expect(isFatalError(new Error("random"))).toBe(false);
    expect(isFatalError(new ProtocolError(ProtocolErrorCode.InternalError, "internal"))).toBe(false);
    expect(isFatalError(new SessionError(SessionErrorCode.SessionBusy, "busy"))).toBe(false);
  });
});
