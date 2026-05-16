import * as vscode from "vscode";

export interface ExtensionConfig {
  yoloMode: boolean;
  autosave: boolean;
  executablePath: string;
  enableNewConversationShortcut: boolean;
  useCtrlEnterToSend: boolean;
  environmentVariables: Record<string, string>;
  showThinkingContent: boolean;
  showThinkingExpanded: boolean;
  editorContext: "never" | "onConversationStart" | "onFileChange";
  version: string;
}

export function getExtensionConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration("kimi");
  const ext = vscode.extensions.getExtension("moonshot-ai.kimi-code");
  return {
    yoloMode: cfg.get<boolean>("yoloMode", false),
    autosave: cfg.get<boolean>("autosave", true),
    executablePath: cfg.get<string>("executablePath", ""),
    enableNewConversationShortcut: cfg.get<boolean>("enableNewConversationShortcut", false),
    useCtrlEnterToSend: cfg.get<boolean>("useCtrlEnterToSend", false),
    environmentVariables: cfg.get<Record<string, string>>("environmentVariables", {}),
    showThinkingContent: cfg.get<boolean>("showThinkingContent", true),
    showThinkingExpanded: cfg.get<boolean>("showThinkingExpanded", false),
    editorContext: cfg.get<"never" | "onConversationStart" | "onFileChange">("editorContext", "never"),
    version: ext?.packageJSON?.version ?? "0.0.0",
  };
}

export const config = {
  get yoloMode(): boolean {
    return getExtensionConfig().yoloMode;
  },
  get autosave(): boolean {
    return getExtensionConfig().autosave;
  },
  get environmentVariables(): Record<string, string> {
    return getExtensionConfig().environmentVariables;
  },
  get editorContext(): "never" | "onConversationStart" | "onFileChange" {
    return getExtensionConfig().editorContext;
  },
  getExtensionConfig,
};
