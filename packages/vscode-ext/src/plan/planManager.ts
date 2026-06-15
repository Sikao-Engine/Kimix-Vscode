import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { Logger } from "../logger";
import { SessionManager } from "../session/sessionManager";
import {
  buildImplementationPrompt,
  buildPlannerPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
} from "./planPrompts";
import type { PlanFileInfo, PlanPhase, PlanState } from "../protocol/messages";
import type { Agent } from "../protocol/types";

export interface PlanManagerConfig {
  planFilePath: string;
  planAgent: string;
  planMaxAttempts: number;
  openPlanFileAfterGeneration: boolean;
}

export interface PlanManagerEvents {
  state: (state: PlanState) => void;
  text: (
    delta: string,
    full: string,
    kind: "text" | "reasoning",
    turnId?: string,
  ) => void;
  idle: () => void;
  error: (message: string) => void;
  aborted: (turnId?: string) => void;
}

const FALLBACK_PLAN_PATH = ".kimix/plan.md";
const PLANNER_AGENT_NAMES = ["planner", "todo-maker", "plan"];

/**
 * Host-side orchestrator for plan mode.
 *
 * Owns a dedicated planning session, accumulates streamed plan text, writes it
 * to a workspace plan file on idle, and drives the review loop.
 */
export class PlanManager extends EventEmitter {
  private state: PlanState;
  private planningSessionId: string | undefined;
  private requirement: string | undefined;
  private buffer = "";
  private streamAbort: AbortController | undefined;
  private currentTurnId: string | undefined;
  private planFileInfo: PlanFileInfo | undefined;
  private agents: Agent[] = [];
  private implementationIdleHandler: (() => void) | undefined;

  constructor(
    private workspaceRoot: string,
    private sessionManager: SessionManager,
    private config: PlanManagerConfig,
  ) {
    super();
    this.state = {
      phase: "idle",
      attempt: 0,
      maxAttempts: config.planMaxAttempts,
    };
  }

  getState(): PlanState {
    return { ...this.state };
  }

  getCurrentTurnId(): string | undefined {
    return this.currentTurnId;
  }

  /**
   * Start a new planning cycle: create/reuse a planning session, send the
   * planner prompt, and stream the response into the plan file.
   */
  async enterPlanning(requirement: string, turnId?: string): Promise<void> {
    if (this.isActive()) {
      this.setError("A planning cycle is already active");
      return;
    }

    this.requirement = requirement;
    this.currentTurnId = turnId;
    this.buffer = "";
    this.state.attempt = 1;
    this.setError(undefined);

    try {
      this.planFileInfo = this.resolvePlanFile();
      await this.deleteStalePlanFile();
      this.setPhase("generating");

      await this.ensurePlanningSession(requirement);
      const agent = this.pickPlannerAgent();
      const prompt = buildPlannerPrompt(
        requirement,
        this.planFileInfo.absolutePath,
      );

      await this.sessionManager.clientInstance.sendPromptAsync(
        this.planningSessionId!,
        { text: prompt, agent },
      );

      await this.consumeStream(this.planningSessionId!);
    } catch (err) {
      this.setError(String(err));
    }
  }

  /**
   * Regenerate the plan incorporating user feedback.
   */
  async revisePlan(feedback: string, turnId?: string): Promise<void> {
    if (this.state.phase !== "reviewing") {
      this.setError("No plan is being reviewed");
      return;
    }
    if (this.state.attempt >= this.state.maxAttempts) {
      this.setError(`Maximum revision attempts (${this.state.maxAttempts}) reached`);
      return;
    }
    if (!this.planFileInfo || !this.requirement) {
      this.setError("Plan context is missing");
      return;
    }

    this.currentTurnId = turnId;
    this.buffer = "";
    this.state.attempt += 1;
    this.state.revisionPrompt = feedback;
    this.setError(undefined);

    try {
      const existing = await fs.promises.readFile(
        this.planFileInfo.absolutePath,
        "utf-8",
      );
      this.setPhase("revising");

      await this.ensurePlanningSession(this.requirement);
      const agent = this.pickPlannerAgent();
      const prompt = buildRevisionPrompt(
        this.requirement,
        existing,
        feedback,
        this.planFileInfo.absolutePath,
      );

      await this.sessionManager.clientInstance.sendPromptAsync(
        this.planningSessionId!,
        { text: prompt, agent },
      );

      await this.consumeStream(this.planningSessionId!);
    } catch (err) {
      this.setError(String(err));
    }
  }

