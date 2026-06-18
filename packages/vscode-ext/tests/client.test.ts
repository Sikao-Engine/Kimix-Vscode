import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpencodeClient } from "../src/protocol/client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  const resp = {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
  return {
    ...resp,
    clone: () => ({ ...resp }) as unknown as Response,
  } as unknown as Response;
}

describe("OpencodeClient", () => {
  let client: OpencodeClient;

  beforeEach(() => {
    client = new OpencodeClient({ port: 4096 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ healthy: true })),
    );
    expect(await client.health()).toBe(true);
  });

  it("maps session list payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { id: "s1", title: "A", time: { created: 1, updated: 2 } },
        ]),
      ),
    );
    const sessions = await client.listSessions();
    expect(sessions[0]).toMatchObject({ id: "s1", title: "A" });
  });

  it("sends prompt with agent and model", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(null, true, 204));
    vi.stubGlobal("fetch", fetchMock);
    await client.sendPromptAsync("s1", {
      text: "hi",
      agent: "build",
      model: { providerID: "p", modelID: "m" },
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.parts[0]).toMatchObject({ type: "text", text: "hi" });
    expect(body.agent).toBe("build");
    expect(body.model).toMatchObject({ providerID: "p", modelID: "m" });
  });

  it("falls back to legacy permission endpoint on 404", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/permission/")) {
        return jsonResponse(null, false, 404);
      }
      return jsonResponse(true, true, 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    const ok = await client.respondPermission("s1", "perm1", "always");
    expect(ok).toBe(true);
    expect(calls.some((u) => u.includes("/permissions/perm1"))).toBe(true);
  });

  it("flattens providers into models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              models: { "gpt-4": { id: "gpt-4", name: "GPT-4" } },
            },
          ],
        }),
      ),
    );
    const providers = await client.listProviders();
    expect(providers[0].id).toBe("openai");
    expect(providers[0].models[0]).toMatchObject({ id: "gpt-4" });
  });

  it("maps message metadata including model and provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            info: {
              id: "m1",
              role: "assistant",
              modelID: "gpt-4",
              providerID: "openai",
              agent: "build",
              time: { created: "2024-01-01T00:00:00Z" },
            },
            parts: [{ type: "text", text: "hello" }],
          },
        ]),
      ),
    );
    const messages = await client.getMessages("s1");
    expect(messages[0].info).toMatchObject({
      id: "m1",
      role: "assistant",
      modelID: "gpt-4",
      providerID: "openai",
      agent: "build",
      createdAt: "2024-01-01T00:00:00Z",
    });
  });

  it("parses the feature capability map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          features: {
            compact: {
              enabled: true,
              title: "Compact context",
              description: "Summarize the session",
            },
            experimental: { enabled: false },
          },
        }),
      ),
    );
    const features = await client.listFeatures();
    expect(features.compact).toMatchObject({
      enabled: true,
      title: "Compact context",
      description: "Summarize the session",
    });
    expect(features.experimental.enabled).toBe(false);
  });

  it("returns an empty feature map when discovery is unavailable", async () => {
    // Server without the /experimental/features endpoint → 404.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, false, 404)));
    expect(await client.listFeatures()).toEqual({});
  });

  it("posts to /summarize with the selected model", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(true, true, 200));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await client.summarize("s1", "openai", "gpt-4");
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/session/s1/summarize");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ providerID: "openai", modelID: "gpt-4" });
  });
});
