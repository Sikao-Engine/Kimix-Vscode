# Server Lifecycle Management Design

> How KimiX Code owns, discovers, reuses and reliably destroys an `opencode serve` child process.

## 1. Goals

1. **No leaked processes** — every process we spawn is tracked and terminated when the extension shuts down (explicit `deactivate()`, extension-host crash, SIGTERM/SIGINT, etc.).
2. **Detect and reuse existing processes** — on startup we first look for a process that is already listening on the configured port. If it is healthy we either:
   - **adopt** it (it is a leftover from a previous extension instance),
   - **silently fall back** to the next free port (it is a foreign process and `kimix.autoFallbackPort` is `true`, the default), or
   - **prompt the user** to reuse / stop / start on another port (only when `kimix.autoFallbackPort` is `false`).
3. **Foreground management** — users can start, stop and restart the server from the command palette, the status bar and the webview toolbar.
4. **Crash safety** — a persisted PID/state file lets the next extension activation clean up orphans left by an abrupt shutdown.
5. **Testability** — the core lifecycle manager imports no `vscode` code and can be unit-tested with mocked file-system, child-process and network APIs.

## 2. Architecture

```text
extension.ts
    ├─ KimixServerStatusBar  (vscode-only, UI)
    └─ KimixController
         ├─ ServerLifecycleManager  (no vscode, owns spawn/kill/PID file)
         │    └─ ServerProcess      (no vscode, low-level child process)
         ├─ OpencodeClient
         └─ SessionManager
```

### 2.1 Responsibilities

| Component | Role |
|---|---|
| `ServerProcess` | Spawns `<executable> serve`, polls `/global/health`, kills the process tree, exposes `status`/`port`/`pid`. |
| `ServerLifecycleManager` | Owns the **one** server for this workspace. Reads/writes the PID file, decides *attach / reuse / spawn / error*, handles process-exit safety net, guards concurrent start/stop. |
| `KimixController` | Bridges manager decisions to the UI. Shows user prompts for foreign processes, exposes `startServer`/`stopServer`/`restartServer`, forwards server info to the webview. |
| `KimixServerStatusBar` | Renders a status-bar item and quick-pick menu. |
| Webview toolbar | Displays server status, port, owner flag and start/stop/restart buttons. |

## 3. PID / state file

Location: `<globalStoragePath>/kimix-server/<workspace-slug>.json`.

```json
{
  "pid": 12345,
  "port": 4096,
  "token": "<extension-instance-token>",
  "startedAt": "2026-01-10T12:34:56.789Z"
}
```

- `token` is generated per `ServerLifecycleManager` instance. It lets us distinguish *our* current child from a child left behind by a crashed extension host.
- On every successful owned start we **overwrite** the file.
- On `stop()` / `dispose()` / process-exit cleanup we **delete** the file.
- A stale file (PID dead or port unhealthy) is removed automatically.

## 4. Start-up decision flow

```
start()
│
├─ Already running? → return started
│
├─ Load PID file
│   ├─ PID alive AND /global/health healthy on recorded port
│   │   → adopt (overwrite token) → return started(owned=true, reused=true)
│   └─ else → delete stale PID file
│
├─ Probe configured basePort /global/health
│   ├─ healthy but no PID file → foreign process
│   │   → skip occupied port → findFreePort(..., avoid={basePort})
│   └─ unhealthy / port free → continue
│
├─ findFreePort(basePort, avoid={occupied ports}) → spawn new process
│   ├─ health OK → write PID file → return started(owned=true, reused=false)
│   └─ health failed → kill child → return error
```

### User choices when a foreign process is detected

When `kimix.autoFallbackPort` is `false`, the controller shows an information message with three actions:

1. **Reuse** — `manager.start({ reuseForeign: true })`. The extension attaches to the foreign server but does **not** own it; it will not be killed on extension exit.
2. **Stop it & start new** — `manager.start({ killForeign: true })`. The manager finds the PID by port, kills the process tree, then spawns a new owned server.
3. **Start on another port** — `manager.start({ fallbackToNextPort: true })`. The manager ignores the foreign listener, scans upward for a free port and spawns there.

When `kimix.autoFallbackPort` is `true` (the default), the manager performs action 3 automatically without prompting.

## 5. Stop / disposal guarantees

`ServerLifecycleManager.stop()`:

1. Acquires a lifecycle lock so concurrent `start()`/`stop()` cannot race.
2. If the process is owned, terminates the entire process tree:
   - **Windows**: `taskkill /pid <pid> /t /f` (best-effort).
   - **Unix**: SIGTERM to the process group, wait up to 3 s, then SIGKILL.
