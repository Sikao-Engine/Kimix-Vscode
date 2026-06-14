import * as vscode from "vscode";
import { KimixController } from "../controller/kimixController";
import { WebviewToHost } from "../protocol/messages";

/**
 * Builds the webview HTML and wires a single webview (sidebar view or tab
 * panel) to the controller's message bridge. Returned disposable detaches the
 * listeners.
 */
export function attachWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  controller: KimixController,
): vscode.Disposable {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
  };
  webview.html = buildHtml(webview, extensionUri);

  const fromUI = webview.onDidReceiveMessage((msg: WebviewToHost) => {
    void controller.handleMessage(msg);
  });
  const toUI = controller.onMessage((msg) => {
    void webview.postMessage(msg);
  });

  return new vscode.Disposable(() => {
    fromUI.dispose();
    toUI.dispose();
  });
}

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
  );
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `connect-src ${webview.cspSource}`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>KimiX Code</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function makeNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * The sidebar view provider. VS Code instantiates the webview lazily when the
 * KimiX activity-bar view is first revealed.
 */
export class KimixViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "kimix.webview";
  private disposable: vscode.Disposable | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: KimixController,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposable = attachWebview(
      view.webview,
      this.extensionUri,
      this.controller,
    );
    view.onDidDispose(() => this.disposable?.dispose());
  }
}

/**
 * Manages the optional "open in tab" editor panel. Only one tab is kept; a
 * second invocation reveals the existing one.
 */
export class KimixTabPanel {
  private static current: KimixTabPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposable: vscode.Disposable;

  static createOrShow(
    extensionUri: vscode.Uri,
    controller: KimixController,
  ): void {
    if (KimixTabPanel.current) {
      KimixTabPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "kimix.tab",
      "KimiX Code",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    KimixTabPanel.current = new KimixTabPanel(panel, extensionUri, controller);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    controller: KimixController,
  ) {
    this.panel = panel;
    this.disposable = attachWebview(
      panel.webview,
      extensionUri,
      controller,
    );
    panel.onDidDispose(() => {
      this.disposable.dispose();
      KimixTabPanel.current = undefined;
    });
  }
}
