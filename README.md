# KimiX Code Vscode Plugin

This is the Monorepo of of the KimiX Code VS Code extension.

## Background

The original source files (`src/`) were not present in the workspace — only the compiled `dist/` output remained. This TypeScript source has been reverse-engineered from the bundled JavaScript (`dist/extension.js` and `dist/webview.js`) using deep static analysis.

## Structure

- `packages`
    - `vscode-ext/` — Extension backend (Node.js / VS Code APIs)
    - `webview-ui/` — React webview frontend (Vite + Tailwind + Zustand)
