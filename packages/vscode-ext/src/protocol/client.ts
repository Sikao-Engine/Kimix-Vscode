import {
  Agent,
  FeatureInfo,
  MessageWithParts,
  PermissionReply,
  PromptBody,
  Provider,
  Session,
} from "./types";
import { ParsedEvent, parseEvent, RawSSEEvent, SSELineParser } from "./sseParser";

export interface OpencodeClientOptions {
  host?: string;
  port: number;
  /** Default request timeout in ms (non-stream requests). */
  timeoutMs?: number;
  log?: (msg: string, data?: unknown) => void;
  /** Raw communication logger (HTTP, SSE raw lines). Default: no-op. */
  rawLog?: (msg: string, data?: unknown) => void;
}

export interface StreamOptions {
  signal?: AbortSignal;
  maxReconnects?: number;
  reconnectDelayMs?: number;
  onReconnect?: (attempt: number) => void;
}

/**
 * HTTP + SSE client for an opencode-compatible server. Pure Node (native
 * `fetch`), no VS Code dependency, so it is unit-testable in isolation.
 */
export class OpencodeClient {
  private readonly host: string;
  private readonly port: number;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly log: (msg: string, data?: unknown) => void;
  private readonly rawLog: (msg: string, data?: unknown) => void;

  constructor(opts: OpencodeClientOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.log = opts.log ?? (() => {});
    this.rawLog = opts.rawLog ?? (() => {});
  }

  get url(): string {
    return this.baseUrl;
  }

  // ── Health ──────────────────────────────────────────────────────

  async health(): Promise<boolean> {
    try {
      const resp = await this.fetchJson("GET", "/global/health");
      return Boolean((resp as any)?.healthy);
    } catch {
      return false;
    }
  }

  // ── Sessions ────────────────────────────────────────────────────

  async listSessions(): Promise<Session[]> {
    const data = await this.fetchJson<any[]>("GET", "/session");
    return (data ?? []).map(toSession);
  }

  async createSession(title?: string): Promise<Session> {
    const body = title ? { title } : {};
    const data = await this.fetchJson<any>("POST", "/session", body);
    return toSession(data);
  }

  async getSession(id: string): Promise<Session> {
    const data = await this.fetchJson<any>("GET", `/session/${id}`);
    return toSession(data);
  }

  async deleteSession(id: string): Promise<boolean> {
    const resp = await this.rawFetch("DELETE", `/session/${id}`);
    return resp.ok;
  }

  async getMessages(id: string, limit = 0): Promise<MessageWithParts[]> {
    const q = limit > 0 ? `?limit=${limit}` : "";
    const data = await this.fetchJson<any[]>(
      "GET",
      `/session/${id}/message${q}`,
    );
    return (data ?? []).map(toMessage);
  }

  async abortSession(id: string): Promise<boolean> {
    const resp = await this.rawFetch("POST", `/session/${id}/abort`);
    return resp.ok;
  }

  /** Trigger AI compaction / summarization of the session context. */
  async summarize(
    id: string,
    providerID: string,
    modelID: string,
  ): Promise<boolean> {
    const resp = await this.rawFetch("POST", `/session/${id}/summarize`, {
      providerID,
      modelID,
    });
    return resp.ok;
  }

  // ── Messaging ───────────────────────────────────────────────────

  /** Fire-and-forget prompt; server streams the response over `/event`. */
  async sendPromptAsync(id: string, body: PromptBody): Promise<boolean> {
    const payload: Record<string, unknown> = {
      parts: [{ type: "text", text: body.text }],
    };
    if (body.agent) {
      payload.agent = body.agent;
    }
    if (body.model) {
      payload.model = body.model;
    }
    const resp = await this.rawFetch(
      "POST",
      `/session/${id}/prompt_async`,
      payload,
    );
    return resp.ok;
  }

  // ── Agents / Providers / Config ─────────────────────────────────

  async listAgents(): Promise<Agent[]> {
    const data = await this.fetchJson<any[]>("GET", "/agent");
    return (data ?? []).map(toAgent);
  }

  async listProviders(): Promise<Provider[]> {
    // opencode exposes providers (with their default models) via config.
    const data = await this.fetchJson<any>("GET", "/config/providers");
    const providers = data?.providers ?? data ?? [];
    return (Array.isArray(providers) ? providers : []).map(toProvider);
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return (await this.fetchJson<any>("GET", "/config")) ?? {};
  }

