# AGENTS.md — KimiX Code Project Guide

Orientation for AI agents & new developers: project structure, architecture, layering rules, and doc references.

---

## 1. What is KimiX Code?

A **VS Code extension** for AI-assisted, in-repo development. Drives an **opencode-compatible** server over HTTP + SSE. **No API-key dependency** — only a configurable executable (`kimix.executable`, default `opencode`).

**Features:** model/agent selection from server catalogue · full Plan Mode (planner agent, persisted plan file, review loop, one-click implement) · context compaction · session management · streaming text/reasoning/tool calls over SSE with auto-reconnect · inline permission prompts · sidebar + editor tab sharing one state.

---

## 2. Monorepo Layout

```
kimix-vscode/
├── package.json              # Root workspace (@sikao-engine/kimix-vscode)
├── pnpm-workspace.yaml       # packages/*
├── tsconfig.json / vitest.config.ts / esbuild.js / dev.js
├── README.md / AGENTS.md
├── scripts/                  # build-with-deps.js, bump-version.js
├── assets/test-workspace/
├── .vscode/                  # launch.json, tasks.json
├── docs/                     # ARCHITECTURE | PROTOCOL | WEBVIEW | SESSIONS | TESTING
└── packages/
    ├── vscode-ext/           # Extension host (Node, esbuild)
    └── webview-ui/           # React + Vite + Zustand frontend
```

---

## 3. Package: `vscode-ext` (Extension Host)

Bundled via esbuild → `dist/extension.js`. Runs inside VS Code's Node process.

```
packages/vscode-ext/
├── package.json / tsconfig.json / esbuild.js / vitest.config.ts / eslint.config.mjs
├── resources/kimi-icon.svg
└── src/
    ├── extension.ts              # activate() + command registration
    ├── config.ts                 # Reads kimix.* settings
    ├── logger.ts                 # OutputChannel singleton
    ├── controller/
    │   └── kimixController.ts    # Orchestrator + webview message bridge
    ├── protocol/
    │   ├── types.ts              # Session, Agent, Provider, Message wire types
    │   ├── sseParser.ts          # SSE line parser + opencode event decoder
    │   ├── client.ts             # HTTP+SSE client (native fetch, no vscode)
    │   └── messages.ts           # Host↔Webview message contract
    ├── server/
    │   ├── serverProcess.ts      # Low-level spawn, port alloc, health poll, process-tree cleanup
    │   └── serverManager.ts      # Lifecycle manager: PID file, reuse, own, exit safety net
    ├── session/
    │   └── sessionManager.ts     # Active stream + session list
    ├── plan/
    │   ├── planManager.ts        # Plan-mode orchestrator (no vscode import)
    │   └── planPrompts.ts        # Pure prompt templates
    └── webview/
        └── webviewManager.ts     # Sidebar provider + tab panel + HTML/CSP
```

**Key design rules:**
- `protocol/*`, `session/*`, `server/*` **import zero `vscode`** — unit-testable with plain Vitest.
- **Strict one-way dependency:**

  ```
  extension.ts
    └─ controller
         ├─ server/ServerProcess
         ├─ protocol/OpencodeClient  ← no vscode
         │    └─ sseParser           ← no vscode (pure functions)
         ├─ session/SessionManager   ← no vscode
         └─ plan/PlanManager         ← no vscode
    └─ webview/webviewManager → controller (message bridge)
  ```

### Tests (`tests/`)

| File | Covers |
|------|--------|
| `__mocks__/vscode.ts` | Minimal VS Code API mock (Disposable, EventEmitter) |
| `sseParser.test.ts` | SSE line buffering, chunk splits, event decoding |
| `client.test.ts` | HTTP client, session mapping, permission fallback (mocked fetch) |
| `sessionManager.test.ts` | List refresh, stream→event emission, lazy session |
| `serverProcess.test.ts` | Lifecycle tests |

---

## 4. Package: `webview-ui` (Frontend)

React 19 + Vite 6 + Zustand. Built to `dist/webview.js`; CSS inlined via `vite-plugin-css-injected-by-js`.

