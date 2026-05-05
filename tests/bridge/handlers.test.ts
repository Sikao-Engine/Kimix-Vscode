import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlers } from "../../src/bridge/handlers";
import { RpcMethod, WebviewEvent } from "../../src/protocol/types";
import { baselineTracker } from "../../src/file/baseline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function createCtx(overrides: Partial<any> = {}): any {
  return {
    webviewId: "view1",
    workDir: "/workspace",
    workspaceRoot: "/workspace",
    workspaceState: {
      get: vi.fn(() => []),
      update: vi.fn().mockResolvedValue(undefined),
    },
    requireWorkDir: () => "/workspace",
    broadcast: vi.fn(),
    fileManager: {
      trackFile: vi.fn(),
      getTracked: vi.fn(() => new Set()),
      clearTracked: vi.fn(),
      listDirectory: vi.fn(async () => []),
      searchFiles: vi.fn(async () => []),
    },
    reloadWebview: vi.fn(),
    showLogs: vi.fn(),
    getSession: vi.fn(),
    getSessionId: vi.fn(() => "sess-1"),
    getTurn: vi.fn(),
    setTurn: vi.fn(),
    getOrCreateSession: vi.fn(),
    closeSession: vi.fn().mockResolvedValue(undefined),
    saveAllDirty: vi.fn().mockResolvedValue(undefined),
    setCustomWorkDir: vi.fn(),
    ...overrides,
  };
}

