import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpencodeClient } from "../src/protocol/client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
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
});
