import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliBinaryManager } from "../../src/cli/binary";
import { workspace } from "../__mocks__/vscode";
import * as path from "node:path";

const execSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

describe("CliBinaryManager", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = {
      extensionUri: { fsPath: "/extension" },
      globalStorageUri: { fsPath: "/globalStorage" },
      workspaceState: new Map(),
      globalState: new Map(),
      subscriptions: [],
    };
    vi.clearAllMocks();
    execSyncMock.mockReset();
  });

  it("constructs paths correctly", () => {
    const mgr = new CliBinaryManager(ctx);
    expect(mgr.extensionBinPath).toContain(path.join("bin", "kimi"));
    expect(mgr.kimiPath).toContain(path.join("bin", "kimi"));
  });

  it("getExecutablePath returns custom path when set", () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        if (key === "executablePath") return "/custom/kimi";
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
    const mgr = new CliBinaryManager(ctx);
    expect(mgr.getExecutablePath()).toBe("/custom/kimi");
  });

  it("getExecutablePath returns bundled path when custom is empty", () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      update: vi.fn(),
    } as any);
    const mgr = new CliBinaryManager(ctx);
    expect(mgr.getExecutablePath()).toBe(mgr.kimiPath);
  });

  it("checkInstalled returns ok when CLI is found", () => {
    execSyncMock.mockImplementation(() => "");
    const mgr = new CliBinaryManager(ctx);
    vi.spyOn(mgr, "getExecutablePath").mockReturnValue("node");
    const result = mgr.checkInstalled("/wd");
    expect(result.ok).toBe(true);
    expect(result.resolved.isCustomPath).toBe(true);
  });

  it("checkInstalled returns error when CLI is not found", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    const mgr = new CliBinaryManager(ctx);
    vi.spyOn(mgr, "getExecutablePath").mockReturnValue("nonexistent-binary-12345");
    const result = mgr.checkInstalled("/wd");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("download throws not implemented error", async () => {
    const mgr = new CliBinaryManager(ctx);
    await expect(mgr.download()).rejects.toThrow("Auto-download not implemented");
  });
});
