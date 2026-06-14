import { useState } from "react";
import { actions, useStore } from "../store";

/** Prompt input. Enter sends, Shift+Enter inserts a newline. */
export function Composer() {
  const [text, setText] = useState("");
  const busy = useStore((s) => s.busy);
  const status = useStore((s) => s.ui.status);

  const send = () => {
    const value = text.trim();
    if (!value) {
      return;
    }
    actions.sendPrompt(value);
    setText("");
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        value={text}
        placeholder={
          status === "running" ? "Ask anything…" : "Server not ready"
        }
        disabled={status !== "running"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-actions">
        {busy ? (
          <button className="control" onClick={() => actions.abort()}>
            Stop
          </button>
        ) : (
          <button
            className="control primary"
            onClick={send}
            disabled={status !== "running"}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
