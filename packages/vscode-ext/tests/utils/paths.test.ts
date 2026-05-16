import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { paths } from "../../src/utils/paths";

describe("paths", () => {
  it("home returns ~/.kimi", () => {
    expect(paths.home).toBe(path.join(os.homedir(), ".kimi"));
  });

  it("sessionDir returns correct path", () => {
    const result = paths.sessionDir("/workspace", "session-123");
    expect(result).toBe(path.join("/workspace", ".kimi", "sessions", "session-123"));
  });

  it("baselineDir returns correct path", () => {
    const result = paths.baselineDir("/workspace", "session-123");
    expect(result).toBe(path.join("/workspace", ".kimi", "baselines", "session-123"));
  });

  it("configPath with workDir returns local config", () => {
    const result = paths.configPath("/workspace");
    expect(result).toBe(path.join("/workspace", ".kimi", "kimi.json"));
  });

  it("configPath without workDir returns global config", () => {
    const result = paths.configPath();
    expect(result).toBe(path.join(paths.home, "kimi.json"));
  });

  it("globalConfigPath returns global config", () => {
    expect(paths.globalConfigPath()).toBe(path.join(paths.home, "kimi.json"));
  });
});
