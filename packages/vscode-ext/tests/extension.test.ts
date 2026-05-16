import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate, deactivate } from "../src/extension";
import { commands, workspace, window, extensions, Uri } from "./__mocks__/vscode";

describe("extension", () => {
  let context: any;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      extensionUri: Uri.file("/extension"),
      globalStorageUri: Uri.file("/globalStorage"),
      workspaceState: new Map(),
      globalState: new Map(),
      subscriptions: [],
    };
  });

  it("activate registers commands and providers", () => {
    activate(context);
    expect(workspace.registerTextDocumentContentProvider).toHaveBeenCalled();
    expect(window.registerWebviewViewProvider).toHaveBeenCalled();
    expect(commands.registerCommand).toHaveBeenCalled();
    expect(context.subscriptions.length).toBeGreaterThan(0);
  });

  it("activate registers kimi.clearAllState command", () => {
    activate(context);
    const calls = (commands.registerCommand as any).mock.calls;
    const clearCall = calls.find((c: any[]) => c[0] === "kimi.clearAllState");
    expect(clearCall).toBeDefined();
  });

  it("activate registers kimi.openInTab command", () => {
    activate(context);
    const calls = (commands.registerCommand as any).mock.calls;
    const openCall = calls.find((c: any[]) => c[0] === "kimi.openInTab");
    expect(openCall).toBeDefined();
  });

  it("activate registers kimi.focusInput command", () => {
    activate(context);
    const calls = (commands.registerCommand as any).mock.calls;
    const focusCall = calls.find((c: any[]) => c[0] === "kimi.focusInput");
    expect(focusCall).toBeDefined();
  });

  it("activate registers kimi.newConversation command", () => {
    activate(context);
    const calls = (commands.registerCommand as any).mock.calls;
    const newCall = calls.find((c: any[]) => c[0] === "kimi.newConversation");
    expect(newCall).toBeDefined();
  });

  it("deactivate does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