```
packages/webview-ui/
├── package.json / tsconfig.json / vite.config.ts / index.html
├── scripts/copyToExt.js        # Copies dist/ → vscode-ext/dist + assets/
└── src/
    ├── main.tsx                # Entry: createRoot
    ├── App.tsx                 # Root component: toolbar + session list + chat + permission
    ├── store.ts                # Zustand store: applyHostMessage + actions
    ├── protocol.ts             # Webview-side message types (mirrors messages.ts)
    ├── vscodeApi.ts            # Typed acquireVsCodeApi() wrapper
    ├── styles.css              # All styles (JS-injected)
    ├── markdown/
    │   └── markdown.ts         # Markdown parsing + sanitization (marked + DOMPurify)
    └── components/
        ├── Toolbar.tsx         # Agent/model/session pickers, Plan Mode, reasoning collapse, server controls
        ├── MessageList.tsx     # Persisted messages + streaming bubbles + tool calls + timestamps + model labels
        ├── MarkdownRenderer.tsx # Renders assistant text as sanitized Markdown HTML
        ├── Composer.tsx        # Prompt textarea + @ mentions + attachments + Send/Stop
        ├── MentionPicker.tsx   # File/symbol search results for @ mentions
        ├── PendingQueue.tsx    # Queued prompts shown above composer
        ├── ReasoningBlock.tsx  # Collapsible reasoning/thinking cards
        └── PermissionPrompt.tsx # Allow once / Always / Reject bar
```

**Architecture:** single Zustand store. `applyHostMessage` reduces `HostToWebview` messages; `actions.*` are thin `postToHost` wrappers. `streamText` merges into current bubble; `streamTool` upserts tool rows by `callID`; `streamIdle` triggers `refresh`. Transport via `vscodeApi.ts` (typed `postToHost`/`onHostMessage`). **Webview never talks to server directly** — all through controller's typed bridge. The status bar shows the active plan phase when Plan Mode is in progress.

---

## 5. Build & Development

```bash
pnpm install                    # Setup
pnpm build-ext                  # Full build: webview → copy → esbuild
pnpm package-ext                # Package .vsix

node esbuild.js                 # Watch extension
pnpm --filter kimix-vscode-ext run test        # Unit tests
pnpm --filter kimix-vscode-ext run test:watch  # Watch mode
pnpm --filter kimix-vscode-ext run test:coverage
pnpm --filter kimix-vscode-ext run typecheck   # tsc --noEmit
pnpm --filter kimix-vscode-ext run lint        # ESLint
```

Press `F5` in `packages/vscode-ext` for Extension Dev Host.

**Build pipeline:**
```
webview-ui: tsc && vite build       → dist/webview.js
copyToExt.js: copy dist/             → vscode-ext/dist + assets/
esbuild.js:   bundle src/extension.ts → vscode-ext/dist/extension.js
```

**Artifacts:** `dist/extension.js` (host), `dist/webview.js` (frontend), `dist/index.html` (webview HTML).

---

## 6. Architecture

### Data Flow (single prompt)

```
Composer → postToHost(sendPrompt) → KimixController.dispatch
  → SessionManager.sendPrompt → OpencodeClient.sendPromptAsync (POST 204)

Server streams over GET /event (global SSE)
  → OpencodeClient.streamEvents (auto-reconnect, filter by sessionID)
  → sseParser.parseEvent → SessionManager emits text/tool/idle/permission
  → KimixController.post → webview.postMessage
  → store.applyHostMessage → React re-render
```

### Extension Lifecycle

```
activate() → KimixController → ServerLifecycleManager.start()
  → read PID file → probe base port → (reuse | spawn on free port) → write PID file
deactivate() → KimixController.dispose() → ServerLifecycleManager.stop()
  → killWindows(): taskkill /t /f  |  killUnix(): SIGTERM → 3s → SIGKILL
Process-exit safety: process.on('exit'|'SIGTERM'|'SIGINT'|'SIGHUP') → kill() + unlink PID file
```

### Configuration (`kimix.*`)

| Setting | Default | Purpose |
|---------|---------|---------|
| `kimix.executable` | `opencode` | Server CLI name or path |
| `kimix.host` | `127.0.0.1` | Bind host |
| `kimix.basePort` | `4096` | Starting port (scans upward) |
| `kimix.autoFallbackPort` | `true` | Automatically fall back to the next free port when the base port is occupied |
| `kimix.environmentVariables` | `{}` | Extra env for server process |
| `kimix.showThinking` | `true` | Show reasoning in UI |
| `kimix.autoScroll` | `true` | Auto-scroll during streaming |
| `kimix.enableMentions` | `true` | Enable @ file/symbol mentions |
| `kimix.planModeEnabled` | `true` | Enable full plan-mode workflow |
| `kimix.planFilePath` | `.kimix/plan.md` | Relative path for generated plans |
| `kimix.planAgent` | `""` | Agent name for planning; empty = auto-detect/fallback |
| `kimix.planMaxAttempts` | `3` | Max plan generation/revision attempts |
| `kimix.openPlanFileAfterGeneration` | `true` | Open plan file in editor after planning |

---

## 7. Message Contract

Mirrored files — **keep in sync**: `vscode-ext/src/protocol/messages.ts` ⇄ `webview-ui/src/protocol.ts`

