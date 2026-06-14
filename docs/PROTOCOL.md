# Interaction Protocol

KimiX speaks the **opencode HTTP + SSE** protocol. This document records the
exact subset the extension relies on, plus the internal host↔webview contract.

## 1. Server process

The extension spawns one server per workspace:

```
<kimix.executable> serve --hostname <kimix.host> --port <port>
```

- `port` is the first free port at/above `kimix.basePort` (scanned with a TCP
  bind probe).
- Readiness is polled via `GET /global/health` → `{ "healthy": true }`.
- On Windows the child is launched with `shell: true` and killed via
  `taskkill /t /f`; elsewhere `SIGTERM`.

Source: `src/server/serverProcess.ts`.

## 2. HTTP endpoints used

All requests target `http://<host>:<port>`.

| Method | Path                              | Used for                         |
| ------ | --------------------------------- | -------------------------------- |
| GET    | `/global/health`                  | Readiness / health check         |
| GET    | `/session`                        | List sessions                    |
| POST   | `/session`                        | Create session (`{ title? }`)    |
| GET    | `/session/:id`                    | Get session                      |
| DELETE | `/session/:id`                    | Delete session                   |
| GET    | `/session/:id/message`            | Transcript (`WithParts[]`)       |
| POST   | `/session/:id/prompt_async`       | Fire-and-forget prompt (204)     |
| POST   | `/session/:id/abort`              | Abort the running turn           |
| POST   | `/session/:id/summarize`          | Compact context (`{providerID, modelID}`) |
| GET    | `/agent`                          | List agents                      |
| GET    | `/config/providers`               | List providers + their models    |
| GET    | `/config`                         | Full config                      |
| POST   | `/permission/:permId/reply`       | Permission reply (`{reply}`)     |
| POST   | `/session/:id/permissions/:permId`| Deprecated permission fallback   |

### Prompt body

```jsonc
{
  "parts": [{ "type": "text", "text": "..." }],
  "agent": "build",                              // optional
  "model": { "providerID": "openai", "modelID": "gpt-4" } // optional
}
```

### Permission reply values

`once` | `always` | `reject`. The client tries `/permission/:id/reply` first
and falls back to the deprecated session route on `404`/`405`.

Source: `src/protocol/client.ts`.

## 3. SSE event stream (`GET /event`)

`/event` is a **global** stream — it emits events for every session in the
instance. The parser filters by `sessionID` and skips the rest.

### Parsing

Two stages (`src/protocol/sseParser.ts`):

1. `SSELineParser` — incremental line buffer that emits `RawSSEEvent`
   (`{ event, data, id }`) on blank-line boundaries. Handles chunk splits,
   multi-line `data:`, comment/heartbeat lines (`:`), and the leading-space
   rule.
2. `parseEvent(raw, sessionId)` — decodes the JSON `data` into a structured
   `ParsedEvent`.

### Recognised opencode events

| `type`                  | part.type       | → `ParsedEvent.type` |
| ----------------------- | --------------- | -------------------- |
| `message.part.updated`  | `text`          | `text`               |
| `message.part.updated`  | `reasoning`     | `reasoning`          |
| `message.part.updated`  | `tool`          | `tool`               |
| `message.part.updated`  | `tool` (permission/question, pending/running) | `permission` |
| `message.part.updated`  | `step-start`    | `step-start`         |
| `message.part.updated`  | `step-finish`   | `step-finish`        |
| `message.part.delta`    | (field text/reasoning) | `text` / `reasoning` |
| `session.idle`          | —               | `session-idle`       |
| `session.status` (idle) | —               | `session-idle`       |
| `session.permission`    | —               | `permission`         |
| `server.connected` / `server.heartbeat` | —    | `skip`               |
| other session's events  | —               | `skip`               |

### Reconnection

`OpencodeClient.streamEvents` reconnects up to `maxReconnects` (default 5) with
linear backoff (`reconnectDelayMs * attempt`). Before each retry it yields a
synthetic `reconnected` event so the consumer can resync. The loop exits
cleanly when the `AbortSignal` fires.

## 4. Host ↔ Webview messages

Defined in `src/protocol/messages.ts` (host) and mirrored in
`webview-ui/src/protocol.ts` (UI). Keep both in sync.

### Webview → Host

`ready` · `sendPrompt` · `abort` · `newSession` · `selectSession` ·
`deleteSession` · `selectAgent` · `selectModel` · `setPlanMode` ·
`compactContext` · `respondPermission` · `refresh`

### Host → Webview

`state` (full `UIState` snapshot) · `messages` · `streamText` · `streamTool` ·
`streamIdle` · `permission` · `error`

The host pushes a complete `UIState` on every meaningful change (no partial
diffs), keeping the webview a pure projection of host state.
