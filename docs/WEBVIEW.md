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
  the turn and requests a transcript `refresh`. Each streaming turn carries a
  `turnId`; stale events for an already-stopped turn are ignored.
- **Pending queue**: while the model is busy, new prompts are queued locally and
  shown in `PendingQueue` above the composer. The locked item is submitted
  automatically when the current turn ends.
- **Reasoning**: reasoning parts render inside collapsible `ReasoningBlock`
  cards. A global collapse/expand toggle is available in the toolbar.
- **Mentions**: typing `@` in `Composer` opens `MentionPicker`, which queries
  the host for workspace files and symbols. Selected items become attachment
  chips and are formatted as `@path` references in the sent prompt.
- **Transport**: `vscodeApi.ts` wraps `acquireVsCodeApi()` with typed
  `postToHost` / `onHostMessage`.

## Components

| Component | Purpose |
| --------- | ------- |
| `Toolbar` | Agent/model/session pickers, plan mode, reasoning collapse, server controls |
| `MessageList` | Persisted transcript + streaming bubble, timestamps, model labels, auto-scroll |
| `ReasoningBlock` | Collapsible reasoning/thinking content |
| `PendingQueue` | Queued prompts shown above the composer |
| `Composer` | Auto-resizing textarea, @ mentions, attachment chips, Send/Stop |
| `MentionPicker` | File/symbol search results for `@` mentions |
| `PermissionPrompt` | Allow once / Always / Reject bar |

## Build pipeline

```
webview-ui:  tsc && vite build          → packages/webview-ui/dist/webview.js
copyToExt.js: copy dist → vscode-ext/dist (+ assets)
esbuild.js:  bundle src/extension.ts    → vscode-ext/dist/extension.js
```

The extension serves `dist/webview.js`; `dist/extension.js` is the activated
entry (`main` in package.json).

## Tests

`packages/webview-ui/tests/` runs with Vitest + jsdom. Store logic (pending
queue, reasoning collapse, turn-id filtering) is covered without needing the
full VS Code webview environment.
