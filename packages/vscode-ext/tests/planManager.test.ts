import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PlanManager } from "../src/plan/planManager";
import {
  buildImplementationPrompt,
  buildPlannerPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
} from "../src/plan/planPrompts";
import type { PlanManagerConfig } from "../src/plan/planManager";
import type { OpencodeClient } from "../src/protocol/client";
import type { ParsedEvent } from "../src/protocol/sseParser";

function makeConfig(overrides: Partial<PlanManagerConfig> = {}): PlanManagerConfig {
  return {
    planFilePath: ".kimix/plan.md",
    planAgent: "",
    planMaxAttempts: 3,
    openPlanFileAfterGeneration: false,
    ...overrides,
  };
}

function makeSessionManager(
  events: ParsedEvent[] | (() => ParsedEvent[]) = [],
) {
  const getEvents = typeof events === "function" ? events : () => events;
  const client = {
    createSession: vi.fn(async (title?: string) => ({
      id: "plan-session",
      title,
    })),
    sendPromptAsync: vi.fn(async () => true),
    deleteSession: vi.fn(async () => true),
    streamEvents: async function* (
      _sessionId: string,
      _opts?: { signal?: AbortSignal },
    ) {
      for (const e of getEvents()) {
        yield e;
      }
    },
  } as unknown as OpencodeClient;

  return {
    clientInstance: client,
    createSession: client.createSession,
    sendPrompt: vi.fn(async () => {}),
    sessions: [],
    once: vi.fn(),
    off: vi.fn(),
  } as unknown as import("../src/session/sessionManager").SessionManager;
}

function parsed(partial: Partial<ParsedEvent>): ParsedEvent {
  return {
    type: "text",
    text: "",
    delta: "",
    toolName: "",
    toolStatus: "",
    toolCallID: "",
    toolTitle: "",
    toolInput: "",
    permissionID: "",
    finished: false,
    raw: {},
    ...partial,
  };
}

describe("planPrompts", () => {
  it("builds a planner prompt with instructions", () => {
    const p = buildPlannerPrompt("add login", "/ws/.kimix/plan.md");
    expect(p).toContain("add login");
    expect(p).toContain("/ws/.kimix/plan.md");
    expect(p).toContain("You are a planner");
  });

  it("builds a revision prompt with existing plan and feedback", () => {
    const p = buildRevisionPrompt("add login", "step 1", "more tests", "/ws/.kimix/plan.md");
    expect(p).toContain("add login");
    expect(p).toContain("step 1");
    expect(p).toContain("more tests");
  });

  it("builds an implementation prompt", () => {
    const p = buildImplementationPrompt(".kimix/plan.md", "step 1");
    expect(p).toContain("step 1");
    expect(p).toContain("Implement");
  });

  it("builds a review prompt", () => {
    const p = buildReviewPrompt(".kimix/plan.md", "step 1");
    expect(p).toContain("step 1");
    expect(p).toContain("Review the work");
  });
});

describe("PlanManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the streamed plan to the configured file on idle", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "hello ", text: "hello " }),
      parsed({ type: "text", delta: "world", text: "hello world" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig());

    await pm.enterPlanning("add feature");

    const planPath = path.join(tmpDir, ".kimix/plan.md");
    expect(fs.existsSync(planPath)).toBe(true);
    expect(fs.readFileSync(planPath, "utf-8")).toBe("hello world");
    expect(pm.getState().phase).toBe("reviewing");
  });

  it("falls back when configured path is outside workspace", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "ok", text: "ok" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(
      tmpDir,
      sm,
      makeConfig({ planFilePath: "../escape.md" }),
    );

    await pm.enterPlanning("x");

    const planPath = path.join(tmpDir, ".kimix/plan.md");
    expect(fs.existsSync(planPath)).toBe(true);
  });

  it("reuses the planning session for revisions", async () => {
    let call = 0;
    const sm = makeSessionManager(() => {
      call += 1;
      return call === 1
        ? [
            parsed({ type: "text", delta: "v1", text: "v1" }),
            parsed({ type: "session-idle", finished: true }),
          ]
        : [
            parsed({ type: "text", delta: "v2", text: "v2" }),
            parsed({ type: "session-idle", finished: true }),
          ];
    });
    const pm = new PlanManager(tmpDir, sm, makeConfig());

    await pm.enterPlanning("req");
    await pm.revisePlan("do better");

    expect(sm.clientInstance.createSession).toHaveBeenCalledTimes(1);
    const planPath = path.join(tmpDir, ".kimix/plan.md");
    expect(fs.readFileSync(planPath, "utf-8")).toBe("v2");
  });

  it("caps revisions at maxAttempts", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "v1", text: "v1" }),
      parsed({ type: "session-idle", finished: true }),
      parsed({ type: "text", delta: "v2", text: "v2" }),
      parsed({ type: "session-idle", finished: true }),
      parsed({ type: "text", delta: "v3", text: "v3" }),
      parsed({ type: "session-idle", finished: true }),
      parsed({ type: "text", delta: "v4", text: "v4" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig({ planMaxAttempts: 2 }));

    await pm.enterPlanning("req");
    await pm.revisePlan("a");
    await pm.revisePlan("b");

    expect(pm.getState().phase).toBe("reviewing");
    expect(pm.getState().error).toContain("Maximum revision attempts");
    expect(pm.getState().attempt).toBe(2);
  });

  it("deletes the plan file on discard", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "plan", text: "plan" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig());

    await pm.enterPlanning("req");
    await pm.discardPlan();

    const planPath = path.join(tmpDir, ".kimix/plan.md");
    expect(fs.existsSync(planPath)).toBe(false);
    expect(pm.getState().phase).toBe("idle");
  });

  it("emits text events while generating", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "a", text: "a" }),
      parsed({ type: "text", delta: "b", text: "ab" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig());
    const texts: string[] = [];
    pm.on("text", (_delta, full) => texts.push(full));

    await pm.enterPlanning("req");

    expect(texts).toEqual(["a", "ab"]);
  });

  it("selects configured plan agent", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "plan", text: "plan" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(
      tmpDir,
      sm,
      makeConfig({ planAgent: "my-planner" }),
    );

    await pm.enterPlanning("req");

    expect(sm.clientInstance.sendPromptAsync).toHaveBeenCalledWith(
      "plan-session",
      expect.objectContaining({ agent: "my-planner" }),
    );
  });

  it("auto-detects a planner agent from the catalogue", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "plan", text: "plan" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig());
    pm.setAgents([{ name: "todo-maker" }, { name: "worker" }]);

    await pm.enterPlanning("req");

    expect(sm.clientInstance.sendPromptAsync).toHaveBeenCalledWith(
      "plan-session",
      expect.objectContaining({ agent: "todo-maker" }),
    );
  });

  it("sends the implementation prompt and review prompt", async () => {
    const sm = makeSessionManager([
      parsed({ type: "text", delta: "plan", text: "plan" }),
      parsed({ type: "session-idle", finished: true }),
    ]);
    const pm = new PlanManager(tmpDir, sm, makeConfig());

    await pm.enterPlanning("req");
    await pm.implementPlan();

    const idleHandler = (sm.once as ReturnType<typeof vi.fn>).mock.calls[0][1];
    await idleHandler();

    expect(sm.sendPrompt).toHaveBeenCalledTimes(2);
    expect(sm.sendPrompt).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("Implement the following plan"),
      expect.any(Object),
    );
    expect(sm.sendPrompt).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("Review the work"),
      expect.any(Object),
    );
  });
});
