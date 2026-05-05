import * as path from "node:path";
import * as os from "node:os";

export const paths = {
  get home(): string {
    return path.join(os.homedir(), ".kimi");
  },

  sessionDir(workDir: string, sessionId: string): string {
    return path.join(workDir, ".kimi", "sessions", sessionId);
  },

  baselineDir(workDir: string, sessionId: string): string {
    return path.join(workDir, ".kimi", "baselines", sessionId);
  },

  configPath(workDir?: string): string {
    if (workDir) {
      return path.join(workDir, ".kimi", "kimi.json");
    }
    return path.join(this.home, "kimi.json");
  },

  globalConfigPath(): string {
    return path.join(this.home, "kimi.json");
  },
};
