/**
 * Streaming SSE line parser + opencode event decoder.
 *
 * The opencode `/event` endpoint is a *global* stream: it emits events for
 * every session in the instance. {@link parseEvent} therefore takes a
 * `sessionId` and marks events for other sessions as `skip`.
 */

export interface RawSSEEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incrementally parse a stream of decoded text chunks into discrete SSE
 * events. Feed it `push(chunk)` and it yields complete events as they close
 * (blank-line delimited, per the SSE spec).
 */
export class SSELineParser {
  private buffer = "";
  private event = "";
  private dataLines: string[] = [];
  private id: string | undefined;

  push(chunk: string): RawSSEEvent[] {
    this.buffer += chunk;
    const out: RawSSEEvent[] = [];
    let idx: number;
    // Process complete lines; keep the trailing partial line in the buffer.
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      const evt = this.consumeLine(line);
      if (evt) {
        out.push(evt);
      }
    }
    return out;
  }

  /** Flush any buffered event (call when the stream ends). */
  flush(): RawSSEEvent | undefined {
    if (this.buffer.length > 0) {
      const evt = this.consumeLine(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
      if (evt) {
        return evt;
      }
    }
    if (this.dataLines.length > 0 || this.event) {
      return this.closeEvent();
    }
    return undefined;
  }

  private consumeLine(line: string): RawSSEEvent | undefined {
    if (line === "") {
      if (this.dataLines.length > 0 || this.event) {
        return this.closeEvent();
      }
      return undefined;
    }
    if (line.startsWith(":")) {
      return undefined; // comment / heartbeat
    }
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1).replace(/^ /, "");
    }
    if (field === "event") {
      this.event = value;
    } else if (field === "data") {
      this.dataLines.push(value);
    } else if (field === "id") {
      this.id = value;
    }
    return undefined;
  }

  private closeEvent(): RawSSEEvent {
    const evt: RawSSEEvent = {
      event: this.event,
      data: this.dataLines.join("\n"),
      id: this.id,
    };
    this.event = "";
    this.dataLines = [];
    this.id = undefined;
    return evt;
  }
}

export type ParsedEventType =
  | "text"
  | "reasoning"
  | "tool"
  | "permission"
  | "step-start"
  | "step-finish"
  | "session-idle"
  | "reconnected"
  | "skip"
  | "unknown";

export interface ParsedEvent {
  type: ParsedEventType;
  /** Full accumulated text of the part (for `text` / `reasoning`). */
  text: string;
  /** Incremental delta, if the server sent one. */
  delta: string;
  toolName: string;
  toolStatus: string;
  toolCallID: string;
  toolTitle: string;
  toolInput: string;
  permissionID: string;
  finished: boolean;
  raw: Record<string, unknown>;
}

function emptyParsed(type: ParsedEventType): ParsedEvent {
  return {
    type,
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
  };
}

function matchesSession(data: any, sessionId: string): boolean {
  const props = data?.properties ?? {};
  const sid =
    props.sessionID ??
    props.session_id ??
    data?.sessionID ??
    props.info?.sessionID;
  return !sid || sid === sessionId;
}

/**
 * Decode one raw SSE event into a structured {@link ParsedEvent}.
 * Events belonging to other sessions become `skip`.
 */
export function parseEvent(raw: RawSSEEvent, sessionId = ""): ParsedEvent {
  if (raw.event === "__reconnected__") {
    const p = emptyParsed("reconnected");
    p.text = `reconnected:${raw.data}`;
    return p;
  }

  if (!raw.data) {
    return emptyParsed("skip");
  }

  let data: any;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return emptyParsed("skip");
  }

  const eventType: string = data?.type ?? "";

  if (eventType === "server.connected" || eventType === "server.heartbeat") {
    return emptyParsed("skip");
  }

  if (sessionId && !matchesSession(data, sessionId)) {
    return emptyParsed("skip");
  }

  if (eventType === "message.part.updated") {
    return parsePartUpdated(data);
  }
  if (eventType === "message.part.delta") {
    return parsePartDelta(data);
  }
  if (eventType === "session.idle") {
    const p = emptyParsed("session-idle");
    p.finished = true;
    p.raw = data;
    return p;
  }
  if (eventType === "session.status") {
    const status = data?.properties?.status;
    const statusType = typeof status === "object" ? status?.type : "";
    if (statusType === "idle") {
      const p = emptyParsed("session-idle");
      p.finished = true;
      p.raw = data;
      return p;
    }
    return emptyParsed("skip");
  }
  if (
    eventType === "session.permission" ||
    eventType === "permission" ||
    eventType === "permission.asked"
  ) {
    const props = data?.properties ?? {};
    const p = emptyParsed("permission");
    p.permissionID =
      data?.id ?? data?.permissionID ?? props.id ?? props.permissionID ?? "";
    p.raw = data;
    return p;
  }

  const p = emptyParsed("unknown");
  p.raw = data;
  return p;
}

function parsePartUpdated(data: any): ParsedEvent {
  const props = data?.properties ?? {};
  const part = props.part ?? {};
  const delta: string = props.delta ?? "";
  const partType: string = part.type ?? "";

  if (partType === "text") {
    const p = emptyParsed("text");
    p.delta = delta;
    p.text = part.text ?? "";
    p.raw = data;
    return p;
  }
  if (partType === "reasoning") {
    const p = emptyParsed("reasoning");
    p.delta = delta;
    p.text = part.text ?? "";
    p.raw = data;
    return p;
  }
  if (partType === "tool") {
    const state = part.state ?? {};
    const toolName: string = part.tool ?? "unknown";
    const status: string = state.status ?? "";
    const title: string = state.title ?? toolName;
    const callID: string = part.callID ?? part.id ?? "";
    let input = "";
    if (state.input && typeof state.input === "object") {
      input = JSON.stringify(state.input);
    } else if (typeof state.input === "string") {
      input = state.input;
    }

    if (
      (toolName === "permission" ||
        toolName === "question" ||
        toolName === "ask") &&
      (status === "pending" || status === "running")
    ) {
      const p = emptyParsed("permission");
      p.toolName = toolName;
      p.toolStatus = status;
      p.toolTitle = title;
      p.permissionID = state.id ?? part.id ?? "";
      p.raw = data;
      return p;
    }

    const p = emptyParsed("tool");
    p.toolName = toolName;
    p.toolStatus = status;
    p.toolTitle = title;
    p.toolCallID = callID;
    p.toolInput = input;
    p.raw = data;
    return p;
  }
  if (partType === "step-start") {
    const p = emptyParsed("step-start");
    p.raw = data;
    return p;
  }
  if (partType === "step-finish") {
    const reason: string = part.reason ?? "";
    const p = emptyParsed("step-finish");
    p.text = reason;
    p.finished = reason !== "tool-calls" && reason !== "tool_calls";
    p.raw = data;
    return p;
  }

  return emptyParsed("skip");
}

function parsePartDelta(data: any): ParsedEvent {
  const props = data?.properties ?? {};
  const delta: string = props.delta ?? "";
  const field: string = props.field ?? "";
  if (delta && (field === "text" || field === "reasoning")) {
    const p = emptyParsed(field === "reasoning" ? "reasoning" : "text");
    p.delta = delta;
    p.text = delta;
    p.raw = data;
    return p;
  }
  return emptyParsed("skip");
}
