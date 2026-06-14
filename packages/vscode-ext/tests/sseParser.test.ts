import { describe, it, expect } from "vitest";
import { SSELineParser, parseEvent } from "../src/protocol/sseParser";

describe("SSELineParser", () => {
  it("parses a single complete event", () => {
    const p = new SSELineParser();
    const out = p.push("event: message\ndata: hello\n\n");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event: "message", data: "hello" });
  });

  it("handles chunk splits mid-line", () => {
    const p = new SSELineParser();
    expect(p.push("data: par")).toHaveLength(0);
    const out = p.push("tial\n\n");
    expect(out).toHaveLength(1);
    expect(out[0].data).toBe("partial");
  });

  it("joins multiple data lines with newline", () => {
    const p = new SSELineParser();
    const out = p.push("data: a\ndata: b\n\n");
    expect(out[0].data).toBe("a\nb");
  });

  it("ignores comment / heartbeat lines", () => {
    const p = new SSELineParser();
    const out = p.push(": keep-alive\n\n");
    expect(out).toHaveLength(0);
  });

  it("strips a single leading space after the colon", () => {
    const p = new SSELineParser();
    const out = p.push("data:nospace\n\n");
    expect(out[0].data).toBe("nospace");
  });
});

describe("parseEvent", () => {
  const sid = "ses_123";

  const wrap = (obj: unknown) => ({ event: "message", data: JSON.stringify(obj) });

  it("decodes a text part with delta", () => {
    const ev = parseEvent(
      wrap({
        type: "message.part.updated",
        properties: {
          sessionID: sid,
          delta: "lo",
          part: { type: "text", text: "hello" },
        },
      }),
      sid,
    );
    expect(ev.type).toBe("text");
    expect(ev.delta).toBe("lo");
    expect(ev.text).toBe("hello");
  });

  it("decodes a tool part", () => {
    const ev = parseEvent(
      wrap({
        type: "message.part.updated",
        properties: {
          sessionID: sid,
          part: {
            type: "tool",
            tool: "read_file",
            callID: "c1",
            state: { status: "running", title: "Read", input: { path: "x" } },
          },
        },
      }),
      sid,
    );
    expect(ev.type).toBe("tool");
    expect(ev.toolName).toBe("read_file");
    expect(ev.toolStatus).toBe("running");
    expect(ev.toolCallID).toBe("c1");
    expect(ev.toolInput).toContain("path");
  });

  it("maps permission-like tool to permission event", () => {
    const ev = parseEvent(
      wrap({
        type: "message.part.updated",
        properties: {
          sessionID: sid,
          part: {
            type: "tool",
            tool: "permission",
            id: "perm1",
            state: { status: "pending", id: "perm1" },
          },
        },
      }),
      sid,
    );
    expect(ev.type).toBe("permission");
    expect(ev.permissionID).toBe("perm1");
  });

  it("treats session.idle as terminal", () => {
    const ev = parseEvent(
      wrap({ type: "session.idle", properties: { sessionID: sid } }),
      sid,
    );
    expect(ev.type).toBe("session-idle");
    expect(ev.finished).toBe(true);
  });

  it("skips events for other sessions", () => {
    const ev = parseEvent(
      wrap({
        type: "message.part.updated",
        properties: { sessionID: "other", part: { type: "text", text: "x" } },
      }),
      sid,
    );
    expect(ev.type).toBe("skip");
  });

  it("skips heartbeats", () => {
    const ev = parseEvent(wrap({ type: "server.heartbeat" }), sid);
    expect(ev.type).toBe("skip");
  });

  it("marks step-finish with tool-calls reason as not finished", () => {
    const ev = parseEvent(
      wrap({
        type: "message.part.updated",
        properties: {
          sessionID: sid,
          part: { type: "step-finish", reason: "tool-calls" },
        },
      }),
      sid,
    );
    expect(ev.type).toBe("step-finish");
    expect(ev.finished).toBe(false);
  });

  it("returns reconnected for the sentinel", () => {
    const ev = parseEvent({ event: "__reconnected__", data: "2" });
    expect(ev.type).toBe("reconnected");
    expect(ev.text).toBe("reconnected:2");
  });
});
