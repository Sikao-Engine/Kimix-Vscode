import type { HostToWebview, WebviewToHost } from "./protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const vscode = window.acquireVsCodeApi?.();

/** Send a typed message to the extension host. */
export function postToHost(msg: WebviewToHost): void {
  vscode?.postMessage(msg);
}

/** Subscribe to typed messages coming from the extension host. */
export function onHostMessage(
  handler: (msg: HostToWebview) => void,
): () => void {
  const listener = (e: MessageEvent) => handler(e.data as HostToWebview);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
