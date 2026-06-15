import { useState } from "react";
import { useStore } from "../store";

/** Prompts queued while the model is busy, shown above the composer. */
export function PendingQueue() {
  const pending = useStore((s) => s.pending);
  const remove = useStore((s) => s.removePending);
  const edit = useStore((s) => s.editPending);
  const reorder = useStore((s) => s.reorderPending);
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);

  if (pending.length === 0) {
    return null;
  }

  return (
    <div className="pending-queue" aria-label="Pending prompts">
      {pending.map((p) => (
        <div
          key={p.id}
          draggable={pending.length > 1}
          className={`pending-item ${p.locked ? "locked" : ""} ${draggingId === p.id ? "dragging" : ""}`}
          aria-label={p.locked ? "Next pending prompt" : "Pending prompt"}
          onDragStart={() => setDraggingId(p.id)}
          onDragEnd={() => setDraggingId(undefined)}
          onDragOver={(e) => {
            e.preventDefault();
            if (p.id !== draggingId && draggingId) {
              reorder(draggingId, p.id);
            }
          }}
        >
          <span className="pending-drag" aria-hidden="true">
            ☰
          </span>
          <span className="pending-status">{p.locked ? "▶" : "○"}</span>
          <span className="pending-text">{p.text}</span>
          {p.attachments.length > 0 && (
            <span className="pending-attachments">
              {p.attachments.map((a) => (
                <span key={a.id} className="pending-attachment">
                  @{a.label}
                </span>
              ))}
            </span>
          )}
          <div className="pending-actions">
            {!p.locked && (
              <button
                className="pending-action"
                onClick={() => edit(p.id)}
                title="Edit prompt"
                aria-label="Edit prompt"
              >
                ✎
              </button>
            )}
            <button
              className="pending-action"
              onClick={() => remove(p.id)}
              title="Remove prompt"
              aria-label="Remove prompt"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
