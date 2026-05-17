import * as vscode from "vscode";
import { KimiWebviewProvider } from "./webview/provider";
import { WebviewEvent } from "./protocol/types";
import { getExtensionConfig } from "./config";
import { baselineTracker } from "./file/baseline";

const debug = require("debug")("kimi-sdk:*");

let outputChannel: vscode.OutputChannel;
let provider: KimiWebviewProvider;

export function activate(context: vscode.ExtensionContext): void {
  const remoteName = vscode.env.remoteName ? ` (remote: ${vscode.env.remoteName})` : "";
  debug("Kimi Code extension activating...%s", remoteName);

  outputChannel = vscode.window.createOutputChannel("Kimi Code");
  provider = new KimiWebviewProvider(context.extensionUri, context.workspaceState, () =>
    outputChannel.show(),
  );

  // Register baseline text document provider
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kimi-baseline", {
      provideTextDocumentContent: async (uri) => {
        const params = new URLSearchParams(uri.query);
        const workDir = params.get("workDir");
        const sessionId = params.get("sessionId");
        if (!workDir || !sessionId) return "";
        const relPath = uri.path.slice(1);
        return baselineTracker.getBaselineContent(workDir, sessionId, relPath) ?? "";
      },
    }),
  );

  // Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("kimi.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.clearAllState", async () => {
      await context.globalState.update("kimi.config", undefined);
      await context.globalState.update("kimi.mcpServers", undefined);
      await context.workspaceState.update("kimi.mcpEnabled", undefined);
      vscode.window.showInformationMessage("Kimi: All state cleared!");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.openInTab", () => {
      debug("Opening Kimi in new tab");
      provider.createPanel();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.openInSideBar", async () => {
      debug("Opening Kimi in side bar");
      await vscode.commands.executeCommand("kimi.webview.focus");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.focusInput", async () => {
      debug("Focusing Kimi input");
      await vscode.commands.executeCommand("kimi.webview.focus");
      provider.broadcastInternal(WebviewEvent.FocusInput, {});
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.insertMention", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }
      const doc = editor.document;
      const sel = editor.selection;
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      let mention: string;
      if (sel.isEmpty) {
        mention = `@${relPath}`;
      } else {
        const startLine = sel.start.line + 1;
        const endLine = sel.end.line + 1;
        mention = startLine === endLine ? `@${relPath}:${startLine}` : `@${relPath}:${startLine}-${endLine}`;
      }
      debug("Inserting mention: %s", mention);
      await vscode.commands.executeCommand("kimi.webview.focus");
      provider.broadcastInternal(WebviewEvent.InsertMention, { mention });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.newConversation", () => {
      debug("Starting new conversation");
      provider.broadcastInternal(WebviewEvent.StreamEvent, { type: "new_conversation" });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.showLogs", () => {
      outputChannel.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.resetKimi", async () => {
      debug("Resetting Kimi");
      // Would reset all sessions
      vscode.window.showInformationMessage("Kimi has been reset.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kimi.logout", async () => {
      debug("Logging out");
      // Would call logout operation
      vscode.window.showInformationMessage("Kimi: Logged out.");
    }),
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kimi")) {
        const changedKeys: string[] = [];
        const config = getExtensionConfig();
        provider.broadcastInternal(WebviewEvent.ExtensionConfigChanged, {
          config,
          changedKeys,
        });
      }
    }),
  );

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(provider);
}


export function deactivate(): void {
  debug("Kimi Code extension deactivating");
}
