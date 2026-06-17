// @vitest-environment jsdom
/**
 * Regression test for the reasoning-collapse crash (Bug B).
 *
 * The original `ReasoningBlock` combined two `useStore` selector calls with
 * `||` inside the hook list, so the second hook was skipped whenever the first
 * (global collapse) was truthy. Toggling "collapse all" therefore changed the
 * number of hooks between renders, violating the Rules of Hooks and tearing
 * down the entire React tree (white-screen webview).
 *
 * This test mounts the component and flips global collapse on/off; if the hook
 * order regresses, React throws during the re-render and the test fails.
 */
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReasoningBlock } from "../components/ReasoningBlock";
import { useStore } from "../store";

// Tell React this is an act-capable test environment (silences the
// "not configured to support act(...)" warning and flushes effects).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useStore.setState({ globalReasoningCollapsed: false, reasoningCollapsed: {} });
});

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}

describe("ReasoningBlock (Bug B)", () => {
  it("survives toggling global collapse without crashing", () => {
    mount(<ReasoningBlock messageId="m1" text="thinking..." />);
    expect(container.querySelector(".reasoning-block")).not.toBeNull();
    // Expanded initially → reasoning body is rendered.
    expect(container.querySelector(".part-reasoning")).not.toBeNull();

    // Collapse-all previously crashed here (skipped hook).
    act(() => useStore.getState().collapseAllReasoning());
    expect(container.querySelector(".reasoning-block")).not.toBeNull();
    expect(container.querySelector(".part-reasoning")).toBeNull();

    act(() => useStore.getState().expandAllReasoning());
    expect(container.querySelector(".part-reasoning")).not.toBeNull();
  });

  it("toggles a single block independently", () => {
    mount(<ReasoningBlock messageId="m1" text="thinking..." />);
    act(() => useStore.getState().toggleReasoning("m1"));
    expect(container.querySelector(".part-reasoning")).toBeNull();
    act(() => useStore.getState().toggleReasoning("m1"));
    expect(container.querySelector(".part-reasoning")).not.toBeNull();
  });
});