3. Deletes the PID file.
4. Clears internal state.

### Abrupt shutdown safety net

When an owned process is running we register a **synchronous** Node process-exit handler:

- `process.on('exit')`, `SIGTERM`, `SIGINT`, `SIGHUP`.
- In the handler we perform **only synchronous** cleanup:
  - `fs.unlinkSync(pidFile)`.
  - `spawnSync('taskkill', …)` on Windows or `process.kill(-pid, 'SIGKILL')` on Unix.
- This best-effort cleanup dramatically reduces the chance of orphaned `opencode serve` processes after an extension-host crash.

## 6. Foreground controls

### Command palette

| Command | Action |
|---|---|
| `KimiX: Start Server` | `controller.startServer()` |
| `KimiX: Stop Server` | `controller.stopServer()` |
| `KimiX: Restart Server` | `controller.restartServer()` |
| `KimiX: Show Server Menu` | Status-bar quick pick |

### Status bar

A single status-bar item shows:

- `$(server)` + port while running.
- `$(sync~spin) Starting…` while starting.
- `$(error) Server error` on error.
- `$(circle-slash) Stopped` when stopped.

Clicking it opens a quick-pick menu with Start / Stop / Restart / Show Logs.

### Webview toolbar

The toolbar displays a compact status chip:

```
[Agent] [Model] [Plan/Build] [Compact] [New] [🟢 4096 ■]
```

- Green / amber / red dot reflects status.
- The number is the current port.
- The square button stops the server; a play button appears when stopped.
- A circular-arrow button restarts.

## 7. Host ↔ Webview protocol additions

### `WebviewToHost`

Add:

- `{ type: "startServer" }`
- `{ type: "stopServer" }`
- `{ type: "restartServer" }`

### `UIState`

Add an optional `serverInfo` field:

```ts
export interface ServerInfo {
  port?: number;
  pid?: number;
  owned: boolean;   // true if the extension can/will kill it on exit
  reused: boolean;  // true if it was adopted from a previous session or foreign process
}

export interface UIState {
  status: "stopped" | "starting" | "running" | "error";
  serverError?: string;
  serverInfo?: ServerInfo;
  // ... existing fields
}
```

The host sends a full `state` message whenever server status changes, so the webview always reflects the current port and ownership.

## 8. Concurrency rules

- `ServerLifecycleManager` keeps a `_lifecycleLock` promise. Calls to `start()`/`stop()`/`restart()` are serialized.
- `KimixController` keeps its own `_ensurePromise` so that a flood of `ready`/`newConversation`/`startServer` calls cannot create multiple managers.
- A start that is interrupted by `stop()` will see the lock drain and then stop cleanly; the `exit` event handler coordinates with `_killInProgress` to avoid corrupt state.

## 9. Failure modes

| Scenario | Behaviour |
|---|---|
| Spawn fails (binary missing) | Status `error`, `lastError` shown in UI, child killed if it exists. |
| Health check times out | Child killed, PID file removed, status `error`. |
| PID file points to dead PID | File removed, new server spawned. |
| Foreign process on basePort | Automatically falls back to the next free port by default (`kimix.autoFallbackPort: true`). Prompts only when `kimix.autoFallbackPort` is `false`. |
| Cannot determine PID of foreign process | "Stop it & start new" falls back to telling the user to stop the process manually. |
| Extension host crashes | Next activation reads stale PID file, validates health, adopts or cleans. |

## 10. Testing strategy

Unit tests for `ServerLifecycleManager` mock:

- `node:child_process` / `node:fs` / `node:fs/promises`
- `fetch`
- injected `findFreePort` and `findPidByPort` helpers

Key cases:

1. Spawns new server and writes PID file.
2. Reuses previous instance from PID file.
3. Detects foreign process and automatically falls back to the next free port by default.
4. Returns `foreign` when `autoFallbackPort` is disabled.
5. `reuseForeign: true` adopts without spawning.
5. `killForeign: true` kills foreign and spawns new.
6. `fallbackToNextPort: true` spawns on next free port.
7. `stop()` kills owned child and removes PID file.
8. `stop()` does **not** kill an adopted foreign child.
9. Concurrent `start()`/`stop()` does not leak.

## 11. Layering rules

- `packages/vscode-ext/src/server/**` must **not** import `vscode`.
- All user-facing prompts live in `KimixController` or `extension.ts`.
- `messages.ts` and `webview-ui/src/protocol.ts` are kept in sync.
