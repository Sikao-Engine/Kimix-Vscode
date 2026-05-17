const MOCK_SSE_URL = "http://localhost:8765/events";
const MOCK_SEND_URL = "http://localhost:8765/send";

interface VSCodeAPI {
  postMessage(message: unknown): void;
  setState<T>(state: T): void;
  getState<T>(): T | undefined;
}

function createMockVSCodeAPI(): VSCodeAPI {
  let state: unknown;

  return {
    postMessage: (msg: any) => {
      console.log("[Mock VSCode] postMessage →", msg);

      fetch(MOCK_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      }).catch(() => {});

      if (msg.type === "rpc") {
        handleRpc(msg.payload);
      }
    },
    setState: <T>(s: T) => {
      state = s;
    },
    getState: <T>(): T | undefined => state as T,
  };
}

function handleRpc(req: any) {
  const { id, method } = req;

  const reply = (result?: unknown, error?: { message: string; code?: string }) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "rpc", payload: { id, result, error } },
      })
    );
  };

  switch (method) {
    case "getExtensionConfig": {
      reply({
        yoloMode: false,
        autosave: true,
        executablePath: "",
        enableNewConversationShortcut: false,
        useCtrlEnterToSend: false,
        environmentVariables: {},
        showThinkingContent: true,
        showThinkingExpanded: false,
        editorContext: "onFileChange",
        version: "0.1.0-mock",
        defaultModel: "kimi-k2",
      });
      break;
    }
    case "checkLoginStatus": {
      reply({ loggedIn: true, user: { name: "Mock User" } });
      break;
    }
    case "getModels": {
      reply([
        { id: "kimi-k2", name: "Kimi K2", capabilities: ["chat", "thinking"] },
        { id: "kimi-k1.5", name: "Kimi K1.5", capabilities: ["chat"] },
      ]);
      break;
    }
    case "getInputHistory": {
      reply(["How to use React?", "Explain TypeScript generics"]);
      break;
    }
    case "getMCPServers": {
      reply([
        {
          name: "filesystem",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      ]);
      break;
    }
    case "streamChat": {
      setTimeout(() => simulateStream(), 300);
      reply({ ok: true, sessionId: "mock-session-" + Date.now() });
      break;
    }
    case "checkWorkspace": {
      reply({ hasWorkspace: true, workDir: "/mock/project" });
      break;
    }
    default: {
      console.log(`[Mock RPC] Unhandled method: ${method}`);
      reply(null);
    }
  }
}

function simulateStream() {
  const sessionId = "mock-session-" + Date.now();
  const events = [
    { type: "streamEvent", payload: { type: "session_start", sessionId, model: "kimi-k2" } },
    { type: "streamEvent", payload: { type: "text_chunk", text: "Hello! " } },
    { type: "streamEvent", payload: { type: "text_chunk", text: "This is a **mock** response " } },
    { type: "streamEvent", payload: { type: "text_chunk", text: "for debugging the webview UI. 🎉\n\n" } },
    { type: "streamEvent", payload: { type: "thinking_chunk", text: "Let me analyze the request..." } },
    {
      type: "streamEvent",
      payload: {
        type: "ToolCall",
        payload: { id: "call_001", name: "read_file", arguments: '{"filePath": "package.json"}' },
      },
    },
    {
      type: "streamEvent",
      payload: {
        type: "ToolResult",
        payload: { tool_call_id: "call_001", output: '{ "name": "kimix-vscode-ext" }' },
      },
    },
    {
      type: "streamEvent",
      payload: { type: "StatusUpdate", payload: { status: "working", message: "Processing..." } },
    },
    {
      type: "streamEvent",
      payload: { type: "stream_complete", result: { status: "finished", output: "Done" } },
    },
  ];

  let i = 0;
  const tick = () => {
    if (i >= events.length) return;
    window.dispatchEvent(new MessageEvent("message", { data: events[i] }));
    i++;
    setTimeout(tick, 600 + Math.random() * 400);
  };
  tick();
}

function connectSSE() {
  const es = new EventSource(MOCK_SSE_URL);
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "__connected__") {
      console.log("[Mock] Connected to mock server");
      return;
    }
    window.dispatchEvent(new MessageEvent("message", { data }));
  };
  es.onerror = () => {
    console.warn("[Mock] SSE connection lost, retrying in 3s...");
    setTimeout(connectSSE, 3000);
  };
}

export function installMock() {
  (window as any).acquireVsCodeApi = createMockVSCodeAPI;
  connectSSE();
  console.log("[Mock] VSCode API mock installed. Open http://localhost:5173 to debug.");
}
