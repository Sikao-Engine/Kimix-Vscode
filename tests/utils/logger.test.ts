import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("createLogger", () => {
  const originalEnv = process.env.DEBUG;

  beforeEach(() => {
    delete process.env.DEBUG;
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.DEBUG = originalEnv;
    vi.restoreAllMocks();
  });

  it("is disabled when DEBUG env is not set", async () => {
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("test");
    expect(logger.enabled).toBe(false);
    logger.log("hello");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("is enabled when DEBUG matches exactly", async () => {
    process.env.DEBUG = "test";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("test");
    expect(logger.enabled).toBe(true);
  });

  it("is enabled when DEBUG is wildcard", async () => {
    process.env.DEBUG = "*";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("anything");
    expect(logger.enabled).toBe(true);
  });

  it("is enabled for prefix matches", async () => {
    process.env.DEBUG = "app:*";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("app:module");
    expect(logger.enabled).toBe(true);
  });

  it("logs formatted messages to stderr", async () => {
    process.env.DEBUG = "test";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("test");
    logger.log("value %d", 42);
    expect(console.error).toHaveBeenCalledOnce();
    const call = (console.error as any).mock.calls[0][0];
    expect(call).toContain("test");
    expect(call).toContain("value 42");
  });

  it("debug logs with ISO timestamp", async () => {
    process.env.DEBUG = "test";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("test");
    logger.debug("msg");
    expect(console.error).toHaveBeenCalledOnce();
    const args = (console.error as any).mock.calls[0];
    expect(args[0]).toBe("%s %s %s");
    expect(args[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(args[2]).toBe("test");
    expect(args[3]).toBe("msg");
  });

  it("does not log when disabled", async () => {
    process.env.DEBUG = "other";
    const { createLogger } = await import("../../src/utils/logger");
    const logger = createLogger("test");
    logger.log("should not appear");
    expect(console.error).not.toHaveBeenCalled();
  });
});
