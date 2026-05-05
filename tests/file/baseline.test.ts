import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { baselineTracker } from "../../src/file/baseline";

describe("baselineTracker", () => {
  let tmpDir: string;
  let workDir: string;
  const sessionId = "sess-123";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-test-"));
    workDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initSession creates baseline directory", () => {
    baselineTracker.initSession(workDir, sessionId);
    const dir = baselineTracker.getBaselineDir(workDir, sessionId);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("saveBaseline writes content to file", () => {
    baselineTracker.saveBaseline(workDir, sessionId, "src/main.ts", "hello");
    const content = baselineTracker.getBaselineContent(workDir, sessionId, "src/main.ts");
    expect(content).toBe("hello");
  });

  it("getBaselineContent returns null for missing files", () => {
    const content = baselineTracker.getBaselineContent(workDir, sessionId, "missing.txt");
    expect(content).toBeNull();
  });

  it("getChanges detects Added files", async () => {
    const filePath = path.join(workDir, "new.txt");
    fs.writeFileSync(filePath, "line1\nline2", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "new.txt", "");
    const changes = await baselineTracker.getChanges(workDir, sessionId, new Set([filePath]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "new.txt", status: "Added", additions: 2, deletions: 0 });
  });

  it("getChanges detects Deleted files", async () => {
    const filePath = path.join(workDir, "old.txt");
    fs.writeFileSync(filePath, "content", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "old.txt", "content");
    fs.unlinkSync(filePath);
    const changes = await baselineTracker.getChanges(workDir, sessionId, new Set([filePath]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "old.txt", status: "Deleted", additions: 0, deletions: 1 });
  });

  it("getChanges detects Modified files", async () => {
    const filePath = path.join(workDir, "mod.txt");
    fs.writeFileSync(filePath, "old line\nanother", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "mod.txt", "old line\nanother");
    fs.writeFileSync(filePath, "old line\nnew line\nanother", "utf-8");
    const changes = await baselineTracker.getChanges(workDir, sessionId, new Set([filePath]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "mod.txt", status: "Modified" });
  });

  it("getChanges ignores unchanged files", async () => {
    const filePath = path.join(workDir, "same.txt");
    fs.writeFileSync(filePath, "same", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "same.txt", "same");
    const changes = await baselineTracker.getChanges(workDir, sessionId, new Set([filePath]));
    expect(changes).toHaveLength(0);
  });

  it("getChanges ignores files outside workDir", async () => {
    const outside = path.join(tmpDir, "outside.txt");
    fs.writeFileSync(outside, "x", "utf-8");
    const changes = await baselineTracker.getChanges(workDir, sessionId, new Set([outside]));
    expect(changes).toHaveLength(0);
  });

  it("revertFile restores baseline content", () => {
    const filePath = path.join(workDir, "revert.txt");
    fs.writeFileSync(filePath, "changed", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "revert.txt", "original");
    baselineTracker.revertFile(workDir, sessionId, "revert.txt");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("original");
  });

  it("revertFile deletes file if baseline was empty", () => {
    const filePath = path.join(workDir, "newfile.txt");
    fs.writeFileSync(filePath, "content", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "newfile.txt", "");
    baselineTracker.revertFile(workDir, sessionId, "newfile.txt");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("revertAll reverts multiple files", () => {
    const a = path.join(workDir, "a.txt");
    const b = path.join(workDir, "b.txt");
    fs.writeFileSync(a, "a-changed", "utf-8");
    fs.writeFileSync(b, "b-changed", "utf-8");
    baselineTracker.saveBaseline(workDir, sessionId, "a.txt", "a-original");
    baselineTracker.saveBaseline(workDir, sessionId, "b.txt", "b-original");
    baselineTracker.revertAll(workDir, sessionId, new Set([a, b]));
    expect(fs.readFileSync(a, "utf-8")).toBe("a-original");
    expect(fs.readFileSync(b, "utf-8")).toBe("b-original");
  });

  it("clearBaseline removes baseline file", () => {
    baselineTracker.saveBaseline(workDir, sessionId, "clear.txt", "data");
    const baselinePath = baselineTracker.getBaselinePath(workDir, sessionId, "clear.txt");
    expect(fs.existsSync(baselinePath)).toBe(true);
    baselineTracker.clearBaseline(workDir, sessionId, "clear.txt");
    expect(fs.existsSync(baselinePath)).toBe(false);
  });

  it("clearBaselines removes multiple baseline files", () => {
    const a = path.join(workDir, "a.txt");
    const b = path.join(workDir, "b.txt");
    baselineTracker.saveBaseline(workDir, sessionId, "a.txt", "a");
    baselineTracker.saveBaseline(workDir, sessionId, "b.txt", "b");
    baselineTracker.clearBaselines(workDir, sessionId, new Set([a, b]));
    expect(fs.existsSync(baselineTracker.getBaselinePath(workDir, sessionId, "a.txt"))).toBe(false);
    expect(fs.existsSync(baselineTracker.getBaselinePath(workDir, sessionId, "b.txt"))).toBe(false);
  });

  it("countLines counts correctly", () => {
    expect(baselineTracker.countLines("")).toBe(1);
    expect(baselineTracker.countLines("a\nb")).toBe(2);
    expect(baselineTracker.countLines("a\r\nb")).toBe(2);
  });

  it("computeDiff calculates additions and deletions", () => {
    const result = baselineTracker.computeDiff("a\nb\nc", "a\nc\nd");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });
});
