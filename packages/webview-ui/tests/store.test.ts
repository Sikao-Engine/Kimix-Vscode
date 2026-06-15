import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../src/store";

function resetStore() {
  useStore.setState({
    messages: [],
    stream: [],
    tools: [],
    busy: false,
    activeTurnId: undefined,
    pending: [],
    reasoningCollapsed: {},
    globalReasoningCollapsed: false,
    attachments: [],
    fileList: [],
    symbolList: [],
    composerText: "",
    errorBanner: undefined,
  });
}

describe("store pending queue", () => {
  beforeEach(() => {
    resetStore();
  });

  it("enqueues the first item as locked", () => {
    useStore.getState().enqueuePrompt("first");
    const pending = useStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ text: "first", locked: true });
  });

  it("enqueues subsequent items as unlocked", () => {
    useStore.getState().enqueuePrompt("first");
    useStore.getState().enqueuePrompt("second");
    const pending = useStore.getState().pending;
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({ text: "first", locked: true });
    expect(pending[1]).toMatchObject({ text: "second", locked: false });
  });

  it("promotes the next item when the locked one is removed", () => {
    useStore.getState().enqueuePrompt("first");
    useStore.getState().enqueuePrompt("second");
    const firstId = useStore.getState().pending[0].id;
    useStore.getState().removePending(firstId);
    const pending = useStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ text: "second", locked: true });
  });

  it("refills composer text and attachments when editing a pending item", () => {
    useStore.getState().enqueuePrompt("first");
    useStore.getState().enqueuePrompt("second");
    const secondId = useStore.getState().pending[1].id;
    useStore.getState().editPending(secondId);
    expect(useStore.getState().composerText).toBe("second");
  });

  it("reorders pending items and keeps the first one locked", () => {
    useStore.getState().enqueuePrompt("first");
    useStore.getState().enqueuePrompt("second");
    useStore.getState().enqueuePrompt("third");
    const firstId = useStore.getState().pending[0].id;
    const thirdId = useStore.getState().pending[2].id;
    useStore.getState().reorderPending(thirdId, firstId);
    const pending = useStore.getState().pending;
    expect(pending[0].text).toBe("third");
    expect(pending[0].locked).toBe(true);
    expect(pending[1].text).toBe("first");
    expect(pending[2].text).toBe("second");
  });
});

describe("store reasoning collapse", () => {
  beforeEach(() => {
    resetStore();
  });

  it("toggles individual reasoning state", () => {
    useStore.getState().toggleReasoning("m1");
    expect(useStore.getState().reasoningCollapsed["m1"]).toBe(true);
    useStore.getState().toggleReasoning("m1");
    expect(useStore.getState().reasoningCollapsed["m1"]).toBe(false);
  });

  it("global collapse overrides individual state", () => {
    useStore.getState().collapseAllReasoning();
    expect(useStore.getState().globalReasoningCollapsed).toBe(true);
    useStore.getState().expandAllReasoning();
    expect(useStore.getState().globalReasoningCollapsed).toBe(false);
  });
});

describe("store streaming turn id", () => {
  beforeEach(() => {
    resetStore();
  });

  it("ignores stream events from a previous turn", () => {
    useStore.setState({ busy: true, activeTurnId: "turn-2" });
    useStore.getState().applyHostMessage({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "hi",
      full: "hi",
    });
    expect(useStore.getState().stream).toHaveLength(0);
  });

  it("accepts stream events for the current turn", () => {
    useStore.setState({ busy: true, activeTurnId: "turn-1" });
    useStore.getState().applyHostMessage({
      type: "streamText",
      sessionId: "s1",
      turnId: "turn-1",
      kind: "text",
      delta: "hi",
      full: "hi",
    });
    expect(useStore.getState().stream).toHaveLength(1);
    expect(useStore.getState().stream[0].text).toBe("hi");
  });

  it("stops generation and clears the active turn", () => {
    useStore.setState({ busy: true, activeTurnId: "turn-1" });
    useStore.getState().stopGeneration();
    expect(useStore.getState().busy).toBe(false);
    expect(useStore.getState().activeTurnId).toBeUndefined();
  });
});
