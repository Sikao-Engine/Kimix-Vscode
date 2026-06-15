import { useStore } from "../store";

interface ReasoningBlockProps {
  messageId: string;
  text: string;
}

export function ReasoningBlock({ messageId, text }: ReasoningBlockProps) {
  const collapsed =
    useStore((s) => s.globalReasoningCollapsed) ||
    useStore((s) => s.reasoningCollapsed[messageId]);
  const toggle = useStore((s) => s.toggleReasoning);

  return (
    <div className="reasoning-block">
      <button
        className="reasoning-toggle"
        onClick={() => toggle(messageId)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand reasoning" : "Collapse reasoning"}
      >
        <span className="reasoning-chevron">{collapsed ? "▶" : "▼"}</span>
        <span className="reasoning-label">Thinking</span>
      </button>
      {!collapsed && <pre className="part part-reasoning">{text}</pre>}
    </div>
  );
}
