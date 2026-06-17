import { useEffect, useRef, useState } from "react";
import { actions, useStore } from "../store";
import type { FileRef } from "../protocol";
import { MentionPicker } from "./MentionPicker";

/** Prompt input with @ mentions, attachments, and send/stop controls. */
export function Composer() {
  const text = useStore((s) => s.composerText);
  const setText = useStore((s) => s.setComposerText);
  const [mentionQuery, setMentionQuery] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSendRef = useRef<{ text: string; at: number } | undefined>(undefined);

  const busy = useStore((s) => s.busy);
  const status = useStore((s) => s.ui.status);
  const planMode = useStore((s) => s.ui.planMode);
  const planPhase = useStore((s) => s.ui.planState.phase);
  const attachments = useStore((s) => s.attachments);
  const insertAttachment = useStore((s) => s.insertFileRef);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const clearAttachments = useStore((s) => s.clearAttachments);
  const enqueuePrompt = useStore((s) => s.enqueuePrompt);
  const stopGeneration = useStore((s) => s.stopGeneration);

  const send = () => {
    const value = text.trim();
    if (!value && attachments.length === 0) {
      return;
    }
    const finalText = value || " ";

    const turnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const promptWithRefs = formatRefs(finalText, attachments);
    const now = Date.now();
    if (
      lastSendRef.current?.text === promptWithRefs &&
      now - lastSendRef.current.at < 500
    ) {
      return;
    }
    lastSendRef.current = { text: promptWithRefs, at: now };

    if (useStore.getState().busy) {
      if (planMode === "plan") {
        // Do not queue plan prompts; ignore while busy.
        return;
      }
      enqueuePrompt(finalText);
    } else if (planMode === "plan") {
      actions.generatePlan(promptWithRefs, turnId);
    } else {
      actions.sendPrompt(promptWithRefs, turnId);
    }

    setText("");
    clearAttachments();
    setMentionQuery(undefined);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    detectMention(value, e.target.selectionStart);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      mentionQuery !== undefined &&
      (e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === "Escape")
    ) {
      // Let MentionPicker handle these via its own listener, but prevent
      // default textarea behaviour (cursor moves / newline) while open.
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const detectMention = (value: string, cursor: number) => {
    if (!useStore.getState().ui.enableMentions) {
      setMentionQuery(undefined);
      return;
    }
    const before = value.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(undefined);
    }
  };

  const handleSelect = (
    path: string,
    label: string,
    kind: "file" | "symbol",
  ) => {
    const ref: FileRef = {
      id: `${kind}-${path}-${Date.now()}`,
      path,
      label,
      kind,
    };
    insertAttachment(ref);
    setMentionQuery(undefined);
    textareaRef.current?.focus();
  };

  const handleCloseMention = () => {
    setMentionQuery(undefined);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    // Auto-resize composer height.
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const canSend = status === "running";
  const isReviewing = planPhase === "reviewing";
  const isPlanning = planMode === "plan";

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((a) => (
            <span key={a.id} className="attachment-chip">
              @{a.label}
              <button
                className="attachment-remove"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-input-wrap">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={text}
          placeholder={
            isReviewing
              ? "Review the plan above"
              : canSend
                ? isPlanning
                  ? "Describe what to plan… (type @ to reference a file)"
                  : "Ask anything… (type @ to reference a file)"
                : "Server not ready"
          }
          disabled={!canSend || isReviewing}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Prompt input"
        />
        {mentionQuery !== undefined && (
          <MentionPicker
            query={mentionQuery}
            onSelect={handleSelect}
            onClose={handleCloseMention}
          />
        )}
      </div>

      <div className="composer-actions">
        {busy ? (
          <button className="control" onClick={() => stopGeneration()}>
            Stop
          </button>
        ) : (
          <button
            className="control primary"
            onClick={send}
            disabled={
              !canSend ||
              isReviewing ||
              (!text.trim() && attachments.length === 0)
            }
          >
            {isPlanning && !isReviewing ? "Generate Plan" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}

function formatRefs(text: string, attachments: FileRef[]): string {
  if (attachments.length === 0) {
    return text;
  }
  const refs = attachments.map((a) => `@${a.path}`).join(" ");
  return `${refs}\n\n${text}`;
}
