import React, { useEffect, useState } from "react";
import { useVSCode } from "./hooks/use-vscode";
import { useChatStore } from "./stores/chat-store";
import { StreamEvent, ExtensionConfig } from "./types";
import { Header } from "./components/Header";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { DebugPanel } from "./debug/DebugPanel";

const App: React.FC = () => {
  const vscode = useVSCode();
  const { messages, sessionId, isLoading, model, addMessage, appendContent, setSession, setLoading, clear, setModel } =
    useChatStore();
  const [config, setConfig] = useState<ExtensionConfig | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "event") {
        handleStreamEvent(msg.payload);
      } else if (msg.type === "rpc" && msg.payload?.method === "getExtensionConfig") {
        setConfig(msg.payload.result as ExtensionConfig);
        if (msg.payload.result?.defaultModel) {
          setModel(msg.payload.result.defaultModel);
        }
      }
    };
    window.addEventListener("message", handler);

    // Request config on mount
    vscode.postMessage({
      type: "rpc",
      payload: { id: "init", method: "getExtensionConfig", params: {} },
    });

    return () => window.removeEventListener("message", handler);
  }, []);

  const handleStreamEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "session_start":
        setSession(event.sessionId);
        setLoading(true);
        break;
      case "text_chunk":
        appendContent(event.text);
        break;
      case "thinking_chunk":
        // Handle thinking content - would store in message metadata
        break;
      case "ToolCall":
        // Handle tool call display
        break;
      case "ToolResult":
        // Handle tool result
        break;
      case "StatusUpdate":
        // Handle status update
        break;
      case "stream_complete":
        setLoading(false);
        break;
      case "error":
        setLoading(false);
        addMessage({
          id: crypto.randomUUID(),
          role: "system",
          content: `Error: ${event.message}`,
          timestamp: Date.now(),
        });
        break;
      case "new_conversation":
        clear();
        break;
      default:
        break;
    }
  };

  const sendMessage = (text: string) => {
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    vscode.postMessage({
      type: "rpc",
      payload: {
        id: crypto.randomUUID(),
        method: "streamChat",
        params: {
          content: text,
          model: model || config?.defaultModel || "default",
          thinking: false,
          sessionId: sessionId || undefined,
        },
      },
    });
  };

  const handleNewConversation = () => {
    clear();
    vscode.postMessage({
      type: "rpc",
      payload: { id: crypto.randomUUID(), method: "resetSession", params: {} },
    });
  };

  const handleShowLogs = () => {
    vscode.postMessage({
      type: "rpc",
      payload: { id: crypto.randomUUID(), method: "showLogs", params: {} },
    });
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header
        model={model || config?.defaultModel}
        onNewConversation={handleNewConversation}
        onShowLogs={handleShowLogs}
      />
      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        useCtrlEnter={config?.useCtrlEnterToSend}
      />
      {import.meta.env.DEV && <DebugPanel />}
    </div>
  );
};

export default App;
