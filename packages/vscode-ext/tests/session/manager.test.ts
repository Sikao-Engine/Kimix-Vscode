import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("../../src/cli/client", () => ({
  CliClient: vi.fn().mockImplementation(function () {
    return {
      pushEvent: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      request: vi.fn().mockResolvedValue({ output: "result" }),
    };
  }),
}));

describe("SessionManager", () => {
  let manager: SessionManager;
  let tmpDir: string;
  let workDir: string;

  beforeEach(() => {
    manager = new SessionManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-session-test-"));
    workDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createSession", () => {
    it("creates a session with correct properties", () => {
      const session = manager.createSession({
        workDir: "/wd",
        model: "model1",
        thinking: true,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "test", version: "1.0" },
      });
      expect(session.sessionId).toBeDefined();
      expect(session.model).toBe("model1");
      expect(session.thinking).toBe(true);
      expect(session.yoloMode).toBe(false);
      expect(session.executable).toBe("kimi");
    });

    it("uses provided sessionId", () => {
      const session = manager.createSession({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        sessionId: "custom-id",
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      expect(session.sessionId).toBe("custom-id");
    });

    it("prompt returns a Turn with asyncIterator and result", async () => {
      const session = manager.createSession({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      const turn = session.prompt("hello");
      expect(turn.interrupted).toBe(false);
      expect(turn.result).toBeInstanceOf(Promise);

      const events: any[] = [];
      for await (const event of turn) {
        events.push(event);
      }

      const result = await turn.result;
      expect(result.status).toBe("finished");
    });

    it("turn can be interrupted", () => {
      const session = manager.createSession({
        workDir: "/wd",
        model: "m",
        thinking: false,
        yoloMode: false,
        executable: "kimi",
        env: {},
        clientInfo: { name: "t", version: "1" },
      });
      const turn = session.prompt("hello");
      turn.interrupt();
      expect(turn.interrupted).toBe(true);
    });
  });

  describe("forkSession", () => {
    it("throws when source session not found", async () => {
      await expect(
        manager.forkSession({ workDir, sourceSessionId: "missing", turnIndex: 0 })
      ).rejects.toThrow("Source session not found");
    });

    it("forks a session at given turn", async () => {
      const sourceId = "source-123";
      const sourceDir = path.join(workDir, ".kimi", "sessions", sourceId);
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, "wire.jsonl"),
        JSON.stringify({ message: { type: "TurnBegin" } }) +
          "\n" +
          JSON.stringify({ message: { type: "TextChunk" } }) +
          "\n" +
          JSON.stringify({ message: { type: "TurnEnd" } }) +
          "\n"
      );
      fs.writeFileSync(
        path.join(sourceDir, "context.jsonl"),
        JSON.stringify({ role: "user", content: "hi" }) + "\n"
      );

      const result = await manager.forkSession({ workDir, sourceSessionId: sourceId, turnIndex: 0 });
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBeDefined();
      expect(fs.existsSync(result!.sessionDir)).toBe(true);
    });

    it("throws when turn not found", async () => {
      const sourceId = "source-123";
      const sourceDir = path.join(workDir, ".kimi", "sessions", sourceId);
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, "wire.jsonl"), "\n");

      await expect(
        manager.forkSession({ workDir, sourceSessionId: sourceId, turnIndex: 5 })
      ).rejects.toThrow("Turn 5 not found");
    });
  });

  describe("loadSessionHistory", () => {
    it("returns empty array when session missing", async () => {
      const result = await manager.loadSessionHistory(workDir, "missing");
      expect(result).toEqual([]);
    });

    it("extracts assistant text chunks", async () => {
      const sessionId = "sess-1";
      const sessionDir = path.join(workDir, ".kimi", "sessions", sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, "wire.jsonl"),
        JSON.stringify({ message: { type: "TextChunk", payload: { text: "hello" } } }) + "\n"
      );
      const result = await manager.loadSessionHistory(workDir, sessionId);
      expect(result).toEqual([{ role: "assistant", content: "hello" }]);
    });
  });

  describe("deleteSession", () => {
    it("returns true and deletes directory", async () => {
      const sessionId = "sess-del";
      const sessionDir = path.join(workDir, ".kimi", "sessions", sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "file.txt"), "data");
      const result = await manager.deleteSession(workDir, sessionId);
      expect(result).toBe(true);
      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it("returns true when directory doesn't exist (force:true ignores ENOENT)", async () => {
      const result = await manager.deleteSession(workDir, "missing");
      expect(result).toBe(true);
    });
  });

  describe("getSessions", () => {
    it("returns empty array when sessions dir missing", async () => {
      const result = await manager.getSessions(workDir);
      expect(result).toEqual([]);
    });

    it("returns session info for each directory", async () => {
      const sessionsDir = path.join(workDir, ".kimi", "sessions");
      fs.mkdirSync(path.join(sessionsDir, "sess-a"), { recursive: true });
      fs.mkdirSync(path.join(sessionsDir, "sess-b"), { recursive: true });
      const result = await manager.getSessions(workDir);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.sessionId)).toContain("sess-a");
      expect(result.map((s) => s.sessionId)).toContain("sess-b");
    });
  });

  describe("getAllSessions", () => {
    it("delegates to getSessions", async () => {
      const sessionsDir = path.join(workDir, ".kimi", "sessions");
      fs.mkdirSync(path.join(sessionsDir, "sess-1"), { recursive: true });
      const result = await manager.getAllSessions(workDir);
      expect(result).toHaveLength(1);
    });
  });

  describe("getRegisteredWorkDirs", () => {
    it("returns empty array when file missing", async () => {
      const result = await manager.getRegisteredWorkDirs(workDir);
      expect(result).toEqual([]);
    });

    it("returns parsed JSON", async () => {
      const dirs = ["/project/a", "/project/b"];
      fs.mkdirSync(path.join(workDir, ".kimi"), { recursive: true });
      fs.writeFileSync(path.join(workDir, ".kimi", "workdirs.json"), JSON.stringify(dirs));
      const result = await manager.getRegisteredWorkDirs(workDir);
      expect(result).toEqual(dirs);
    });
  });
});
