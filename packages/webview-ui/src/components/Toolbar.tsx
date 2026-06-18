import { actions, useStore } from "../store";
import type { PlanPhase } from "../protocol";

function planPhaseLabel(phase: PlanPhase): string {
  switch (phase) {
    case "generating":
      return "Generating plan…";
    case "reviewing":
      return "Review plan";
    case "revising":
      return "Revising plan…";
    case "implementing":
      return "Implementing plan…";
    default:
      return "";
  }
}

/**
 * Top control bar: agent picker, model picker, session picker, plan mode,
 * reasoning collapse controls, compact + new-session buttons.
 */
export function Toolbar() {
  const ui = useStore((s) => s.ui);
  const collapseAll = useStore((s) => s.collapseAllReasoning);
  const expandAll = useStore((s) => s.expandAllReasoning);

  const allModels = ui.providers.flatMap((p) =>
    p.models.map((m) => ({
      providerID: p.id,
      modelID: m.id,
      label: `${p.name ?? p.id} / ${m.name ?? m.id}`,
    })),
  );
  const selectedModelKey = ui.selectedModel
    ? `${ui.selectedModel.providerID}::${ui.selectedModel.modelID}`
    : "";

  const currentSession = ui.sessions.find((s) => s.id === ui.currentSessionId);

  // Extension feature: Compact is only usable if the connected server
  // advertises it via /experimental/features. Missing/disabled → button
  // disabled with an explanatory hint.
  const compactFeature = ui.features?.compact;
  const compactEnabled = Boolean(compactFeature?.enabled);
  const compactHint = compactEnabled
    ? compactFeature?.description ?? "Compact context"
    : compactFeature?.description
      ? `Unavailable: ${compactFeature.description}`
      : "Compact is not supported by the connected server";

  return (
    <div className="toolbar">
      <select
        className="control"
        value={ui.selectedAgent ?? ""}
        onChange={(e) => actions.selectAgent(e.target.value)}
        title="Agent"
        aria-label="Agent"
      >
        {ui.agents.length === 0 && <option value="">(no agents)</option>}
        {ui.agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        className="control"
        value={selectedModelKey}
        onChange={(e) => {
          const [providerID, modelID] = e.target.value.split("::");
          actions.selectModel(providerID, modelID);
        }}
        title="Model"
        aria-label="Model"
      >
        {allModels.length === 0 && <option value="">(no models)</option>}
        {allModels.map((m) => (
          <option
            key={`${m.providerID}::${m.modelID}`}
            value={`${m.providerID}::${m.modelID}`}
          >
            {m.label}
          </option>
        ))}
      </select>

      <select
        className="control session-picker"
        value={ui.currentSessionId ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          if (id) {
            actions.selectSession(id);
          }
        }}
        title="Session"
        aria-label="Session"
      >
        {ui.sessions.length === 0 && (
          <option value="">(no sessions)</option>
        )}
        {ui.sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || s.id.slice(0, 8)}
          </option>
        ))}
      </select>

      <button
        className={`control toggle ${ui.planMode === "plan" ? "active" : ""}`}
        onClick={() =>
          actions.setPlanMode(ui.planMode === "plan" ? "build" : "plan")
        }
        title="Toggle Plan Mode"
      >
        {ui.planMode === "plan" ? "Plan" : "Build"}
        {ui.planState.phase !== "idle" && ui.planState.phase !== "implementing" && (
          <span className="plan-dot" title={planPhaseLabel(ui.planState.phase)}>
            ●
          </span>
        )}
      </button>

      <button
        className="control"
        onClick={() => collapseAll()}
        title="Collapse all reasoning"
        aria-label="Collapse all reasoning"
      >
        ⊟
      </button>

      <button
        className="control"
        onClick={() => expandAll()}
        title="Expand all reasoning"
        aria-label="Expand all reasoning"
      >
        ⊞
      </button>

      <button
        className="control"
        onClick={() => actions.compactContext()}
        disabled={!compactEnabled}
        title={compactHint}
        aria-disabled={!compactEnabled}
      >
        Compact
      </button>

      <button
        className="control"
        onClick={() => actions.newSession()}
        title="New session"
      >
        New
      </button>

      {currentSession && (
        <button
          className="control danger"
          onClick={() => actions.deleteSession(currentSession.id)}
          title="Delete current session"
          aria-label="Delete current session"
        >
          ×
        </button>
      )}

      <div className="toolbar-spacer" />

      {ui.serverInfo && ui.status === "running" && (
        <span
          className={`control status-chip ${ui.serverInfo.owned ? "owned" : "foreign"}`}
          title={
            ui.serverInfo.owned
              ? `Running on port ${ui.serverInfo.port}${
                  ui.serverInfo.basePort &&
                  ui.serverInfo.port !== ui.serverInfo.basePort
                    ? ` (fallback from ${ui.serverInfo.basePort})`
                    : ""
                }`
              : `Reused foreign server on port ${ui.serverInfo.port}`
          }
        >
          {ui.serverInfo.owned ? "●" : "◐"} {ui.serverInfo.port}
        </span>
      )}

      {ui.status === "running" ? (
        <>
          <button
            className="control"
            onClick={() => actions.restartServer()}
            title="Restart server"
          >
            ↻
          </button>
          <button
            className="control danger"
            onClick={() => actions.stopServer()}
            title="Stop server"
          >
            ■
          </button>
        </>
      ) : (
        <button
          className="control primary"
          onClick={() => actions.startServer()}
          disabled={ui.status === "starting"}
          title="Start server"
        >
          ▶
        </button>
      )}
    </div>
  );
}
