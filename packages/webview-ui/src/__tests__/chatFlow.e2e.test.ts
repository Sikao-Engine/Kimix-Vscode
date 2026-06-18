// @vitest-environment jsdom
/**
 * End-to-end scenario tests for the webview store reducer.
 *
 * These drive the store exactly the way the real app does — by feeding it the
 * `HostToWebview` messages the extension host emits and the `actions.*`
 * wrappers the UI calls — and assert on the resulting projected state.
 *
 * They lock in the chat UX lifecycle:
 *   - the user's own prompt appears immediately;
 *   - streaming output remains visible after idle;
 *   - persisted transcript replacement happens only when a transcript loads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../vscodeApi", () => ({
  postToHost: vi.fn(),
  onHostMessage: () => () => {},
}));

import { useStore, actions } from "../store";
import { postToHost } from "../vscodeApi";
import type { HostToWebview, MessageWithParts } from "../protocol";

const post = postToHost as unknown as ReturnType<typeof vi.fn>;

function apply(msg: HostToWebview): void {
  useStore.getState().applyHostMessage(msg);
}

function userMessage(text: string): MessageWithParts {
  return {
    info: { id: "msg_user", role: "user" },
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(text: string): MessageWithParts {
  return {
    info: { id: "msg_asst", role: "assistant" },
    parts: [{ type: "text", text }],
  };
}

beforeEach(() => {
  post.mockClear();
  useStore.setState({
    messages: [],
    stream: [],
    tools: [],
    permission: undefined,
    busy: false,
    completedTurnId: undefined,
    activeTurnId: undefined,
    activePromptText: undefined,
    pending: [],
    reasoningCollapsed: {},
    globalReasoningCollapsed: false,
    attachments: [],
  });
});

describe("chat turn lifecycle (e2e)", () => {
  it("sending a prompt claims the turn and shows the user message immediately", () => {
    actions.sendPrompt("Hello", "turn-1");

    const s = useStore.getState();
    expect(s.busy).toBe(true);
    expect(s.activeTurnId).toBe("turn-1");
    expect(s.activePromptText).toBe("Hello");
    expect(post).toHaveBeenCalledWith({
      type: "sendPrompt",
      text: "Hello",
      turnId: "turn-1",
    });
  });

  it("streams assistant text into a single growing bubble", () => {
    actions.sendPrompt("Hello", "turn-1");

    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: " there",
      full: "Hi there",
    });

    const s = useStore.getState();
    expect(s.stream).toHaveLength(1);
    expect(s.stream[0].text).toBe("Hi there");
    expect(s.busy).toBe(true);
  });

  it("terminates the turn on idle without replacing the streaming transcript", () => {
    actions.sendPrompt("Hello", "turn-1");
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });

    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });

    const s = useStore.getState();
    expect(s.busy).toBe(false);
    expect(s.activeTurnId).toBeUndefined();
    expect(s.activePromptText).toBeUndefined();
    // User prompt should be archived into messages
    expect(s.messages.some((m) => m.info.role === "user" && m.parts[0]?.text === "Hello")).toBe(true);
    // Assistant response should be archived into messages
    expect(s.messages.some((m) => m.info.role === "assistant" && m.parts[0]?.text === "Hi")).toBe(true);
    // Stream bubble is cleared
    expect(s.stream).toHaveLength(0);
    expect(post).not.toHaveBeenCalledWith({ type: "refresh" });
  });

  it("replaces transient turn with persisted transcript when messages load", () => {
    actions.sendPrompt("Hello", "turn-1");
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });
    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });

    apply({
      type: "messages",
      sessionId: "s1",
      messages: [userMessage("Hello"), assistantMessage("Hi")],
    });

    const s = useStore.getState();
    expect(s.messages.map((m) => m.info.role)).toEqual(["user", "assistant"]);
    expect(s.messages[0].parts[0].text).toBe("Hello");
    // The transient streaming bubble is cleared by the persisted transcript.
    expect(s.stream).toHaveLength(0);
    expect(s.activePromptText).toBeUndefined();
    expect(s.busy).toBe(false);
  });

  it("ignores stale stream events from an aborted turn", () => {
    actions.sendPrompt("Hello", "turn-1");
    // User stops and a new turn begins.
    useStore.setState({ activeTurnId: "turn-2", busy: true, stream: [] });

    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1", // stale
      kind: "text",
      delta: "late",
      full: "late",
    });

    expect(useStore.getState().stream).toHaveLength(0);
  });

  it("promotes a queued prompt when the active turn goes idle", () => {
    actions.sendPrompt("first", "turn-1");
    useStore.getState().enqueuePrompt("second");

    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });

    const s = useStore.getState();
    expect(s.busy).toBe(true);
    expect(s.pending).toHaveLength(0);
    expect(s.activePromptText).toBe("second");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sendPrompt", text: "second" }),
    );
  });

  it("shows completion badge after a successful turn", () => {
    actions.sendPrompt("Hello", "turn-1");
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });
    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });
    apply({
      type: "completion",
      sessionId: "s1",
      turnId: "turn-1",
      status: "success",
    });

    const s = useStore.getState();
    expect(s.completedTurnId).toBe("turn-1");
    expect(s.busy).toBe(false);
  });

  it("completion badge clears when next turn starts", () => {
    actions.sendPrompt("First", "turn-1");
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });
    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });
    apply({
      type: "completion",
      sessionId: "s1",
      turnId: "turn-1",
      status: "success",
    });

    expect(useStore.getState().completedTurnId).toBe("turn-1");

    // Start a new turn
    actions.sendPrompt("Second", "turn-2");

    expect(useStore.getState().completedTurnId).toBeUndefined();
  });

  it("no completion badge after abort", () => {
    actions.sendPrompt("Hello", "turn-1");
    apply({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "Hi",
      full: "Hi",
    });
    apply({ type: "aborted", sessionId: "s1", turnId: "turn-1" });

    const s = useStore.getState();
    expect(s.completedTurnId).toBeUndefined();
    expect(s.busy).toBe(false);
  });

  it("pending queue: suppresses completion badge during auto-send", () => {
    actions.sendPrompt("first", "turn-1");
    useStore.getState().enqueuePrompt("second");

    // streamIdle archives turn and auto-sends the queued prompt
    apply({ type: "streamIdle", sessionId: "s1", turnId: "turn-1" });

    // Now busy is true again (auto-send), activeTurnId has changed
    const sAfterIdle = useStore.getState();
    expect(sAfterIdle.busy).toBe(true);

    // A late completion with the old turnId arrives
    apply({
      type: "completion",
      sessionId: "s1",
      turnId: "turn-1",
      status: "success",
    });

    // Stale completion should be ignored because activeTurnId changed
    expect(useStore.getState().completedTurnId).toBeUndefined();
  });
});
