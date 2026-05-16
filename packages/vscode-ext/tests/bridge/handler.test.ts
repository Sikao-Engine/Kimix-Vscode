import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeHandler } from "../../src/bridge/handler";
import { RpcMethod, WebviewEvent } from "../../src/protocol/types";
import { MementoMock } from "../__mocks__/vscode";
import { workspace } from "../__mocks__/vscode";

describe("BridgeHandler", () => {
  let handler: BridgeHandler;
  let broadcastMock: ReturnType<typeof vi.fn>;
  let memento: MementoMock;

  beforeEach(() => {
    broadcastMock = vi.fn();
    memento = new MementoMock();
    handler = new BridgeHandler(broadcastMock, memento, vi.fn(), vi.fn());
    vi.clearAllMocks();
  });

  it("returns workspace info for CheckWorkspace when no folder", async () => {
    (workspace as any).workspaceFolders = null;
    const res = await handler.handle({ id: 1, method: RpcMethod.CheckWorkspace }, "view1");
    expect(res.result).toEqual({ ok: false, workDir: null });
  });

  it("returns history for GetInputHistory", async () => {
    memento.update("kimi.inputHistory", ["hello", "world"]);
    const res = await handler.handle({ id: 1, method: RpcMethod.GetInputHistory }, "view1");
    expect(res.result).toEqual(["hello", "world"]);
  });

  it("adds input history and dedupes", async () => {
    memento.update("kimi.inputHistory", ["old"]);
    const res = await handler.handle(
      { id: 1, method: RpcMethod.AddInputHistory, params: { input: "new" } },
      "view1"
    );
    expect(res.result).toEqual({ ok: true });
    const history = memento.get<string[]>("kimi.inputHistory");
    expect(history).toEqual(["new", "old"]);
  });

  it("limits history to 100 items", async () => {
    const longHistory = Array.from({ length: 105 }, (_, i) => `item-${i}`);
    memento.update("kimi.inputHistory", longHistory);
    await handler.handle(
      { id: 1, method: RpcMethod.AddInputHistory, params: { input: "new" } },
      "view1"
    );
    const history = memento.get<string[]>("kimi.inputHistory");
    expect(history).toHaveLength(100);
    expect(history![0]).toBe("new");
  });

  it("returns config for GetExtensionConfig", async () => {
    const res = await handler.handle({ id: 1, method: RpcMethod.GetExtensionConfig }, "view1");
    expect(res.result).toBeDefined();
    expect(res.result).toHaveProperty("yoloMode");
  });

  it("resets session for ResetSession", async () => {
    const res = await handler.handle({ id: 1, method: RpcMethod.ResetSession }, "view1");
    expect(res.result).toEqual({ ok: true });
  });

  it("returns ok for ShowLogs", async () => {
    const res = await handler.handle({ id: 1, method: RpcMethod.ShowLogs }, "view1");
    expect(res.result).toEqual({ ok: true });
  });

  it("returns ok for ReloadWebview", async () => {
    const res = await handler.handle({ id: 1, method: RpcMethod.ReloadWebview }, "view1");
    expect(res.result).toEqual({ ok: true });
  });

  it("returns empty array for GetModels", async () => {
    const res = await handler.handle({ id: 1, method: RpcMethod.GetModels }, "view1");
    expect(res.result).toEqual([]);
  });

  it("returns ok for SetPlanMode", async () => {
    const res = await handler.handle(
      { id: 1, method: RpcMethod.SetPlanMode, params: { enabled: true } },
      "view1"
    );
    expect(res.result).toEqual({ ok: true });
  });

  it("returns ok for SteerChat", async () => {
    const res = await handler.handle(
      { id: 1, method: RpcMethod.SteerChat, params: { direction: "up" } },
      "view1"
    );
    expect(res.result).toEqual({ ok: true });
  });

  it("returns ok for RespondApproval", async () => {
    const res = await handler.handle(
      { id: 1, method: RpcMethod.RespondApproval, params: { approved: true } },
      "view1"
    );
    expect(res.result).toEqual({ ok: true });
  });

  it("returns ok for RespondQuestion", async () => {
    const res = await handler.handle(
      { id: 1, method: RpcMethod.RespondQuestion, params: { answer: "yes" } },
      "view1"
    );
    expect(res.result).toEqual({ ok: true });
  });

  it("returns error for unknown method", async () => {
    const res = await handler.handle({ id: 1, method: "UnknownMethod" as RpcMethod }, "view1");
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("Unknown method");
  });

  it("getWorkDir returns custom workdir when set", () => {
    handler.setCustomWorkDir("view1", "/custom");
    expect(handler.getWorkDir("view1")).toBe("/custom");
  });

  it("setCustomWorkDir clears sessions", () => {
    handler.setCustomWorkDir("view1", "/custom");
    handler.setCustomWorkDir("view1", null);
    expect(handler.getWorkDir("view1")).toBeNull();
  });

  it("disposeView cleans up state", () => {
    handler.disposeView("view1");
    expect(handler.getWorkDir("view1")).toBeNull();
  });

  it("dispose cleans all sessions", async () => {
    await handler.dispose();
    // Should not throw
  });
});
