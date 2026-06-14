# Testing & Acceptance

## Unit tests

Vitest, host-side only (the protocol/session/server layers carry no `vscode`
import; a lightweight mock covers the few that do).

```
pnpm --filter kimix-vscode-ext run test            # run once
pnpm --filter kimix-vscode-ext run test:watch       # watch
pnpm --filter kimix-vscode-ext run test:coverage     # v8 coverage
```

Current suites (`packages/vscode-ext/tests/`):

| File                     | Covers                                                   |
| ------------------------ | -------------------------------------------------------- |
| `sseParser.test.ts`      | Line buffering, chunk splits, multi-line data, comments; event decoding for text/tool/permission/idle/step-finish; session filtering; reconnect sentinel. |
| `client.test.ts`         | Health, session mapping, prompt body shape, provider flattening, permission endpoint fallback (mocked `fetch`). |
| `sessionManager.test.ts` | List refresh, stream→event emission, idle, lazy session creation (stubbed client). |

A `vscode` module mock lives at `tests/__mocks__/vscode.ts` and is aliased via
`vitest.config.ts`.

## Static checks

```
pnpm --filter kimix-vscode-ext run typecheck    # tsc --noEmit
pnpm --filter kimix-vscode-ext run lint          # eslint src
```

## Build verification

```
pnpm --filter kimix-vscode-ext run build         # webview + copy + esbuild
```

Expected artifacts:

- `packages/vscode-ext/dist/extension.js`
- `packages/vscode-ext/dist/webview.js`
- `packages/vscode-ext/dist/index.html`

## Manual acceptance (F5 / Extension Development Host)

Prerequisite: a working `opencode` (or configured `kimix.executable`) on `PATH`.

1. **Activation** — open a workspace folder, launch the Extension Development
   Host. The KimiX activity-bar icon appears; opening it shows the sidebar.
2. **Server boot** — sidebar shows "Starting server…" then clears. Check the
   `KimiX Code` output channel (`KimiX: Show Logs`) for
   `[server] healthy on port <n>`.
3. **Agents & models** — the toolbar populates the Agent and Model dropdowns.
4. **New conversation** — `New` (or `KimiX: New Conversation`) creates a session
   that appears in the left rail.
5. **Prompt + stream** — type a prompt, press Enter. Assistant text streams in;
   tool calls show as rows; `Stop` aborts mid-flight.
6. **Plan Mode** — toggle Build/Plan; in Plan Mode prompts are prefixed with the
   plan-only instruction.
7. **Compact** — `Compact` triggers summarization without errors.
8. **Permissions** — when the server asks for a permission, the inline bar shows
   Allow once / Always / Reject and the choice is delivered.
9. **Sessions** — switching sessions reloads the transcript; deleting the active
   one falls back to another (or empty).
10. **Open in Tab** — `KimiX: Open in New Tab` mirrors the sidebar; both stay in
    sync.
11. **Restart** — `KimiX: Restart Server` re-spawns the process and reconnects.

## Acceptance checklist

- [ ] `typecheck` passes
- [ ] `lint` passes
- [ ] `test` green (22+ tests)
- [ ] `build` produces `dist/extension.js` + `dist/webview.js`
- [ ] Manual steps 1–11 succeed against a real server
