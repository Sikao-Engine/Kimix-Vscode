import { useEffect, useRef } from "react";
import { actions, useStore } from "../store";
import type { MessagePart } from "../protocol";
import { ReasoningBlock } from "./ReasoningBlock";
import { MarkdownRenderer } from "./MarkdownRenderer";

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

function formatTime(iso?: string): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modelLabel(
  providerID?: string,
  modelID?: string,
  providers?: { id: string; name?: string; models: { id: string; name?: string }[] }[],
): string {
  if (!providerID || !modelID) {
    return "";
  }
  const provider = providers?.find((p) => p.id === providerID);
  const model = provider?.models.find((m) => m.id === modelID);
  const pName = provider?.name ?? providerID;
  const mName = model?.name ?? modelID;
  return `${pName} / ${mName}`;
}

/** Renders persisted messages plus the in-flight streaming bubbles. */
export function MessageList() {
  const messages = useStore((s) => s.messages);
  const stream = useStore((s) => s.stream);
  const activePromptText = useStore((s) => s.activePromptText);
  const tools = useStore((s) => s.tools);
  const busy = useStore((s) => s.busy);
  const completedTurnId = useStore((s) => s.completedTurnId);
  const activeTurnId = useStore((s) => s.activeTurnId);
  const providers = useStore((s) => s.ui.providers);
  const showThinking = useStore((s) => s.ui.showThinking);
  const autoScroll = useStore((s) => s.ui.autoScroll);
  const planState = useStore((s) => s.ui.planState);
  const isPlanStream =
    planState.phase === "generating" ||
    planState.phase === "revising" ||
    planState.phase === "reviewing";

  const endRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollRef = useRef(true);

  useEffect(() => {
    if (!autoScroll || !shouldScrollRef.current) {
      return;
    }
    const list = listRef.current;
    const end = endRef.current;
    if (!list || !end) {
      return;
    }
    const isNearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    if (isNearBottom || busy) {
      end.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, activePromptText, stream, tools, busy, autoScroll]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const isNearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    shouldScrollRef.current = isNearBottom;
  };

  return (
    <div className="messages" ref={listRef} onScroll={handleScroll}>
      {messages.map((m, i) => {
        const isAssistant = m.info.role === "assistant";
        const time = formatTime(m.info.createdAt);
        const mLabel = isAssistant
          ? modelLabel(m.info.providerID, m.info.modelID, providers)
          : "";

        return (
          <div
            key={m.info.id}
            className={`msg msg-${m.info.role}`}
            aria-label={`${m.info.role} message`}
          >
            <div className="msg-meta">
              <span className="msg-role">{m.info.role}</span>
              {time && (
                <span className="msg-time" title={m.info.createdAt}>
                  {time}
                </span>
              )}
              {mLabel && <span className="msg-model">{mLabel}</span>}
            </div>
            {m.parts
              .filter((p) => showThinking || p.type !== "reasoning")
              .map((p, i) => {
                if (p.type === "reasoning") {
                  return (
                    <ReasoningBlock
                      key={i}
                      messageId={m.info.id}
                      text={p.text ?? ""}
                    />
                  );
                }
                const text = partText(p);
                if (!text) {
                  return null;
                }
                if (p.type === "text" && m.info.role === "assistant") {
                  return (
                    <MarkdownRenderer
                      key={i}
                      className="part part-text markdown-body"
                      text={text}
                    />
                  );
                }
                return (
                  <pre key={i} className={`part part-${p.type}`}>
                    {text}
                  </pre>
                );
              })}
          {/* Completion indicator on the last assistant message when turn is complete */}
          {!busy &&
            !activeTurnId &&
            completedTurnId &&
            m.info.role === "assistant" &&
            i === messages.length - 1 &&
            planState.phase === "idle" &&
            !isPlanStream && (
              <div className="completion-badge">✓ Done</div>
            )}
          </div>
        );
      })}

      {activePromptText && !isPlanStream && (
        <div className="msg msg-user" aria-label="user message">
          <div className="msg-meta">
            <span className="msg-role">user</span>
          </div>
          <pre className="part part-text user-text">{activePromptText}</pre>
        </div>
      )}

      {(stream.length > 0 || tools.length > 0 || busy) && (
        <div
          className={`msg msg-assistant streaming ${isPlanStream ? "plan-stream" : ""}`}
          aria-busy="true"
        >
          <div className="msg-meta">
            <span className="msg-role">{isPlanStream ? "plan" : "assistant"}</span>
            {planState.phase === "reviewing" && planState.planFile && (
              <button
                className="plan-file-link"
                onClick={() => actions.openPlanFile()}
                title={planState.planFile.absolutePath}
              >
                {planState.planFile.path}
              </button>
            )}
            {planState.phase !== "reviewing" && (
              <span className="msg-model streaming-label">
                {isPlanStream ? "Planning…" : "Generating…"}
              </span>
            )}
          </div>
          {stream.map((b) =>
            b.kind === "reasoning" ? (
              <ReasoningBlock
                key={b.id}
                messageId={`stream-${b.id}`}
                text={b.text}
              />
            ) : (
              <MarkdownRenderer
                key={b.id}
                className="part part-text markdown-body"
                text={b.text}
              />
            ),
          )}

          {tools.length > 0 && (
            <div className="tools">
              {tools.map((t) => (
                <div key={t.callID} className={`tool tool-${t.status}`}>
                  🔧 {t.toolName} — {t.status}
                </div>
              ))}
            </div>
          )}

          {busy && stream.length === 0 && tools.length === 0 && (
            <div className="skeleton" aria-hidden="true">
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          )}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
