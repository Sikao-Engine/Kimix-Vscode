import * as vscode from "vscode";
import { onConfigChange } from "./config";
import { KimixController } from "./controller/kimixController";
import { Logger } from "./logger";
import {
  KimixTabPanel,
  KimixViewProvider,
} from "./webview/webviewManager";

let _controller: KimixController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  Logger.configure("KimiX Code", "debug");
  Logger.info("activating KimiX Code");

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  const controller = new KimixController(workspaceRoot);
  _controller = controller;
  context.subscriptions.push(controller);
  context.subscriptions.push(onConfigChange((c) => controller.onConfigChanged(c)));

  const provider = new KimixViewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      KimixViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  registerCommands(context, controller);

  Logger.info("KimiX Code activated");
}

function registerCommands(
  context: vscode.ExtensionContext,
  controller: KimixController,
): void {
  const cmd = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd("kimix.newConversation", () => controller.newConversation());
  cmd("kimix.togglePlanMode", () => controller.togglePlanMode());
  cmd("kimix.compactContext", () => controller.compactContext());
  cmd("kimix.restart", () => controller.restart());
  cmd("kimix.showLogs", () => Logger.show());
  cmd("kimix.openInTab", () =>
    KimixTabPanel.createOrShow(context.extensionUri, controller),
  );
}

export async function deactivate(): Promise<void> {
  Logger.info("KimiX Code deactivated");
  // Explicitly dispose the controller as a fallback.
  // The controller is also registered via context.subscriptions.push(controller),
  // but calling dispose() here ensures cleanup even if VS Code's disposal mechanism
  // is not reliable during abrupt shutdowns.
  if (_controller) {
    await _controller.dispose();
  }
}