  /**
   * Discover server capabilities (opencode-sse extensions). Any feature not
   * present in the response — including when the endpoint is missing or the
   * request fails — is treated as unavailable by the caller.
   */
  async listFeatures(): Promise<Record<string, FeatureInfo>> {
    try {
      const data = await this.fetchJson<any>("GET", "/experimental/features");
      const features = data?.features ?? {};
      const out: Record<string, FeatureInfo> = {};
      for (const [key, value] of Object.entries(features)) {
        const v = value as any;
        out[key] = {
          enabled: Boolean(v?.enabled),
          title: v?.title,
          description: v?.description,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    reply: PermissionReply,
  ): Promise<boolean> {
    // Prefer the modern endpoint; fall back to the deprecated session route.
    const modern = await this.rawFetch(
      "POST",
      `/permission/${permissionId}/reply`,
      { reply },
    );
    if (modern.ok) {
      return true;
    }
    if (modern.status !== 404 && modern.status !== 405) {
      return false;
    }
    const legacy = await this.rawFetch(
      "POST",
      `/session/${sessionId}/permissions/${permissionId}`,
      { response: reply },
    );
    return legacy.ok;
  }

  // ── SSE Streaming ───────────────────────────────────────────────

  /**
   * Stream parsed events for a session from the global `/event` endpoint,
   * with automatic reconnect. Yields a synthetic `reconnected` event before
   * each retry so callers can resync state.
   */
  async *streamEvents(
    sessionId: string,
    opts: StreamOptions = {},
  ): AsyncIterableIterator<ParsedEvent> {
    const maxReconnects = opts.maxReconnects ?? 5;
    const reconnectDelay = opts.reconnectDelayMs ?? 2000;
    let attempt = 0;

    while (attempt <= maxReconnects) {
      try {
        for await (const raw of this.rawEventStream(opts.signal)) {
          attempt = 0;
          const parsed = parseEvent(raw, sessionId);
          if (parsed.type !== "skip") {
            yield parsed;
          }
        }
        return;
      } catch (err) {
        if (opts.signal?.aborted) {
          return;
        }
        attempt += 1;
        if (attempt > maxReconnects) {
          this.log("[SSE] max reconnects reached", String(err));
          throw err;
        }
        this.log(`[SSE] reconnecting (${attempt}/${maxReconnects})`, String(err));
        opts.onReconnect?.(attempt);
        await delay(reconnectDelay * attempt);
        yield parseEvent({ event: "__reconnected__", data: String(attempt) });
      }
    }
  }

  private async *rawEventStream(
    signal?: AbortSignal,
  ): AsyncIterableIterator<RawSSEEvent> {
    const resp = await fetch(`${this.baseUrl}/event`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`SSE connect failed: HTTP ${resp.status}`);
    }
    this.rawLog("[SSE] ★ connected to /event");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SSELineParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        for (const evt of parser.push(chunk)) {
          this.rawLog("[SSE] raw", `${evt.event} ${truncate(evt.data, 2000)}`);
          yield evt;
        }
      }
      const tail = parser.flush();
      if (tail) {
        this.rawLog("[SSE] raw", `${tail.event} ${truncate(tail.data, 2000)}`);
        yield tail;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      this.rawLog("[SSE] ■ disconnected from /event");
    }
  }

  // ── Low-level helpers ───────────────────────────────────────────

  private async fetchJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const resp = await this.rawFetch(method, path, body);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${method} ${path}`);
    }
    const text = await resp.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private async rawFetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}${path}`;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    this.rawLog("[HTTP] →", `${method} ${url}${bodyStr ? ` body=${truncate(bodyStr, 2000)}` : ""}`);
    try {
      const resp = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: bodyStr,
        signal: controller.signal,
      });
      const cloned = resp.clone();
      // Read body asynchronously for logging — don't block the caller
      cloned.text().then((text) => {
        this.rawLog("[HTTP] ←", `${resp.status} ${method} ${url}${text ? ` body=${truncate(text, 2000)}` : ""}`);
      }).catch(() => {});
      return resp;
    } catch (err) {
      this.rawLog("[HTTP] ✗", `${method} ${url} — ${String(err)}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Mappers ─────────────────────────────────────────────────────────

function toSession(data: any): Session {
  return {
    id: data?.id ?? "",
    title: data?.title,
    parentID: data?.parentID,
    createdAt: data?.time?.created ?? data?.createdAt,
    updatedAt: data?.time?.updated ?? data?.updatedAt,
    raw: data,
  };
}

function toAgent(data: any): Agent {
  return {
    name: data?.name ?? "",
    description: data?.description,
    mode: data?.mode,
    builtIn: data?.builtIn,
    raw: data,
  };
}

function toProvider(data: any): Provider {
  const models = data?.models ?? {};
  const list = Array.isArray(models) ? models : Object.values(models);
  return {
    id: data?.id ?? "",
    name: data?.name,
    models: list.map((m: any) => ({
      id: m?.id ?? "",
      name: m?.name,
      providerID: data?.id,
      raw: m,
    })),
    raw: data,
  };
}

function toMessage(data: any): MessageWithParts {
  const info = data?.info ?? data ?? {};
  const parts = data?.parts ?? [];
  return {
    info: {
      id: info.id ?? "",
      role: info.role ?? "assistant",
      modelID: info.modelID,
      providerID: info.providerID,
      agent: info.agent,
      cost: info.cost,
      tokens: info.tokens,
      createdAt: info.time?.created ?? info.createdAt,
    },
    parts: (parts as any[]).map((p) => ({
      type: p?.type ?? "unknown",
      text: p?.text,
      tool: p?.tool,
      state: p?.state,
      raw: p,
    })),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (${s.length - max} more chars)`;
}
