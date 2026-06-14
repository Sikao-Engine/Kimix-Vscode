import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../src/session/sessionManager";
import type { OpencodeClient } from "../src/protocol/client";
import type { ParsedEvent } from "../src/protocol/sseParser";

function stubClient(events: ParsedEvent[]): OpencodeClient {
  return {
    listSessions: vi.fn(async () => [{ id: "s1", title: "A" }]),
    createSession: vi.fn(async () => ({ id: "s2", title: "new" })),
    deleteSession: vi.fn(async () => true),
    getMessages: vi.fn(async () => []),
    sendPromptAsync: vi.fn(async () => true),
    abortSession: vi.fn(async () => true),
    summarize: vi.fn(async () => true),
    respondPermission: vi.fn(async () => true),
    // eslint-disable-next-line require-yield
    streamEvents: async function* () {
      for (const e of events) {
        yield e;
      }
    },
  } as unknown as OpencodeClient;
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

describe("SessionManager", () => {
  it("refreshes session list", async () => {
    const sm = new SessionManager(stubClient([]));
    const sessions = await sm.refreshSessions();
    expect(sessions[0].id).toBe("s1");
    sm.dispose();
  });

  it("emits text events from the stream", async () => {
    const sm = new SessionManager(
      stubClient([parsed({ type: "text", delta: "hi", text: "hi" })]),
    );
    const seen: string[] = [];
    sm.on("text", (e) => seen.push(e.full));
    await sm.selectSession("s1");
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toContain("hi");
    sm.dispose();
  });

  it("emits idle on session-idle", async () => {
    const sm = new SessionManager(
      stubClient([parsed({ type: "session-idle", finished: true })]),
    );
    const idle = vi.fn();
    sm.on("idle", idle);
    await sm.selectSession("s1");
    await new Promise((r) => setTimeout(r, 20));
    expect(idle).toHaveBeenCalled();
    sm.dispose();
  });

  it("creates a session lazily when prompting without one", async () => {
    const client = stubClient([]);
    const sm = new SessionManager(client);
    await sm.sendPrompt("hello", {});
    expect(client.createSession).toHaveBeenCalled();
    expect(client.sendPromptAsync).toHaveBeenCalled();
    sm.dispose();
  });
});
