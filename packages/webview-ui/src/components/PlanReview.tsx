import { useState } from "react";
import { actions, useStore } from "../store";

/**
 * Review affordance shown when a plan has been generated and is awaiting a
 * decision: implement, revise, or discard.
 */
export function PlanReview() {
  const planState = useStore((s) => s.ui.planState);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  if (planState.phase !== "reviewing") {
    return null;
  }

  const handleImplement = () => {
    setShowFeedback(false);
    setFeedback("");
    actions.implementPlan();
  };

  const handleRevise = () => {
    if (!showFeedback) {
      setShowFeedback(true);
      return;
    }
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    const turnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    actions.revisePlan(trimmed, turnId);
    setFeedback("");
    setShowFeedback(false);
  };

  const handleDiscard = () => {
    setShowFeedback(false);
    setFeedback("");
    actions.discardPlan();
  };

  return (
    <div className="plan-review">
      <div className="plan-review-header">
        <span className="plan-review-title">Review plan</span>
        {planState.planFile && (
          <button
            className="plan-file-link"
            onClick={() => actions.openPlanFile()}
            title={planState.planFile.absolutePath}
          >
            {planState.planFile.path}
          </button>
        )}
      </div>

      {showFeedback && (
        <textarea
          className="plan-feedback-input"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What should change in the plan?"
          rows={3}
          autoFocus
        />
      )}

      <div className="plan-review-actions">
        <button
          className="control primary"
          onClick={handleImplement}
          title="Implement this plan"
        >
          Implement Plan
        </button>
        <button
          className="control"
          onClick={handleRevise}
          title={showFeedback ? "Submit feedback" : "Revise plan with feedback"}
        >
          {showFeedback ? "Submit Feedback" : "Revise Plan"}
        </button>
        {showFeedback && (
          <button
            className="control"
            onClick={() => setShowFeedback(false)}
            title="Cancel revision"
          >
            Cancel
          </button>
        )}
        <div className="plan-review-spacer" />
        <button
          className="control danger"
          onClick={handleDiscard}
          title="Discard the plan"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
