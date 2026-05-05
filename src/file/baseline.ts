import * as path from "node:path";
import * as fs from "node:fs";
import { FileChange } from "../protocol/types";

export const baselineTracker = {
  initSession(workDir: string, sessionId: string): void {
    const dir = this.getBaselineDir(workDir, sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  },

  saveBaseline(workDir: string, sessionId: string, relativePath: string, content: string): void {
    const filePath = this.getBaselinePath(workDir, sessionId, relativePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
  },

  getBaselineContent(workDir: string, sessionId: string, relativePath: string): string | null {
    const filePath = this.getBaselinePath(workDir, sessionId, relativePath);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  },

  async getChanges(workDir: string, sessionId: string, trackedFiles: Set<string>): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    for (const filePath of trackedFiles) {
      const relativePath = path.relative(workDir, filePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;

      const baseline = this.getBaselineContent(workDir, sessionId, relativePath);
      if (baseline === null) continue;

      const exists = fs.existsSync(filePath);
      const wasEmpty = baseline === "";

      if (!exists && !wasEmpty) {
        changes.push({
          path: relativePath,
          status: "Deleted",
          additions: 0,
          deletions: this.countLines(baseline),
        });
        continue;
      }

      if (!exists && wasEmpty) continue;

      let current: string;
      try {
        current = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      if (wasEmpty) {
        changes.push({
          path: relativePath,
          status: "Added",
          additions: this.countLines(current),
          deletions: 0,
        });
        continue;
      }

      if (current !== baseline) {
        const { additions, deletions } = this.computeDiff(baseline, current);
        changes.push({
          path: relativePath,
          status: "Modified",
          additions,
          deletions,
        });
      }
    }

    return changes;
  },

  revertFile(workDir: string, sessionId: string, relativePath: string): void {
    const targetPath = path.join(workDir, relativePath);
    const baseline = this.getBaselineContent(workDir, sessionId, relativePath);
    if (baseline === null) return;

    if (baseline === "") {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, baseline, "utf-8");
  },

  revertAll(workDir: string, sessionId: string, trackedFiles: Set<string>): void {
    for (const filePath of trackedFiles) {
      const relativePath = path.relative(workDir, filePath);
      this.revertFile(workDir, sessionId, relativePath);
    }
  },

  clearBaselines(workDir: string, sessionId: string, trackedFiles: Set<string>): void {
    for (const filePath of trackedFiles) {
      const relativePath = path.relative(workDir, filePath);
      const baselinePath = this.getBaselinePath(workDir, sessionId, relativePath);
      if (fs.existsSync(baselinePath)) {
        fs.unlinkSync(baselinePath);
      }
    }
  },

  clearBaseline(workDir: string, sessionId: string, relativePath: string): void {
    const baselinePath = this.getBaselinePath(workDir, sessionId, relativePath);
    if (fs.existsSync(baselinePath)) {
      fs.unlinkSync(baselinePath);
    }
  },

  getBaselineDir(workDir: string, sessionId: string): string {
    return path.join(workDir, ".kimi", "baselines", sessionId);
  },

  getBaselinePath(workDir: string, sessionId: string, relativePath: string): string {
    return path.join(this.getBaselineDir(workDir, sessionId), relativePath);
  },

  countLines(text: string): number {
    return text.split(/\r?\n/).length;
  },

  computeDiff(oldText: string, newText: string): { additions: number; deletions: number } {
    const oldLines = oldText.replace(/\r\n/g, "\n").split("\n");
    const newLines = newText.replace(/\r\n/g, "\n").split("\n");
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let additions = 0;
    let deletions = 0;

    for (const line of newLines) {
      if (!oldSet.has(line)) additions++;
    }
    for (const line of oldLines) {
      if (!newSet.has(line)) deletions++;
    }

    return { additions, deletions };
  },
};
