import { actions, useStore } from "../store";

/**
 * Top control bar: agent picker, model picker, Plan Mode toggle, compact +
 * new-session buttons.
 */
export function Toolbar() {
  const ui = useStore((s) => s.ui);

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

  return (
    <div className="toolbar">
      <select
        className="control"
        value={ui.selectedAgent ?? ""}
        onChange={(e) => actions.selectAgent(e.target.value)}
        title="Agent"
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

      <button
        className={`control toggle ${ui.planMode === "plan" ? "active" : ""}`}
        onClick={() =>
          actions.setPlanMode(ui.planMode === "plan" ? "build" : "plan")
        }
        title="Toggle Plan Mode"
      >
        {ui.planMode === "plan" ? "Plan" : "Build"}
      </button>

      <button
        className="control"
        onClick={() => actions.compactContext()}
        title="Compact context"
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
    </div>
  );
}
