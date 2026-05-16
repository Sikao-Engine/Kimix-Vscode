import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileManager } from "../../src/file/manager";
import { workspace } from "../__mocks__/vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("FileManager expanded", () => {
  let manager: FileManager;
  let broadcastMock: ReturnType<typeof vi.fn>;
  let tmpDir: string;

  beforeEach(() => {
    broadcastMock = vi.fn();
    manager = new FileManager(() => tmpDir, broadcastMock);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-fm-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("searchFiles delegates to workspace.findFiles", async () => {
    vi.mocked(workspace.findFiles).mockResolvedValue([
      { fsPath: path.join(tmpDir, "src", "main.ts") } as any,
    ]);
    const result = await manager.searchFiles("main");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("main.ts");
    expect(result[0].isDirectory).toBe(false);
  });

  it("searchFiles returns mapped results", async () => {
    vi.mocked(workspace.findFiles).mockResolvedValue([
      { fsPath: path.join(tmpDir, "a.ts") } as any,
      { fsPath: path.join(tmpDir, "b.ts") } as any,
    ]);
    const result = await manager.searchFiles(".ts");
    expect(result).toHaveLength(2);
    expect(result[0].path).toBeDefined();
    expect(result[0].name).toBe("a.ts");
  });

  it("listDirectory returns entries", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# readme");
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "");
    fs.mkdirSync(path.join(tmpDir, "node_modules"));

    const result = await manager.listDirectory(tmpDir);
    expect(result.some((e) => e.name === "src" && e.isDirectory)).toBe(true);
    expect(result.some((e) => e.name === "README.md" && !e.isDirectory)).toBe(true);
    expect(result.some((e) => e.name === "node_modules")).toBe(false);
    expect(result.some((e) => e.name.startsWith("."))).toBe(false);
  });

  it("listDirectory with subdirectory prefix", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "");
    const result = await manager.listDirectory(tmpDir, "src");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("main.ts");
  });

  it("listDirectory returns empty on error", async () => {
    const result = await manager.listDirectory(path.join(tmpDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("dispose cleans up disposables and state", () => {
    manager.setSessionId("view1", "sess-1");
    manager.dispose();
    expect(manager.getSessionId("view1")).toBeNull();
  });
});