  /**
   * Switch to implementation: send the plan content to the regular worker
   * session, then follow up with a review prompt.
   */
  async implementPlan(
    agent?: string,
    model?: { providerID: string; modelID: string },
  ): Promise<void> {
    if (!this.planFileInfo) {
      this.setError("No plan file available");
      return;
    }

    this.setPhase("implementing");
    this.abortPlanning();

    try {
      const content = await fs.promises.readFile(
        this.planFileInfo.absolutePath,
        "utf-8",
      );

      if (this.planningSessionId) {
        await this.sessionManager.clientInstance
          .deleteSession(this.planningSessionId)
          .catch(() => {});
        this.planningSessionId = undefined;
      }

      const implPrompt = buildImplementationPrompt(
        this.planFileInfo.path,
        content,
      );
      await this.sessionManager.sendPrompt(implPrompt, { agent, model });

      const reviewPrompt = buildReviewPrompt(this.planFileInfo.path, content);
      const onIdle = async () => {
        this.clearImplementationIdleHandler();
        await this.sessionManager.sendPrompt(reviewPrompt, { agent, model });
        this.resetState();
      };
      this.implementationIdleHandler = onIdle;
      this.sessionManager.once("idle", onIdle);
    } catch (err) {
      this.setError(String(err));
    }
  }

  /**
   * Discard the current plan: delete the plan file and reset state.
   */
  async discardPlan(): Promise<void> {
    this.abortPlanning();
    if (this.planningSessionId) {
      await this.sessionManager.clientInstance
        .deleteSession(this.planningSessionId)
        .catch(() => {});
      this.planningSessionId = undefined;
    }
    if (this.planFileInfo?.absolutePath) {
      try {
        await fs.promises.unlink(this.planFileInfo.absolutePath);
      } catch {
        // ignore missing file
      }
    }
    this.resetState();
  }

  /**
   * Abort an in-flight planning stream without deleting the previous plan file.
   */
  abortPlanning(): void {
    const turnId = this.currentTurnId;
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    if (this.state.phase === "generating" || this.state.phase === "revising") {
      this.buffer = "";
      this.setPhase("idle");
    }
    this.emit("aborted", turnId);
  }

  /**
   * Provide the current agent catalogue so the manager can auto-detect a
   * planner agent when none is explicitly configured.
   */
  setAgents(agents: Agent[]): void {
    this.agents = agents;
  }

  updateConfig(config: Partial<PlanManagerConfig>): void {
    this.config = { ...this.config, ...config };
    this.state.maxAttempts = this.config.planMaxAttempts;
  }

  dispose(): void {
    this.clearImplementationIdleHandler();
    this.abortPlanning();
    this.removeAllListeners();
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private isActive(): boolean {
    return this.state.phase === "generating" || this.state.phase === "revising";
  }

  private resolvePlanFile(): PlanFileInfo {
    const candidate = this.config.planFilePath || FALLBACK_PLAN_PATH;
    let abs = path.resolve(this.workspaceRoot, candidate);
    let rel = path.relative(this.workspaceRoot, abs);

    if (!isSubPath(this.workspaceRoot, abs)) {
      Logger.warn(
        `[plan] configured path "${candidate}" is outside workspace; falling back`,
      );
      abs = path.resolve(this.workspaceRoot, FALLBACK_PLAN_PATH);
      rel = FALLBACK_PLAN_PATH;
    }

    if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) {
      Logger.warn(
        `[plan] configured path "${abs}" is not a file; falling back`,
      );
      abs = path.resolve(this.workspaceRoot, FALLBACK_PLAN_PATH);
      rel = FALLBACK_PLAN_PATH;
    }

    return {
      path: rel.replace(/\\/g, "/"),
      absolutePath: abs,
      exists: fs.existsSync(abs) && fs.statSync(abs).isFile(),
    };
  }

