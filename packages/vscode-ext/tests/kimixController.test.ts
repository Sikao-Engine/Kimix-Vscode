import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { KimixController } from "../src/controller/kimixController";
import type { HostToWebview, WebviewToHost } from "../src/protocol/messages";

function createController() {
  return new KimixController("/workspace", "/tmp/pid.json");
}

function attachListener(
  controller: KimixController,
  messages: HostToWebview[],
) {
  return controller.onMessage((msg) => messages.push(msg));
}

function stubServerStart(controller: KimixController) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (controller as any).serverStatus = "running";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (controller as any).server = {
    info: { port: 4096, owned: true, reused: false },
    status: "running",
  };
}

describe("KimixController dispatch", () => {
  let controller: KimixController;
  let messages: HostToWebview[];
  let dispose: vscode.Disposable;

  beforeEach(() => {
    controller = createController();
    messages = [];
    dispose = attachListener(controller, messages);
    stubServerStart(controller);
  });

  afterEach(() => {
    dispose.dispose();
    vi.restoreAllMocks();
  });

  it("records the current turn id from sendPrompt", async () => {
    const sessions = {
      sendPrompt: vi.fn(async () => {}),
      currentSessionId: "s1",
      sessions: [{ id: "s1" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).sessions = sessions;

    await controller.handleMessage({
      type: "sendPrompt",
      text: "hi",
      turnId: "turn-1",
    } as WebviewToHost);

    expect(sessions.sendPrompt).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((controller as any).currentTurnId).toBe("turn-1");
  });

  it("fires abort in the background and posts aborted immediately", async () => {
    const sessions = {
      abort: vi.fn(async () => {}),
      currentSessionId: "s1",
      sessions: [{ id: "s1" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).sessions = sessions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).currentTurnId = "turn-2";

    await controller.handleMessage({
      type: "abort",
      turnId: "turn-2",
    } as WebviewToHost);

    expect(sessions.abort).toHaveBeenCalled();
    const aborted = messages.find((m) => m.type === "aborted");
    expect(aborted).toMatchObject({ turnId: "turn-2" });
  });

  it("returns workspace files on requestFileList", async () => {
    vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([
      { fsPath: "/workspace/src/foo.ts" } as vscode.Uri,
    ]);

    await controller.handleMessage({
      type: "requestFileList",
      query: "foo",
    } as WebviewToHost);

    const fileList = messages.find((m) => m.type === "fileList");
    expect(fileList).toMatchObject({
      files: [{ path: "src/foo.ts", label: "src/foo.ts" }],
    });
  });

  it("returns workspace symbols on requestWorkspaceSymbols", async () => {
    vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue([
      {
        name: "myFunc",
        kind: 11,
        location: {
          uri: { fsPath: "/workspace/src/foo.ts" },
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 5 },
          },
        },
      },
    ]);

    await controller.handleMessage({
      type: "requestWorkspaceSymbols",
      query: "myF",
    } as WebviewToHost);

    const symbols = messages.find((m) => m.type === "workspaceSymbols");
    expect(symbols).toMatchObject({
      symbols: [
        {
          name: "myFunc",
          path: "src/foo.ts",
          kind: "Function",
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 5 },
          },
        },
      ],
    });
  });
});