**Webview → Host:** `ready` · `sendPrompt` · `generatePlan` · `revisePlan` · `implementPlan` · `discardPlan` · `abort` · `newSession` · `selectSession` · `deleteSession` · `selectAgent` · `selectModel` · `setPlanMode` · `compactContext` · `respondPermission` · `refresh` · `requestFileList` · `requestWorkspaceSymbols` · `openPlanFile`

**Host → Webview:** `state` (full UIState snapshot incl. `planState`) · `planState` · `messages` · `streamText` · `streamTool` · `streamIdle` · `permission` · `error` · `fileList` · `workspaceSymbols` · `aborted` · `completion`

`sendPrompt`/`abort` carry an optional `turnId`; streaming replies echo it so
the webview can discard stale events after stop or a queued follow-up.

Host always pushes **complete UIState** (no partial diffs) — webview is a pure projection.

---

## 8. HTTP/SSE Protocol

Server spawn: `<executable> serve --hostname <host> --port <port>`

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/global/health` | Health check |
| GET/POST | `/session` | List / Create sessions |
| GET/DELETE | `/session/:id` | Get / Delete session |
| GET | `/session/:id/message` | Transcript |
| POST | `/session/:id/prompt_async` | Fire-and-forget prompt (204) |
| POST | `/session/:id/abort` | Abort running turn |
| POST | `/session/:id/summarize` | Compact context |
| GET | `/agent` | List agents |
| GET | `/config/providers` | List providers + models |
| POST | `/permission/:permId/reply` | Permission reply |

### SSE (`GET /event`)

**Global stream** — emits events for all sessions. Parser filters by `sessionID`.

Two-stage parsing (`sseParser.ts`):
1. **`SSELineParser`** — incremental line buffer, emits `RawSSEEvent` on blank lines. Handles chunk splits, multi-line `data:`, comments, leading-space rule.
2. **`parseEvent(raw, sessionId)`** — decodes JSON → `ParsedEvent`: `text` · `reasoning` · `tool` · `permission` · `step-start` · `step-finish` · `session-idle` · `skip`

Client reconnects up to 5× with linear backoff, yields `reconnected` event before each retry.

---

## 9. Session Management

`SessionManager` owns: session list (cached from `GET /session`) + exactly **one** live SSE subscription (current session only).

**Behaviours:**
- Switching sessions tears down old stream, starts new one.
- `sendPrompt` with no active session auto-creates one (lazy).
- **Plan Mode** is orchestrated host-side by `PlanManager`. It creates a dedicated planning session (or falls back to prompt decoration), streams the plan to a workspace plan file, and exposes **Implement / Revise / Discard** affordances. On **Implement** the plan is sent to the regular worker session and the mode switches back to build.
- **Compact** calls `POST /session/:id/summarize` with selected model.

---

## 10. Process Cleanup (Five-Layer Safety Net)

`ServerLifecycleManager` prevents orphaned child processes:

1. **One manager per workspace** — only one `opencode serve` child is tracked at a time.
2. **Explicit `stop()` / `dispose()`** — terminates the entire process tree.
3. **Graceful-then-forceful** — SIGTERM/taskkill first, then SIGKILL/taskkill after grace period.
4. **Persisted PID file** — `<globalStorage>/kimix-server/<workspace>.json` lets the next activation adopt or clean up a leftover process.
5. **Process-exit safety** — synchronous `process.on('exit'|'SIGTERM'|'SIGINT'|'SIGHUP')` cleanup unlinks the PID file and kills the owned child.

---

## 11. Document Reference

| File | Description |
|------|-------------|
| `docs/ARCHITECTURE.md` | Layering, data flow, lifecycle, config |
| `docs/PROTOCOL.md` | HTTP/SSE, endpoints, SSE events, message contract |
| `docs/WEBVIEW.md` | Webview surfaces, CSP, frontend architecture, build pipeline |
| `docs/SESSIONS.md` | Session lifecycle, streaming, plan mode, compaction |
| `docs/TESTING.md` | Unit tests, static checks, acceptance checklist |
| `README.md` | Overview, features, quick start |

---

## 12. AI Agent Rules

- **Keep `messages.ts` (host) and `protocol.ts` (webview) in sync** — mirror files.
- **No `vscode` imports in `protocol/`, `session/`, or `server/`** — breaks unit testability.
- **Webview never imports Node modules** — `protocol.ts` is self-contained.
- **Tests in `packages/vscode-ext/tests/`** — Vitest, `vscode` mock at `__mocks__/vscode.ts` (aliased in root `vitest.config.ts`).
- **Build order**: webview-ui must build before vscode-ext. `build-ext` handles this.
- **If you change architecture, update `docs/*.md` and `AGENTS.md`** to stay in sync.
