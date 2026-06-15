import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { onConfigChange } from "./config";
import { KimixController } from "./controller/kimixController";
import { Logger } from "./logger";
import { KimixServerStatusBar } from "./serverStatusBar";
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
  const workspaceName =
    vscode.workspace.workspaceFolders?.[0]?.name ?? "no-workspace";
  const pidFilePath = path.join(
    context.globalStorageUri.fsPath,
    "kimix-server",
    `${workspaceName}.json`,
  );
  fs.mkdirSync(path.dirname(pidFilePath), { recursive: true });

  const controller = new KimixController(workspaceRoot, pidFilePath);
  _controller = controller;
  context.subscriptions.push(controller);
  context.subscriptions.push(
    onConfigChange((c) => controller.onConfigChanged(c)),
  );

  const provider = new KimixViewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      KimixViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const statusBar = new KimixServerStatusBar(controller);
  context.subscriptions.push(statusBar);

  registerCommands(context, controller, statusBar);

  Logger.info("KimiX Code activated");
}

function registerCommands(
  context: vscode.ExtensionContext,
  controller: KimixController,
  statusBar: KimixServerStatusBar,
): void {
  const cmd = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd("kimix.newConversation", () => controller.newConversation());
  cmd("kimix.togglePlanMode", () => controller.togglePlanMode());
  cmd("kimix.generatePlan", () => controller.generatePlan());
  cmd("kimix.implementPlan", () => controller.implementPlan());
  cmd("kimix.discardPlan", () => controller.discardPlan());
  cmd("kimix.compactContext", () => controller.compactContext());
  cmd("kimix.restart", () => controller.restart());
  cmd("kimix.showLogs", () => Logger.show());
  cmd("kimix.openInTab", () =>
    KimixTabPanel.createOrShow(context.extensionUri, controller),
  );

  cmd("kimix.startServer", () => controller.startServer());
  cmd("kimix.stopServer", () => controller.stopServer());
  cmd("kimix.restartServer", () => controller.restartServer());
  cmd("kimix.showServerMenu", () => statusBar.showMenu());
}

export async function deactivate(): Promise<void> {
  Logger.info("KimiX Code deactivated");
  if (_controller) {
    await _controller.dispose();
  }
}
