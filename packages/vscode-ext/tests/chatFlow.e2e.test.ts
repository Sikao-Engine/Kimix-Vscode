import { describe, it, expect, vi } from "vitest";
import { KimixController } from "../src/controller/kimixController";
import { SessionManager } from "../src/session/sessionManager";
import { SSELineParser, parseEvent } from "../src/protocol/sseParser";
import type { ParsedEvent } from "../src/protocol/sseParser";
import type { HostToWebview, WebviewToHost } from "../src/protocol/messages";
import type { OpencodeClient } from "../src/protocol/client";

// ── Helpers ─────────────────────────────────────────────────────────

const SID = "ses_1";

/** Build one opencode-style SSE frame exactly as the backend emits it. */
function frame(type: string, properties: Record<string, unknown>): string {
  const data = JSON.stringify({ id: `evt_${type}`, type, properties });
  return `event: message\nid: evt_${type}\ndata: ${data}\n\n`;
}

function textPartFrame(full: string, delta: string): string {
  return frame("message.part.updated", {
    sessionID: SID,
    part: { type: "text", text: full },
    delta,
  });
}

function idleFrame(): string {
  return frame("session.idle", { sessionID: SID });
}

/** Decode a raw byte stream the way the client does (line parser + decoder). */
function decodeStream(raw: string): ParsedEvent[] {
  const parser = new SSELineParser();
  const out: ParsedEvent[] = [];
  for (const ev of parser.push(raw)) {
    const parsed = parseEvent(ev, SID);
    if (parsed.type !== "skip") {
      out.push(parsed);
    }
  }
  return out;
}

function streamingClient(events: ParsedEvent[]): OpencodeClient {
  return {
    listSessions: vi.fn(async () => [{ id: SID, title: "A" }]),
    getMessages: vi.fn(async () => []),
    // eslint-disable-next-line require-yield
    streamEvents: async function* () {
      for (const e of events) {
        yield e;
      }
    },
  } as unknown as OpencodeClient;
}

// ── Bug C: session.idle must be the terminal event of a turn ────────

describe("e2e: turn termination ordering (Bug C)", () => {
  it("decodes a well-formed turn with session.idle as the last event", () => {
    // Mirrors the FIXED backend ordering: stream text, then idle LAST.
    const raw =
      textPartFrame("H", "H") +
      textPartFrame("Hi", "i") +
      idleFrame();

    const events = decodeStream(raw);
    const kinds = events.map((e) => e.type);

    expect(kinds[kinds.length - 1]).toBe("session-idle");
    // No content event may appear after idle, or the UI re-opens "busy".
    const idleIdx = kinds.indexOf("session-idle");
    expect(kinds.slice(idleIdx + 1).filter((k) => k === "text")).toHaveLength(0);
  });

  it("detects the broken ordering where text trails idle (regression guard)", () => {
    // The OLD backend flushed the final text part AFTER idle. We assert the
    // decoder surfaces that text-after-idle so this anti-pattern stays caught.
    const raw = idleFrame() + textPartFrame("Hi", "Hi");
    const kinds = decodeStream(raw).map((e) => e.type);
    const idleIdx = kinds.indexOf("session-idle");
    expect(kinds.slice(idleIdx + 1)).toContain("text");
  });

  it("emits exactly one idle and ends on it through SessionManager", async () => {
    const events = decodeStream(
      textPartFrame("Hi", "Hi") + idleFrame(),
    );
    const sm = new SessionManager(streamingClient(events));

    const seq: string[] = [];
    sm.on("text", () => seq.push("text"));
    sm.on("idle", () => seq.push("idle"));

    await sm.selectSession(SID);
    await new Promise((r) => setTimeout(r, 20));

    expect(seq.filter((s) => s === "idle")).toHaveLength(1);
    expect(seq[seq.length - 1]).toBe("idle");
    sm.dispose();
  });
});

// ── Refresh keeps transcript stable during completed streams ──────────

describe("e2e: refresh only updates session state", () => {
  it("does not push transcript when the webview requests refresh", async () => {
    const controller = new KimixController("/workspace", "/tmp/pid.json");
    const out: HostToWebview[] = [];
    const dispose = controller.onMessage((m) => out.push(m));

    const transcript = [
      { info: { id: "msg_u", role: "user" }, parts: [{ type: "text", text: "Hello" }] },
      { info: { id: "msg_a", role: "assistant" }, parts: [{ type: "text", text: "Hi" }] },
    ];
    const sessions = {
      refreshSessions: vi.fn(async () => [{ id: SID }]),
      getMessages: vi.fn(async () => transcript),
      currentSessionId: SID,
      sessions: [{ id: SID }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).sessions = sessions;

    await controller.handleMessage({ type: "refresh" } as WebviewToHost);

    expect(out.some((m) => m.type === "messages")).toBe(false);
    expect(sessions.getMessages).not.toHaveBeenCalled();

    dispose.dispose();
  });
});
