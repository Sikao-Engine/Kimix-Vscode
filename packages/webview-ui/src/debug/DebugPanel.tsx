import { useState } from "react";

export function DebugPanel() {
  const [collapsed, setCollapsed] = useState(false);

  const sendEvent = (payload: any) => {
    window.dispatchEvent(new MessageEvent("message", { data: payload }));
  };

  const mockStream = () => {
    const vscode = (window as any).vscode;
    if (vscode) {
      vscode.postMessage({
        type: "rpc",
        payload: {
          id: "debug-" + Date.now(),
          method: "streamChat",
          params: { content: "mock", model: "kimi-k2" },
        },
      });
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: "fixed",
          bottom: 8,
          right: 8,
          zIndex: 9999,
          opacity: 0.6,
          background: "#1e1e1e",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: 12,
        }}
        title="Open Debug Panel"
      >
        🐛 Debug
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 9999,
        background: "#1e1e1e",
        color: "#ccc",
        padding: 12,
        borderRadius: 8,
        fontSize: 12,
        width: 260,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <strong style={{ color: "#fff" }}>Debug Panel</strong>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <button onClick={mockStream} style={btnStyle}>
          ▶️ Simulate Chat Stream
        </button>
        <button
          onClick={() =>
            sendEvent({
              type: "event",
              payload: { type: "focusInput", payload: {} },
            })
          }
          style={btnStyle}
        >
          Focus Input
        </button>
        <button
          onClick={() =>
            sendEvent({
              type: "event",
              payload: {
                type: "insertMention",
                payload: { mention: "@src/main.tsx:10" },
              },
            })
          }
          style={btnStyle}
        >
          Insert Mention
        </button>
        <button
          onClick={() =>
            sendEvent({
              type: "event",
              payload: {
                type: "extensionConfigChanged",
                payload: {
                  config: { yoloMode: true, showThinkingContent: true },
                  changedKeys: ["yoloMode"],
                },
              },
            })
          }
          style={btnStyle}
        >
          Toggle Yolo Mode
        </button>
        <button
          onClick={() =>
            sendEvent({
              type: "event",
              payload: {
                type: "fileChangesUpdated",
                payload: [
                  {
                    path: "src/App.tsx",
                    status: "Modified",
                    additions: 5,
                    deletions: 2,
                  },
                ],
              },
            })
          }
          style={btnStyle}
        >
          File Changes
        </button>
        <button
          onClick={() =>
            sendEvent({
              type: "event",
              payload: {
                type: "streamEvent",
                payload: { type: "new_conversation" },
              },
            })
          }
          style={btnStyle}
        >
          New Conversation
        </button>
      </div>
      <div style={{ marginTop: 10, color: "#888", fontSize: 10 }}>
        Mock server: localhost:8765
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#333",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 4,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: 11,
  textAlign: "left",
};