describe("handlers", () => {
  let tmpDir: string;
  let workDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-handlers-test-"));
    workDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CheckWorkspace returns ok false when no workspace", async () => {
    const ctx = createCtx({ workspaceRoot: null });
    const result = await handlers[RpcMethod.CheckWorkspace]({}, ctx);
    expect(result).toEqual({ ok: false, workDir: null });
  });

  it("CheckWorkspace returns ok true when workspace exists", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.CheckWorkspace]({}, ctx);
    expect(result).toEqual({ ok: true, workDir: "/workspace" });
  });

  it("OpenFolder returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.OpenFolder]({}, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("RunCLI returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.RunCLI]({ args: ["--help"] }, ctx);
    expect(result).toEqual({ ok: true, output: "" });
  });

  it("GetInputHistory returns history", async () => {
    const ctx = createCtx({ workspaceState: { get: vi.fn(() => ["a", "b"]), update: vi.fn() } });
    const result = await handlers[RpcMethod.GetInputHistory]({}, ctx);
    expect(result).toEqual(["a", "b"]);
  });

  it("AddInputHistory dedupes and limits", async () => {
    const state = { get: vi.fn(() => ["old"]), update: vi.fn().mockResolvedValue(undefined) };
    const ctx = createCtx({ workspaceState: state });
    const result = await handlers[RpcMethod.AddInputHistory]({ input: "new" }, ctx);
    expect(result).toEqual({ ok: true });
    expect(state.update).toHaveBeenCalledWith("kimi.inputHistory", ["new", "old"]);
  });

  it("SaveConfig returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.SaveConfig]({ model: "m" }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("OpenSettings returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.OpenSettings]({}, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("ShowLogs calls ctx.showLogs", async () => {
    const ctx = createCtx();
    await handlers[RpcMethod.ShowLogs]({}, ctx);
    expect(ctx.showLogs).toHaveBeenCalled();
  });

  it("ReloadWebview calls ctx.reloadWebview", async () => {
    const ctx = createCtx();
    await handlers[RpcMethod.ReloadWebview]({}, ctx);
    expect(ctx.reloadWebview).toHaveBeenCalled();
  });

  it("AbortChat interrupts turn when present", async () => {
    const turn = { interrupted: false, interrupt: vi.fn() };
    const ctx = createCtx({ getTurn: () => turn });
    const result = await handlers[RpcMethod.AbortChat]({}, ctx);
    expect(result).toEqual({ ok: true });
    expect(turn.interrupt).toHaveBeenCalled();
    expect(turn.interrupted).toBe(true);
  });

  it("AbortChat handles missing turn", async () => {
    const ctx = createCtx({ getTurn: () => undefined });
    const result = await handlers[RpcMethod.AbortChat]({}, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("ResetSession closes session", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.ResetSession]({}, ctx);
    expect(result).toEqual({ ok: true });
    expect(ctx.closeSession).toHaveBeenCalled();
  });

  it("SetPlanMode returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.SetPlanMode]({ enabled: true }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("SteerChat returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.SteerChat]({ direction: "up" }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("RespondApproval returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.RespondApproval]({ approved: true }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("RespondQuestion returns ok true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.RespondQuestion]({ answer: "yes" }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("GetKimiSessions returns empty when no workDir", async () => {
    const ctx = createCtx({ workDir: null });
    const result = await handlers[RpcMethod.GetKimiSessions]({}, ctx);
    expect(result).toEqual([]);
  });

  it("GetAllKimiSessions returns empty when no workspaceRoot", async () => {
    const ctx = createCtx({ workspaceRoot: null });
    const result = await handlers[RpcMethod.GetAllKimiSessions]({}, ctx);
    expect(result).toEqual([]);
  });

  it("GetRegisteredWorkDirs returns empty when no workspaceRoot", async () => {
    const ctx = createCtx({ workspaceRoot: null });
    const result = await handlers[RpcMethod.GetRegisteredWorkDirs]({}, ctx);
    expect(result).toEqual([]);
  });

  it("SetWorkDir returns false when no workspaceRoot", async () => {
    const ctx = createCtx({ workspaceRoot: null });
    const result = await handlers[RpcMethod.SetWorkDir]({ workDir: "/other" }, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("SetWorkDir rejects paths outside workspace", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.SetWorkDir]({ workDir: "/outside" }, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("SetWorkDir accepts null and workspaceRoot", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.SetWorkDir]({ workDir: null }, ctx);
    expect(result).toEqual({ ok: true, workDir: "/workspace" });
  });

  it("SetWorkDir accepts subdirectories", async () => {
    const root = path.resolve("/workspace");
    const subDir = path.join(root, "sub");
    const ctx = createCtx({ workspaceRoot: root });
    const result = await handlers[RpcMethod.SetWorkDir]({ workDir: subDir }, ctx);
    expect(result.ok).toBe(true);
  });

  it("DeleteKimiSession returns false when no workDir", async () => {
    const ctx = createCtx({ workDir: null });
    const result = await handlers[RpcMethod.DeleteKimiSession]({ sessionId: "s" }, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("DeleteKimiSession returns true", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.DeleteKimiSession]({ sessionId: "s" }, ctx);
    expect(result).toEqual({ ok: true });
  });

  it("ForkKimiSession returns null when no workDir", async () => {
    const ctx = createCtx({ workDir: null });
    const result = await handlers[RpcMethod.ForkKimiSession]({ sessionId: "s", turnIndex: 0 }, ctx);
    expect(result).toBeNull();
  });

  it("ForkKimiSession returns null for negative turnIndex", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.ForkKimiSession]({ sessionId: "s", turnIndex: -1 }, ctx);
    expect(result).toBeNull();
  });

  it("GetProjectFiles delegates to fileManager", async () => {
    const ctx = createCtx();
    await handlers[RpcMethod.GetProjectFiles]({ directory: "src" }, ctx);
    expect(ctx.fileManager.listDirectory).toHaveBeenCalled();
  });

  it("GetProjectFiles searches when no directory", async () => {
    const ctx = createCtx();
    await handlers[RpcMethod.GetProjectFiles]({ query: "test" }, ctx);
    expect(ctx.fileManager.searchFiles).toHaveBeenCalledWith("test");
  });

  it("GetProjectFiles returns empty when no workDir", async () => {
    const ctx = createCtx({ workDir: null });
    const result = await handlers[RpcMethod.GetProjectFiles]({}, ctx);
    expect(result).toEqual([]);
  });

  it("CheckFileExists returns false for missing file", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.CheckFileExists]({ filePath: "missing.txt" }, ctx);
    expect(result).toBe(false);
  });

  it("CheckFilesExist returns array of results", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.CheckFilesExist]({ paths: ["a.txt", "b.txt"] }, ctx);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("path");
    expect(result[0]).toHaveProperty("exists");
  });

  it("SaveBaselines returns false when no sessionId", async () => {
    const ctx = createCtx({ getSessionId: () => null });
    const result = await handlers[RpcMethod.SaveBaselines]({ paths: ["a.txt"] }, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("TrackFiles returns empty when no sessionId", async () => {
    const ctx = createCtx({ getSessionId: () => null });
    const result = await handlers[RpcMethod.TrackFiles]({ paths: ["a.txt"] }, ctx);
    expect(result).toEqual([]);
  });

  it("ClearTrackedFiles clears and broadcasts", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.ClearTrackedFiles]({}, ctx);
    expect(result).toEqual({ ok: true });
    expect(ctx.fileManager.clearTracked).toHaveBeenCalledWith("view1");
    expect(ctx.broadcast).toHaveBeenCalledWith(WebviewEvent.FileChangesUpdated, [], "view1");
  });

  it("RevertFiles returns false when no sessionId", async () => {
    const ctx = createCtx({ getSessionId: () => null });
    const result = await handlers[RpcMethod.RevertFiles]({}, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("KeepChanges returns false when no sessionId", async () => {
    const ctx = createCtx({ getSessionId: () => null });
    const result = await handlers[RpcMethod.KeepChanges]({}, ctx);
    expect(result).toEqual({ ok: false });
  });

  it("GetImageDataUri returns null outside workDir", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.GetImageDataUri]({ filePath: "../../../../etc/passwd" }, ctx);
    expect(result).toBeNull();
  });

  it("CheckCLI returns error when no workDir", async () => {
    const ctx = createCtx({ workDir: null });
    const result = await handlers[RpcMethod.CheckCLI]({}, ctx);
    expect(result.ok).toBe(false);
  });

  it("CheckLoginStatus returns loggedIn false", async () => {
    const ctx = createCtx();
    const result = await handlers[RpcMethod.CheckLoginStatus]({}, ctx);
    expect(result).toEqual({ loggedIn: false });
  });
});
