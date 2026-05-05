# Kimi Code Extension - Architecture Analysis

## Overview

This is a VS Code extension that provides an AI coding assistant powered by Moonshot AI's Kimi. The extension communicates with a local CLI tool via JSON-RPC and renders a React-based webview UI.

## Project Structure

```
ts/
├── src/                          # Extension backend (Node.js / VS Code API)
│   ├── protocol/                 # Shared types and protocol definitions
│   │   ├── types.ts              # Enums, event types, RPC interfaces
│   │   └── errors.ts             # Custom error classes and error mapping
│   ├── cli/                      # CLI management
│   │   ├── types.ts              # CLI-related interfaces
│   │   ├── client.ts             # JSON-RPC client for CLI process
│   │   ├── binary.ts             # CLI binary download and path management
│   │   └── operations.ts         # Login, logout, MCP operations
│   ├── session/                  # Session lifecycle
│   │   ├── types.ts              # Session, Turn interfaces
│   │   └── manager.ts            # Session creation, forking, history
│   ├── file/                     # File operations
│   │   ├── manager.ts            # File search, directory listing, tracking
│   │   └── baseline.ts           # Baseline tracking for file changes
│   ├── bridge/                   # Webview <-> Extension bridge
│   │   ├── context.ts            # BridgeContext interface
│   │   ├── handler.ts            # BridgeHandler (message dispatcher)
│   │   └── handlers.ts           # RPC method implementations (50+ methods)
│   ├── webview/                  # Webview management
│   │   └── provider.ts           # WebviewViewProvider implementation
│   ├── mcp/                      # MCP server management
│   │   └── manager.ts            # MCP server CRUD operations
│   ├── utils/                    # Shared utilities
│   │   ├── errors.ts             # Error normalization and classification
│   │   ├── logger.ts             # Debug logging utilities
│   │   └── paths.ts              # Path helpers for .kimi/ directory
│   ├── config.ts                 # Extension configuration
│   ├── extension.ts              # Activation and command registration
│   └── index.ts                  # Public exports
├── webview-ui/                   # Webview frontend (React + Vite)
│   └── src/
│       ├── main.tsx              # Entry point
│       ├── App.tsx               # Root component
│       ├── types.ts              # Webview-specific types
│       ├── index.css             # Tailwind styles
│       ├── components/           # UI components
│       │   ├── ChatInput.tsx     # Message input with textarea
│       │   ├── MessageList.tsx   # Scrollable message list
│       │   ├── MessageItem.tsx   # Individual message bubble
│       │   ├── Header.tsx        # Top bar with controls
│       │   └── index.ts          # Component exports
│       ├── hooks/
│       │   └── use-vscode.ts     # VS Code API hooks
│       └── stores/
│           └── chat-store.ts     # Zustand chat state
```

## Key Components

### 1. Protocol Layer (`src/protocol/`)

Defines all communication contracts between the webview, extension, and CLI:
- **RpcMethod**: 50+ methods for workspace, chat, file, config, MCP, and auth operations
- **WebviewEvent**: Events streamed from extension to webview (StreamEvent, FileChangesUpdated, LoginUrl, etc.)
- **Error Codes**: CLI errors, protocol errors, LLM errors, session errors
- **StreamEvent Union**: TextChunk, ThinkingChunk, ToolCall, ToolResult, StatusUpdate, SessionStart, etc.

### 2. CLI Client (`src/cli/client.ts`)

Manages the `kimi` CLI process:
- Spawns the CLI with JSON-RPC mode over stdin/stdout
- Handles bidirectional communication
- Correlates requests/responses via `pendingRequests` Map
- Processes server-side requests (ToolCallRequest, HookRequest)
- Emits events for streaming responses
- Manages external tool handlers and hook handlers

### 3. Session Manager (`src/session/manager.ts`)

Manages conversation sessions:
- Creates sessions with model, thinking mode, yolo mode
- Returns `Turn` objects with async iterators for streaming
- Forks sessions at specific turn indices
- Reads session history from `.kimi/sessions/<id>/wire.jsonl`
- Prunes incomplete tool calls from context

### 4. File Manager & Baseline Tracker (`src/file/`)

Tracks file changes made by Kimi:
- `FileManager`: Watches workspace files, searches, lists directories, tracks per-webview modifications
- `baselineTracker`: Saves file baselines before modification, computes diffs, supports revert/keep
- Path traversal protection with `isWithinWorkDir` checks

### 5. Bridge Handler (`src/bridge/handler.ts` + `handlers.ts`)

The central RPC dispatcher:
- `BridgeHandler`: Receives messages from webview, creates `BridgeContext`, manages sessions per webview
- `handlers.ts`: Typed implementations for all 50+ RPC methods organized by category:
  - Workspace (CheckWorkspace, OpenFolder, RunCLI, InputHistory)
  - Config (SaveConfig, GetExtensionConfig, OpenSettings, GetModels)
  - MCP (GetMCPServers, AddMCPServer, AuthMCP, TestMCP)
  - Chat (StreamChat, AbortChat, ResetSession, SteerChat)
  - Sessions (GetKimiSessions, ForkKimiSession, LoadHistory)
  - Editor/File (GetProjectFiles, InsertText, PickMedia, OpenFileDiff)
  - Baseline (SaveBaselines, TrackFiles, RevertFiles, KeepChanges)
  - Auth (CheckLoginStatus, Login, Logout)

### 6. Webview Provider (`src/webview/provider.ts`)

Manages the webview UI:
- Provides sidebar view (`kimi.webview`)
- Can create tab panels (`kimi.openInTab`)
- Injects CSP-compliant HTML with nonce
- Handles media/resource URI loading
- Broadcasts events to all active webviews

### 7. MCP Manager (`src/mcp/manager.ts`)

Model Context Protocol server management:
- Reads/writes MCP server config from workspace state
- Supports add, update, remove, auth, reset-auth, test operations

## Communication Flow

```
User Input -> Webview (React) -> postMessage -> BridgeHandler -> RPC Handler
                                                      |
                                               SessionManager
                                                      |
                                               CLI Client (JSON-RPC)
                                                      |
                                               Kimi CLI Process
                                                      |
                                                  Stream Events
                                                      |
Webview (React) <- postMessage <- BridgeHandler <----'
```

## Security Features

- Content Security Policy (CSP) with nonces for webview scripts
- Path traversal checks (`isWithinWorkDir`) on all file operations
- Baseline tracking for file modifications (allows revert)
- YOLO mode toggle for auto-approving tool calls
- File type filtering for media uploads
- Safe-file tool detection for baseline auto-save

## Reconstruction Notes

This TypeScript source was reconstructed from the compiled `dist/extension.js` and `dist/webview.js` bundles using deep static analysis. The original source files were not present in the workspace. All types, interfaces, and architectural boundaries have been faithfully reconstructed based on analysis of the bundled code.

Key reconstructed behaviors:
- JSON-RPC protocol with request/response correlation
- Streaming turn handling with async iterators
- Session forking with wire.jsonl truncation
- Tool call baseline auto-saving during streaming
- Editor context injection (never/onConversationStart/onFileChange)
- File change diff computation with additions/deletions
