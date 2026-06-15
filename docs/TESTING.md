# Testing & Acceptance

## Unit tests

Vitest. The protocol/session/server layers carry no `vscode` import; a
lightweight mock covers the controller and config layers.

### Extension host

```
pnpm --filter kimix-vscode-ext run test            # run once
pnpm --filter kimix-vscode-ext run test:watch       # watch
pnpm --filter kimix-vscode-ext run test:coverage     # v8 coverage
```

Suites (`packages/vscode-ext/tests/`):

| File                     | Covers                                                   |
| ------------------------ | -------------------------------------------------------- |
| `sseParser.test.ts`      | Line buffering, chunk splits, multi-line data, comments; event decoding for text/tool/permission/idle/step-finish; session filtering; reconnect sentinel. |
| `client.test.ts`         | Health, session mapping, prompt body shape, provider flattening, permission endpoint fallback, message metadata (`modelID`/`providerID`) mapping (mocked `fetch`). |
| `sessionManager.test.ts` | List refresh, stream→event emission, idle, lazy session creation (stubbed client). |
| `serverManager.test.ts`  | PID reuse/adopt/spawn, foreign-server handling, stop cleanup. |
| `serverProcess.test.ts`  | Spawn, health polling, graceful-then-forceful termination. |
| `kimixController.test.ts`| Dispatch: `turnId` tracking, background abort, `requestFileList`, `requestWorkspaceSymbols`, plan-mode dispatch (`generatePlan`, `implementPlan`, `discardPlan`) (mocked VS Code APIs). |
| `planManager.test.ts`    | Plan file path resolution/safety, prompt building, state machine (`idle`→`generating`→`reviewing`→`implementing`→`idle`), revision cap, agent selection, implementation + review prompts (mocked client/session manager). |

A `vscode` module mock lives at `tests/__mocks__/vscode.ts` and is aliased via
`vitest.config.ts`.

### Webview frontend

```
pnpm --filter kimix-webview-ui run test            # run once
```

Suite (`packages/webview-ui/tests/`):

| File            | Covers                                                   |
| --------------- | -------------------------------------------------------- |
| `store.test.ts` | Pending queue enqueue/remove/edit/promote, reasoning collapse, `turnId` filtering, stop generation, `planState` handling, plan action message posting. |

## Static checks

```
pnpm --filter kimix-vscode-ext run typecheck    # tsc --noEmit
pnpm --filter kimix-vscode-ext run lint          # eslint src
```

For the webview bundle:

```
pnpm --filter kimix-webview-ui run build         # tsc + vite build
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
   that appears in the toolbar Session dropdown.
5. **Prompt + stream** — type a prompt, press Enter. Assistant text streams in;
   tool calls show as rows; `Stop` frees the composer immediately while the
   backend aborts asynchronously.
6. **User messages** — your prompts appear in the transcript with a timestamp.
7. **Model labels** — each assistant response header shows the provider/model
   used; switching models leaves older labels unchanged.
8. **Reasoning collapse** — reasoning blocks fold/unfold per message; toolbar
   buttons collapse/expand all.
9. **@ mentions** — type `@` in the composer, pick a file/symbol, and see an
   attachment chip; the sent prompt includes `@path` references.
10. **Pending queue** — while the model is busy, type another prompt and press
    Enter; it queues above the composer and is sent automatically when the turn
    ends. Queued items can be edited or deleted; deleting the locked item
    promotes the next one.
11. **Plan Mode** — toggle Build/Plan; type a requirement and click **Generate
    Plan**. A plan file is written to `kimix.planFilePath`, opened in the editor,
    and the webview shows **Implement / Revise / Discard**. Revise with feedback
    regenerates the file; Implement switches to Build and sends the plan to the
    regular session; Discard deletes the file. If `kimix.planModeEnabled` is
    `false`, the legacy plan-only prompt decoration is used instead.
12. **Compact** — `Compact` triggers summarization without errors.
13. **Permissions** — when the server asks for a permission, the inline bar shows
    Allow once / Always / Reject and the choice is delivered.
14. **Sessions** — switching sessions via the toolbar dropdown reloads the
    transcript; deleting the active one falls back to another (or empty).
15. **Open in Tab** — `KimiX: Open in New Tab` mirrors the sidebar; both stay in
    sync.
16. **Restart** — `KimiX: Restart Server` re-spawns the process and reconnects.

## Acceptance checklist

- [ ] `typecheck` passes
- [ ] `lint` passes
- [ ] `test` green (vscode-ext + webview-ui)
- [ ] `build` produces `dist/extension.js` + `dist/webview.js`
- [ ] Manual steps 1–16 succeed against a real server
