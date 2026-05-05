import { describe, it, expect, vi, beforeEach } from "vitest";
import { getExtensionConfig } from "../src/config";
import { workspace, extensions } from "./__mocks__/vscode";

describe("getExtensionConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when config is empty", () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      update: vi.fn(),
    } as any);
    vi.mocked(extensions.getExtension).mockReturnValue(null as any);

    const cfg = getExtensionConfig();
    expect(cfg.yoloMode).toBe(false);
    expect(cfg.autosave).toBe(true);
    expect(cfg.executablePath).toBe("");
    expect(cfg.enableNewConversationShortcut).toBe(false);
    expect(cfg.useCtrlEnterToSend).toBe(false);
    expect(cfg.environmentVariables).toEqual({});
    expect(cfg.showThinkingContent).toBe(true);
    expect(cfg.showThinkingExpanded).toBe(false);
    expect(cfg.editorContext).toBe("never");
    expect(cfg.version).toBe("0.0.0");
  });

  it("reads values from workspace config", () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        const map: Record<string, any> = {
          yoloMode: true,
          autosave: false,
          executablePath: "/bin/kimi",
          enableNewConversationShortcut: true,
          useCtrlEnterToSend: true,
          environmentVariables: { FOO: "bar" },
          showThinkingContent: false,
          showThinkingExpanded: true,
          editorContext: "onConversationStart",
        };
        return map[key] ?? defaultValue;
      }),
      update: vi.fn(),
    } as any);
    vi.mocked(extensions.getExtension).mockReturnValue({
      packageJSON: { version: "1.2.3" },
    } as any);

    const cfg = getExtensionConfig();
    expect(cfg.yoloMode).toBe(true);
    expect(cfg.autosave).toBe(false);
    expect(cfg.executablePath).toBe("/bin/kimi");
    expect(cfg.enableNewConversationShortcut).toBe(true);
    expect(cfg.useCtrlEnterToSend).toBe(true);
    expect(cfg.environmentVariables).toEqual({ FOO: "bar" });
    expect(cfg.showThinkingContent).toBe(false);
    expect(cfg.showThinkingExpanded).toBe(true);
    expect(cfg.editorContext).toBe("onConversationStart");
    expect(cfg.version).toBe("1.2.3");
  });
});
