import { useStore } from "../store";

interface ReasoningBlockProps {
  messageId: string;
  text: string;
}

export function ReasoningBlock({ messageId, text }: ReasoningBlockProps) {
  // NOTE: both selectors must be called unconditionally every render.
  // Combining them with `||` *inside* the hook call list (e.g.
  // `useStore(a) || useStore(b)`) short-circuits the second hook when the
  // first is truthy, which violates the Rules of Hooks and crashes the whole
  // webview ("rendered fewer hooks than expected") the moment reasoning is
  // collapsed. Read each value separately, then combine.
  const globalCollapsed = useStore((s) => s.globalReasoningCollapsed);
  const localCollapsed = useStore((s) => s.reasoningCollapsed[messageId]);
  const collapsed = globalCollapsed || Boolean(localCollapsed);
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