  private async deleteStalePlanFile(): Promise<void> {
    if (!this.planFileInfo) {
      return;
    }
    try {
      if (fs.existsSync(this.planFileInfo.absolutePath)) {
        await fs.promises.unlink(this.planFileInfo.absolutePath);
      }
      this.planFileInfo.exists = false;
    } catch (err) {
      Logger.error("[plan] failed to delete stale plan file", String(err));
    }
  }

  private async ensurePlanningSession(requirement: string): Promise<void> {
    if (this.planningSessionId) {
      return;
    }
    const title = `Plan: ${summarize(requirement)}`;
    const session = await this.sessionManager.createSession(title);
    this.planningSessionId = session.id;
  }

  private pickPlannerAgent(): string | undefined {
    const configured = this.config.planAgent.trim();
    if (configured) {
      return configured;
    }

    for (const name of PLANNER_AGENT_NAMES) {
      const match = this.agents.find(
        (a) => a.name.toLowerCase() === name || a.name.toLowerCase().includes(name),
      );
      if (match) {
        return match.name;
      }
    }
    return undefined;
  }

  private async consumeStream(sessionId: string): Promise<void> {
    this.streamAbort = new AbortController();
    try {
      for await (const e of this.sessionManager.clientInstance.streamEvents(
        sessionId,
        { signal: this.streamAbort.signal },
      )) {
        if (this.streamAbort.signal.aborted) {
          return;
        }
        switch (e.type) {
          case "text":
          case "reasoning": {
            const delta = e.delta || "";
            const full = e.text || this.buffer + delta;
            if (e.type === "text") {
              this.buffer = full;
            }
            this.emit(
              "text",
              delta,
              e.type === "text" ? this.buffer : full,
              e.type,
              this.currentTurnId,
            );
            break;
          }
          case "session-idle": {
            await this.flushBuffer();
            this.planFileInfo = this.resolvePlanFile();
            this.setPhase("reviewing");
            this.emit("idle");
            return;
          }
        }
      }
    } catch (err) {
      if (this.streamAbort.signal.aborted) {
        return;
      }
      throw err;
    } finally {
      this.streamAbort = undefined;
    }
  }

  private async flushBuffer(): Promise<void> {
    if (!this.planFileInfo || !this.buffer) {
      return;
    }
    try {
      await fs.promises.mkdir(path.dirname(this.planFileInfo.absolutePath), {
        recursive: true,
      });
      await fs.promises.writeFile(
        this.planFileInfo.absolutePath,
        this.buffer,
        "utf-8",
      );
      this.planFileInfo.exists = true;
    } catch (err) {
      Logger.error("[plan] failed to write plan file", String(err));
      throw err;
    }
  }

  private setPhase(phase: PlanPhase): void {
    this.state.phase = phase;
    this.emitState();
  }

  private setError(error: string | undefined): void {
    this.state.error = error;
    if (error) {
      Logger.error("[plan]", error);
    }
    this.emitState();
  }

  private resetState(): void {
    this.clearImplementationIdleHandler();
    this.state = {
      phase: "idle",
      attempt: 0,
      maxAttempts: this.config.planMaxAttempts,
    };
    this.requirement = undefined;
    this.currentTurnId = undefined;
    this.buffer = "";
    this.planFileInfo = undefined;
    this.emitState();
  }

  private clearImplementationIdleHandler(): void {
    if (this.implementationIdleHandler) {
      this.sessionManager.off("idle", this.implementationIdleHandler);
      this.implementationIdleHandler = undefined;
    }
  }

  private emitState(): void {
    this.state.planFile = this.planFileInfo;
    this.state.requirement = this.requirement;
    this.emit("state", { ...this.state });
  }
}

function isSubPath(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  const rel = path.relative(p, c);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function summarize(text: string, max = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return normalized.slice(0, max - 1) + "…";
}
