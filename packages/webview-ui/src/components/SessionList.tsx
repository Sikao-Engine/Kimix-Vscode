import { actions, useStore } from "../store";

/** Collapsible left rail listing sessions; click to switch, × to delete. */
export function SessionList() {
  const sessions = useStore((s) => s.ui.sessions);
  const current = useStore((s) => s.ui.currentSessionId);

  return (
    <div className="sessions">
      {sessions.length === 0 && (
        <div className="sessions-empty">No sessions yet</div>
      )}
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`session ${s.id === current ? "active" : ""}`}
          onClick={() => actions.selectSession(s.id)}
        >
          <span className="session-title">
            {s.title || s.id.slice(0, 8)}
          </span>
          <button
            className="session-delete"
            title="Delete session"
            onClick={(e) => {
              e.stopPropagation();
              actions.deleteSession(s.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
