import { describe, it, expect } from "vitest";
import {
  getErrorPhase,
  getErrorMessage,
  KimiError,
  CliError,
  ProtocolError,
  SessionError,
} from "../../src/protocol/errors";
import {
  CliErrorCode,
  ProtocolErrorCode,
  LlmErrorCode,
  SessionErrorCode,
} from "../../src/protocol/types";

describe("getErrorPhase", () => {
  it("returns preflight for preflight errors", () => {
    expect(getErrorPhase(CliErrorCode.CliNotFound)).toBe("preflight");
    expect(getErrorPhase(LlmErrorCode.LlmNotSet)).toBe("preflight");
    expect(getErrorPhase(SessionErrorCode.SessionBusy)).toBe("preflight");
  });

  it("returns runtime for runtime errors", () => {
    expect(getErrorPhase(ProtocolErrorCode.InternalError)).toBe("runtime");
    expect(getErrorPhase(SessionErrorCode.SessionClosed)).toBe("runtime");
    expect(getErrorPhase(SessionErrorCode.TurnInterrupted)).toBe("runtime");
  });
});

describe("getErrorMessage", () => {
  it("returns mapped message for known codes", () => {
    expect(getErrorMessage(CliErrorCode.CliNotFound)).toBe("Kimi Code CLI not found.");
    expect(getErrorMessage(LlmErrorCode.LlmNotSet)).toBe("Authentication failed. Please sign in.");
    expect(getErrorMessage(SessionErrorCode.TurnInterrupted)).toBe("Stopped by user.");
  });

  it("returns fallback for unknown codes", () => {
    expect(getErrorMessage("UNKNOWN" as any, "custom fallback")).toBe("custom fallback");
  });

  it("returns default for unknown codes without fallback", () => {
    expect(getErrorMessage("UNKNOWN" as any)).toBe("An unknown error occurred.");
  });
});

describe("KimiError", () => {
  it("stores code, message, and details", () => {
    const err = new KimiError("CODE", "msg", { extra: true });
    expect(err.code).toBe("CODE");
    expect(err.message).toBe("msg");
    expect(err.details).toEqual({ extra: true });
    expect(err.name).toBe("KimiError");
  });

  it("is an instance of Error", () => {
    const err = new KimiError("C", "m");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("CliError", () => {
  it("has correct name and code", () => {
    const err = new CliError(CliErrorCode.SpawnFailed, "spawn failed");
    expect(err.name).toBe("CliError");
    expect(err.code).toBe(CliErrorCode.SpawnFailed);
    expect(err).toBeInstanceOf(KimiError);
  });
});

describe("ProtocolError", () => {
  it("has rawResponse in details", () => {
    const err = new ProtocolError(ProtocolErrorCode.InvalidJson, "bad json", "{bad");
    expect(err.name).toBe("ProtocolError");
    expect(err.rawResponse).toBe("{bad");
    expect(err.details).toBe("{bad");
  });
});

describe("SessionError", () => {
  it("has correct name and code", () => {
    const err = new SessionError(SessionErrorCode.SessionBusy, "busy");
    expect(err.name).toBe("SessionError");
    expect(err.code).toBe(SessionErrorCode.SessionBusy);
    expect(err).toBeInstanceOf(KimiError);
  });
});
