/**
 * Pure prompt templates for plan mode. No VS Code dependencies.
 */

export function buildPlannerPrompt(requirement: string, planFilePath: string): string {
  return `You are a planner. Plan only. Do not implement.

Read the following requirement carefully and generate a comprehensive, actionable plan. The plan will be written to the file at ${planFilePath} by the host, so output the complete plan directly in your response.

Requirement:
${requirement}
`;
}

export function buildRevisionPrompt(
  requirement: string,
  existingPlan: string,
  feedback: string,
  planFilePath: string,
): string {
  return `You are a planner. Plan only. Do not implement.

Revise the existing plan based on the feedback below. Output the complete revised plan in your response; the host will overwrite the plan file at ${planFilePath}.

Original requirement:
${requirement}

Existing plan:
${existingPlan}

Feedback:
${feedback}
`;
}

export function buildImplementationPrompt(planFilePath: string, planContent: string): string {
  return `Implement the following plan. Edit files as needed to fulfill every step.

Plan file: ${planFilePath}

Plan:
${planContent}
`;
}

export function buildReviewPrompt(planFilePath: string, planContent: string): string {
  return `Review the work against the original plan. Confirm what was completed and note any deviations or remaining tasks.

Plan file: ${planFilePath}

Plan:
${planContent}
`;
}
