import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { BridgeHandler } from "../bridge/handler";
import { WebviewEvent, RpcRequest, RpcResponse } from "../protocol/types";

export class KimiWebviewProvider implements vscode.WebviewViewProvider {
  private webviews = new Map<string, vscode.WebviewPanel>();
  private bridgeHandler: BridgeHandler;

  constructor(
    private extensionUri: vscode.Uri,
    workspaceState: vscode.Memento,
    private showLogs: () => void,
  ) {
    this.bridgeHandler = new BridgeHandler(
      this.broadcastInternal.bind(this),
      workspaceState,
      this.reloadWebview.bind(this),
      showLogs,
    );
  }

  dispose(): void {
    this.bridgeHandler.dispose();
    for (const panel of this.webviews.values()) {
      panel.dispose();
    }
    this.webviews.clear();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    const webviewId = `sidebar_${randomUUID()}`;
    this.setupWebview(webviewId, webviewView.webview);
  }

  createPanel(): void {
    const webviewId = `panel_${randomUUID()}`;
    const panel = vscode.window.createWebviewPanel(
      "kimi.webview",
      "Kimi Code",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );
    this.webviews.set(webviewId, panel);
    this.setupWebview(webviewId, panel.webview);

    panel.onDidDispose(() => {
      this.bridgeHandler.disposeView(webviewId);
      this.webviews.delete(webviewId);
    });
  }

  private setupWebview(webviewId: string, webview: vscode.Webview): void {
    const nonce = this.getNonce();
    const baseUri = webview.asWebviewUri(this.extensionUri).toString();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );

    webview.html = this.getHtmlForWebview(webview, baseUri, webviewId, nonce, scriptUri.toString());

    webview.onDidReceiveMessage(async (message: { type: string; payload: RpcRequest }) => {
      if (message.type === "rpc") {
        const response = await this.bridgeHandler.handle(message.payload, webviewId);
        webview.postMessage({ type: "rpc", payload: response });
      }
    });
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    baseUri: string,
    webviewId: string,
    nonce: string,
    scriptSrc: string,
  ): string {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `media-src ${webview.cspSource} data: blob:`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Kimi Code</title>
</head>
<body data-baseuri="${baseUri}" data-webviewid="${webviewId}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
  }

  broadcastInternal(event: WebviewEvent, payload: unknown, webviewId?: string): void {
    if (webviewId) {
      const panel = this.webviews.get(webviewId);
      if (panel) {
        panel.webview.postMessage({ type: "event", payload: { type: event, payload } });
      }
    } else {
      for (const panel of this.webviews.values()) {
        panel.webview.postMessage({ type: "event", payload: { type: event, payload } });
      }
    }
  }

  private reloadWebview(webviewId: string): void {
    const panel = this.webviews.get(webviewId);
    if (panel) {
      // Trigger reload by resetting HTML
      const nonce = this.getNonce();
      const baseUri = panel.webview.asWebviewUri(this.extensionUri).toString();
      const scriptUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"))
        .toString();
      panel.webview.html = this.getHtmlForWebview(
        panel.webview,
        baseUri,
        webviewId,
        nonce,
        scriptUri,
      );
    }
  }

  private getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
