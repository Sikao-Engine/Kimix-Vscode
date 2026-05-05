import { describe, it, expect, vi, beforeEach } from "vitest";
import { KimiWebviewProvider } from "../../src/webview/provider";
import { Uri, window, workspace, MementoMock } from "../__mocks__/vscode";
import { RpcMethod } from "../../src/protocol/types";

describe("KimiWebviewProvider expanded", () => {
  let provider: KimiWebviewProvider;
  let memento: MementoMock;

  beforeEach(() => {
    memento = new MementoMock();
    provider = new KimiWebviewProvider(Uri.file("/extension"), memento, vi.fn());
  });

  it("resolveWebviewView sets up webview with html", () => {
    const webviewView = {
      webview: {
        html: "",
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: "vscode-resource:",
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
    } as any;
    provider.resolveWebviewView(webviewView, {} as any, {} as any);
    expect(webviewView.webview.html).toContain("<!DOCTYPE html>");
    expect(webviewView.webview.html).toContain('id="root"');
  });

  it("handles rpc messages from webview", async () => {
    const postMessage = vi.fn();
    const webviewView = {
      webview: {
        html: "",
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: "vscode-resource:",
        postMessage,
        onDidReceiveMessage: vi.fn((cb: any) => {
          setTimeout(() => {
            cb({
              type: "rpc",
              payload: { id: 1, method: RpcMethod.CheckWorkspace },
            });
          }, 0);
          return { dispose: vi.fn() };
        }),
      },
    } as any;
    provider.resolveWebviewView(webviewView, {} as any, {} as any);
    await new Promise((r) => setTimeout(r, 10));
    expect(postMessage).toHaveBeenCalled();
    const call = postMessage.mock.calls[0][0];
    expect(call.type).toBe("rpc");
    expect(call.payload.id).toBe(1);
  });

  it("panel disposes correctly", () => {
    provider.createPanel();
    const webviews = (provider as any).webviews as Map<string, any>;
    const [_, panel] = webviews.entries().next().value!;
    const disposeFn = panel.onDidDispose.mock.calls[0][0];
    disposeFn();
    expect(webviews.size).toBe(0);
  });

  it("creates multiple panels with unique ids", () => {
    provider.createPanel();
    provider.createPanel();
    const webviews = (provider as any).webviews as Map<string, any>;
    expect(webviews.size).toBe(2);
  });
});
