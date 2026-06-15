import * as vscode from "vscode";
import { KimixController, ServerStatusInfo } from "./controller/kimixController";

/**
 * Renders a status-bar item that reflects the current server state and opens a
 * quick-pick menu on click.
 */
export class KimixServerStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly controller: KimixController) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "kimix.showServerMenu";
    this.update(controller.getServerStatus());

    controller.onDidChangeServerStatus((s) => this.update(s));

    this.item.show();
  }

  showMenu(): void {
    const status = this.controller.getServerStatus();
    const running = status.status === "running";
    const items: vscode.QuickPickItem[] = [
      {
        label: "$(play) Start Server",
        description: running ? "already running" : undefined,
      },
      {
        label: "$(debug-stop) Stop Server",
        description: !running ? "not running" : undefined,
      },
      { label: "$(refresh) Restart Server" },
      { label: "$(output) Show Logs" },
    ];

    if (status.info) {
      items.unshift({
        label: `Server: ${status.status}`,
        description: `port ${status.info.port}${status.info.pid ? ` · pid ${status.info.pid}` : ""}`,
      });
    }

    vscode.window.showQuickPick(items, { title: "KimiX Server" }).then((picked) => {
      if (!picked) {
        return;
      }
      switch (picked.label) {
        case "$(play) Start Server":
          this.controller.startServer().catch(() => {
            // errors are surfaced via the UI state
          });
          break;
        case "$(debug-stop) Stop Server":
          this.controller.stopServer().catch(() => {
            // errors are surfaced via the UI state
          });
          break;
        case "$(refresh) Restart Server":
          this.controller.restartServer().catch(() => {
            // errors are surfaced via the UI state
          });
          break;
        case "$(output) Show Logs":
          vscode.commands.executeCommand("kimix.showLogs");
          break;
      }
    });
  }

  private update(status: ServerStatusInfo): void {
    const { info } = status;
    switch (status.status) {
      case "running":
        this.item.text = `$(server) KimiX ${info?.port ?? ""}`;
        this.item.tooltip = `KimiX server running on port ${info?.port ?? "unknown"}${info?.pid ? ` (PID ${info.pid})` : ""}${info?.reused ? " · reused" : ""}`;
        this.item.backgroundColor = undefined;
        break;
      case "starting":
        this.item.text = `$(sync~spin) KimiX`;
        this.item.tooltip = "KimiX server is starting…";
        break;
      case "error":
        this.item.text = `$(error) KimiX`;
        this.item.tooltip = status.error ?? "KimiX server error";
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        );
        break;
      default:
        this.item.text = `$(circle-slash) KimiX`;
        this.item.tooltip = "KimiX server stopped";
        this.item.backgroundColor = undefined;
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
