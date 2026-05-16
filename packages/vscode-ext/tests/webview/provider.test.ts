import { describe, it, expect, vi, beforeEach } from "vitest";
import { KimiWebviewProvider } from "../../src/webview/provider";
import { WebviewEvent } from "../../src/protocol/types";
import { Uri, window, MementoMock } from "../__mocks__/vscode";

describe("KimiWebviewProvider", () => {
  let provider: KimiWebviewProvider;
  let memento: MementoMock;

  beforeEach(() => {
    memento = new MementoMock();
    provider = new KimiWebviewProvider(Uri.file("/extension"), memento, vi.fn());
  });

  it("disposes without error", () => {
    provider.dispose();
  });

  it("creates panel with correct options", () => {
    provider.createPanel();
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      "kimi.webview",
      "Kimi Code",
      expect.any(Number),
      expect.objectContaining({ enableScripts: true })
    );
  });

  it("broadcastInternal sends to specific webview", () => {
    provider.createPanel();
    const webviews = (provider as any).webviews as Map<string, any>;
    const [webviewId, panel] = webviews.entries().next().value!;
    provider.broadcastInternal(WebviewEvent.FocusInput, {}, webviewId);
    expect(panel.webview.postMessage).toHaveBeenCalled();
  });

  it("broadcastInternal sends to all webviews when no id", () => {
    provider.createPanel();
    provider.createPanel();
    const webviews = (provider as any).webviews as Map<string, any>;
    provider.broadcastInternal(WebviewEvent.FocusInput, {});
    for (const [, panel] of webviews) {
      expect(panel.webview.postMessage).toHaveBeenCalled();
    }
  });

  it("getNonce returns 32-character string", () => {
    const nonce = (provider as any).getNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBe(32);
  });

  it("getHtmlForWebview includes CSP and script nonce", () => {
    const webview = {
      cspSource: "vscode-resource:",
      asWebviewUri: vi.fn((uri: any) => uri),
    } as any;
    const html = (provider as any).getHtmlForWebview(webview, "base", "id", "nonce123", "script.js");
    expect(html).toContain("nonce-nonce123");
    expect(html).toContain("script.js");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("data-webviewid=\"id\"");
  });
});
