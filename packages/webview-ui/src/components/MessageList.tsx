import { useStore } from "../store";
import type { MessagePart } from "../protocol";

function partText(part: MessagePart): string {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text ?? "";
  }
  if (part.type === "tool") {
    const status =
      (part.state as { status?: string } | undefined)?.status ?? "";
    return `🔧 ${part.tool ?? "tool"} ${status}`.trim();
  }
  return "";
}

/** Renders persisted messages plus the in-flight streaming bubbles. */
export function MessageList() {
  const messages = useStore((s) => s.messages);
  const stream = useStore((s) => s.stream);
  const tools = useStore((s) => s.tools);
  const busy = useStore((s) => s.busy);
  const showThinking = true;

  return (
    <div className="messages">
      {messages.map((m) => (
        <div key={m.info.id} className={`msg msg-${m.info.role}`}>
          <div className="msg-role">{m.info.role}</div>
          {m.parts
            .filter((p) => showThinking || p.type !== "reasoning")
            .map((p, i) => {
              const text = partText(p);
              if (!text) {
                return null;
              }
              return (
                <pre key={i} className={`part part-${p.type}`}>
                  {text}
                </pre>
              );
            })}
        </div>
      ))}

      {stream.map((b) => (
        <div key={b.id} className="msg msg-assistant streaming">
          <pre className={`part part-${b.kind}`}>{b.text}</pre>
        </div>
      ))}

      {tools.length > 0 && (
        <div className="tools">
          {tools.map((t) => (
            <div key={t.callID} className={`tool tool-${t.status}`}>
              🔧 {t.toolName} — {t.status}
            </div>
          ))}
        </div>
      )}

      {busy && <div className="thinking">…</div>}
    </div>
  );
}
