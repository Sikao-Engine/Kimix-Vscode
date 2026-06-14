# WebView Management

## Surfaces

KimiX renders the same React app in two places:

1. **Sidebar view** (`kimix.webview`) — registered through
   `KimixViewProvider` (a `WebviewViewProvider`) and shown in the KimiX
   activity-bar container. `retainContextWhenHidden` keeps state alive when the
   panel is collapsed.
2. **Editor tab** (`kimix.tab`) — opened via the `KimiX: Open in New Tab`
   command. `KimixTabPanel` is a singleton: a second invocation reveals the
   existing panel instead of creating another.

Both attach to the controller through the **same** `attachWebview` helper, so a
sidebar and a tab observe identical state simultaneously.

Source: `src/webview/webviewManager.ts`.

## The message bridge

`attachWebview(webview, extensionUri, controller)`:

- sets `enableScripts: true` and locks `localResourceRoots` to `dist/`;
- builds the HTML with a strict **CSP** and a per-load `nonce`;
- forwards `webview.onDidReceiveMessage` → `controller.handleMessage`;
- subscribes to `controller.onMessage` → `webview.postMessage`;
- returns a `Disposable` that detaches both listeners on view/panel dispose.

Multiple webviews can attach; the controller fans every `HostToWebview` message
out to all current listeners (`KimixController.post`).

## Content Security Policy

```
default-src 'none';
style-src  {cspSource} 'unsafe-inline';
script-src 'nonce-{nonce}';
font-src   {cspSource};
img-src    {cspSource} https: data:;
connect-src {cspSource};
```

The bundle is loaded as `dist/webview.js` resolved through
`webview.asWebviewUri`. CSS is inlined into the JS bundle
(`vite-plugin-css-injected-by-js`) so no separate stylesheet host is required.

## Frontend architecture

- **State**: a single Zustand store (`store.ts`). `applyHostMessage` reduces
  incoming `HostToWebview` messages; `actions.*` are thin `postToHost` wrappers.
- **Streaming**: `streamText` appends/merges into the current streaming bubble;
  `streamTool` upserts tool-call rows keyed by `callID`; `streamIdle` finalises
  the turn and requests a transcript `refresh`.
- **Transport**: `vscodeApi.ts` wraps `acquireVsCodeApi()` with typed
  `postToHost` / `onHostMessage`.

## Build pipeline

```
webview-ui:  tsc && vite build          → packages/webview-ui/dist/webview.js
copyToExt.js: copy dist → vscode-ext/dist (+ assets)
esbuild.js:  bundle src/extension.ts    → vscode-ext/dist/extension.js
```

The extension serves `dist/webview.js`; `dist/extension.js` is the activated
entry (`main` in package.json).
