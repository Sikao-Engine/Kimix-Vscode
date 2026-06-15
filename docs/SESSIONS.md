# Session Management

`SessionManager` (`src/session/sessionManager.ts`) owns the session list and
exactly **one** live SSE subscription — the stream for the currently selected
session.

## Responsibilities

| Concern              | Behaviour                                                        |
| -------------------- | --------------------------------------------------------------- |
| Session list         | `refreshSessions()` pulls `GET /session`; cached in `sessions`. |
| Create               | `newSession()` creates, prepends, and auto-selects it.          |
| Delete               | `deleteSession()` removes it; if it was current, falls back to the next session (or none) and re-streams. |
| Select               | `selectSession()` tears down the old stream and starts a new one. |
| Prompt               | `sendPrompt()` lazily creates a session if none is active.      |
| Abort / Compact      | Proxy to `abortSession` / `summarize` on the current session.   |
| Permission           | `respondPermission()` replies on the current session.           |

## Single active stream

```
selectSession(id):
  stopStream()                 // abort previous AbortController
  currentSessionId = id
  startStream(id)              // new controller + async runStream loop
```

`runStream` consumes `client.streamEvents(id, { signal })` and translates each
`ParsedEvent` into a typed `EventEmitter` event:

| ParsedEvent.type | Emitted event | Payload                                  |
| ---------------- | ------------- | ---------------------------------------- |
| `text`/`reasoning` | `text`      | `{ sessionId, kind, delta, full }`       |
| `tool`           | `tool`        | `{ sessionId, toolName, status, title, callID, input }` |
| `permission`     | `permission`  | `{ sessionId, permissionId, title }`     |
| `session-idle`   | `idle`        | `{ sessionId }`                          |

`KimixController` subscribes to these and forwards them to the webview as
`streamText` / `streamTool` / `permission` / `streamIdle`.

## Lifecycle

- `dispose()` aborts the active stream and removes all listeners. The controller
  calls it on `restart` and on extension deactivation.
- Reconnects are handled inside the client; the manager just keeps consuming the
  async iterator until the signal aborts.

## Plan Mode & context compaction

- **Plan Mode** is orchestrated by `PlanManager` (`src/plan/planManager.ts`).
  When the full workflow is enabled (`kimix.planModeEnabled`, default `true`):
  - A dedicated planning session is created (or the prompt is decorated if no
    planner agent is available).
  - The planner streams to an in-memory buffer; on `session-idle` the buffer is
    flushed to `kimix.planFilePath` (default `.kimix/plan.md`).
  - The host pushes `planState({ phase: "reviewing", planFile })` and opens the
    plan file in the editor.
  - The webview shows **Implement / Revise / Discard** affordances.
  - **Implement** switches `planMode` back to `build`, sends the plan content to
    the regular worker session, and follows up with a review prompt.
  - **Revise** regenerates the plan file from user feedback (capped by
    `kimix.planMaxAttempts`).
  - **Discard** deletes the plan file and resets the planning state.
- If `kimix.planModeEnabled` is `false`, the legacy fallback is used:
  `KimixController.decoratePrompt` prefixes the user text with a plan-only
  instruction before sending it through the normal chat session.
- **Compact** calls `POST /session/:id/summarize` with the currently selected
  model, triggering server-side AI compaction of the conversation context.
