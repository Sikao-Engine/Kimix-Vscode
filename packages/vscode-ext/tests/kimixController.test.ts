import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { KimixController } from "../src/controller/kimixController";
import type { HostToWebview, PlanState, WebviewToHost } from "../src/protocol/messages";

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

  it("redirects sendPrompt to generatePlan when in plan mode", async () => {
    const planManager = {
      enterPlanning: vi.fn(async () => {}),
      getState: () => ({ phase: "idle" } as PlanState),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planMode = "plan";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).config = { planModeEnabled: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planManager = planManager;

    await controller.handleMessage({
      type: "sendPrompt",
      text: "plan this",
      turnId: "turn-p1",
    } as WebviewToHost);

    expect(planManager.enterPlanning).toHaveBeenCalledWith("plan this", "turn-p1");
  });

  it("uses fallback prompt decoration when plan mode is disabled", async () => {
    const sessions = {
      sendPrompt: vi.fn(async () => {}),
      currentSessionId: "s1",
      sessions: [{ id: "s1" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).sessions = sessions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planMode = "plan";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).config = { planModeEnabled: false };

    await controller.handleMessage({
      type: "sendPrompt",
      text: "plan this",
      turnId: "turn-p2",
    } as WebviewToHost);

    expect(sessions.sendPrompt).toHaveBeenCalledWith(
      expect.stringContaining("[Plan Mode:"),
      expect.any(Object),
    );
  });

  it("forwards implementPlan and switches to build mode", async () => {
    const planManager = {
      implementPlan: vi.fn(async () => {}),
      getState: () => ({ phase: "reviewing" } as PlanState),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planManager = planManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planMode = "plan";

    await controller.handleMessage({ type: "implementPlan" } as WebviewToHost);

    expect(planManager.implementPlan).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((controller as any).planMode).toBe("build");
    const state = messages.find((m) => m.type === "state");
    expect(state).toMatchObject({ state: expect.objectContaining({ planMode: "build" }) });
  });

  it("forwards discardPlan", async () => {
    const planManager = {
      discardPlan: vi.fn(async () => {}),
      getState: () => ({ phase: "reviewing" } as PlanState),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planManager = planManager;

    await controller.handleMessage({ type: "discardPlan" } as WebviewToHost);

    expect(planManager.discardPlan).toHaveBeenCalled();
  });

  it("includes planState in pushed UIState", () => {
    const planManager = {
      getState: () =>
        ({
          phase: "reviewing",
          attempt: 1,
          maxAttempts: 3,
        }) as PlanState,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).planManager = planManager;

    controller.pushState();

    const state = messages.find((m) => m.type === "state");
    expect(state).toMatchObject({
      state: expect.objectContaining({
        planState: { phase: "reviewing", attempt: 1, maxAttempts: 3 },
      }),
    });
  });

  it("includes discovered server features in pushed UIState", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).features = {
      compact: { enabled: true, title: "Compact context" },
    };

    controller.pushState();

    const state = messages.find((m) => m.type === "state");
    expect(state).toMatchObject({
      state: expect.objectContaining({
        features: { compact: { enabled: true, title: "Compact context" } },
      }),
    });
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


describe("KimixController lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls afterStart with the real allocated fallback port", async () => {
    const controller = createController();
    const afterStart = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).afterStart = afterStart;

    const startMock = vi.fn().mockResolvedValue({
      kind: "started",
      info: { port: 4097, pid: 12345, owned: true, reused: false, basePort: 4096 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).server = {
      status: "stopped",
      start: startMock,
      info: { port: 4097, pid: 12345, owned: true, reused: false, basePort: 4096 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (controller as any).ensureStarted();

    expect(startMock).toHaveBeenCalled();
    expect(afterStart).toHaveBeenCalledWith(4097);
  });

  it("prompts the user when a foreign server is detected and fallback is disabled", async () => {
    const controller = createController();
    const showInfo = vi
      .spyOn(vscode.window, "showInformationMessage")
      .mockResolvedValue(undefined);
    const afterStart = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).afterStart = afterStart;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).config = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(controller as any).config,
      autoFallbackPort: false,
    };

    const startMock = vi.fn().mockResolvedValue({
      kind: "foreign",
      port: 4096,
      pid: 7777,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).server = {
      status: "stopped",
      start: startMock,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (controller as any).ensureStarted();

    expect(showInfo).toHaveBeenCalledWith(
      "An opencode server is already running on port 4096 (PID 7777).",
      { modal: false },
      "Reuse",
      "Stop & start new",
      "Start on another port",
    );
    expect(afterStart).not.toHaveBeenCalled();
  });
});
