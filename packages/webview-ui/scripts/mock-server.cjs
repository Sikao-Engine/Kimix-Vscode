const http = require("http");
const readline = require("readline");
const path = require("path");

const PORT = 8765;
const clients = [];
let lastSent = null;

const presets = [
  {
    label: "ExtensionConfigChanged",
    data: {
      type: "event",
      payload: {
        type: "extensionConfigChanged",
        payload: {
          config: {
            yoloMode: false,
            autosave: true,
            executablePath: "",
            enableNewConversationShortcut: false,
            useCtrlEnterToSend: false,
            environmentVariables: {},
            showThinkingContent: true,
            showThinkingExpanded: false,
            editorContext: "onFileChange",
          },
          changedKeys: [],
        },
      },
    },
  },
  {
    label: "FocusInput",
    data: { type: "event", payload: { type: "focusInput", payload: {} } },
  },
  {
    label: "InsertMention (@file)",
    data: {
      type: "event",
      payload: {
        type: "insertMention",
        payload: { mention: "@src/main.tsx:10" },
      },
    },
  },
  {
    label: "FileChangesUpdated",
    data: {
      type: "event",
      payload: {
        type: "fileChangesUpdated",
        payload: [
          { path: "src/App.tsx", status: "Modified", additions: 5, deletions: 2 },
          { path: "src/main.tsx", status: "Added", additions: 12, deletions: 0 },
        ],
      },
    },
  },
  {
    label: "MCPServersChanged",
    data: {
      type: "event",
      payload: {
        type: "mcpServersChanged",
        payload: [
          {
            name: "filesystem",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
          },
        ],
      },
    },
  },
  {
    label: "LoginUrl",
    data: {
      type: "event",
      payload: {
        type: "loginUrl",
        payload: { url: "https://example.com/auth?token=mock" },
      },
    },
  },
  {
    label: "Stream: session_start",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "session_start", sessionId: "mock-session-001", model: "kimi-k2" },
      },
    },
  },
  {
    label: "Stream: text_chunk",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "text_chunk", text: "Hello! This is a mock response for UI debugging." },
      },
    },
  },
  {
    label: "Stream: thinking_chunk",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "thinking_chunk", text: "Let me think about this step by step..." },
      },
    },
  },
  {
    label: "Stream: ToolCall",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: {
          type: "ToolCall",
          payload: { id: "call_001", name: "read_file", arguments: '{"filePath": "package.json"}' },
        },
      },
    },
  },
  {
    label: "Stream: ToolResult",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: {
          type: "ToolResult",
          payload: { tool_call_id: "call_001", output: '{ "name": "kimix-vscode-ext" }' },
        },
      },
    },
  },
  {
    label: "Stream: StatusUpdate",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "StatusUpdate", payload: { status: "working", message: "Analyzing project structure..." } },
      },
    },
  },
  {
    label: "Stream: stream_complete",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "stream_complete", result: { status: "finished", output: "Done" } },
      },
    },
  },
  {
    label: "Stream: error",
    data: {
      type: "event",
      payload: {
        type: "streamEvent",
        payload: { type: "error", code: "MOCK_ERROR", message: "This is a mock error for UI testing.", phase: "runtime" },
      },
    },
  },
  {
    label: "NewConversation",
    data: {
      type: "event",
      payload: { type: "streamEvent", payload: { type: "new_conversation" } },
    },
  },
];

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    clients.push(res);
    res.write(`data: ${JSON.stringify({ type: "__connected__" })}\n\n`);
    req.on("close", () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) clients.splice(idx, 1);
    });
  } else if (req.url === "/send" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      console.log("\n[📤 Webview → Server]", body.slice(0, 300));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

function broadcast(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  clients.forEach((res) => res.write(`data: ${text}\n\n`));
}

server.listen(PORT, () => {
  console.log(`\n[Mock Server] SSE running at http://localhost:${PORT}/events`);
  console.log(`[Mock Server] POST to http://localhost:${PORT}/send to receive webview messages\n`);
  showMenu();
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function showMenu() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║         Webview Mock Message Console               ║");
  console.log("╠════════════════════════════════════════════════════╣");
  presets.forEach((p, i) => console.log(`║  ${String(i + 1).padStart(2)}. ${p.label.padEnd(45)}║`));
  console.log("║   r. Repeat last message                           ║");
  console.log("║   q. Quit                                          ║");
  console.log("╚════════════════════════════════════════════════════╝");
  rl.question("Select > ", (ans) => {
    if (ans === "q") {
      console.log("Bye!");
      process.exit(0);
    }
    if (ans === "r") {
      if (lastSent) {
        broadcast(lastSent);
        console.log("📡 Repeated last message.\n");
      } else {
        console.log("No message to repeat.\n");
      }
      showMenu();
      return;
    }
    const idx = parseInt(ans, 10) - 1;
    if (presets[idx]) {
      broadcast(presets[idx].data);
      lastSent = presets[idx].data;
      console.log(`📡 Sent: ${presets[idx].label}\n`);
    } else {
      console.log("Invalid selection.\n");
    }
    showMenu();
  });
}
