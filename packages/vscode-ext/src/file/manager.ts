import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { baselineTracker } from "./baseline";

const IGNORED_PATTERNS = `{**/.git,**/.svn,**/.hg,**/CVS,**/.DS_Store,**/Thumbs.db,**/node_modules,**/.venv,**/__pycache__,**/.kimi}`;

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

const IMAGE_GLOBS = ["**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp", "**/*.svg", "**/*.bmp", "**/*.ico"];
const VIDEO_GLOBS = ["**/*.mp4", "**/*.webm", "**/*.mov"];

interface ViewState {
  sessionId: string | null;
  trackedFiles: Set<string>;
}

export class FileManager {
  private viewStates = new Map<string, ViewState>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private getWorkDir: () => string | null,
    private broadcast: (event: string, payload: unknown, webviewId?: string) => void,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    watcher.onDidChange((uri) => this.onFileChange(uri));
    watcher.onDidCreate((uri) => this.onFileChange(uri));
    watcher.onDidDelete((uri) => this.onFileChange(uri));
    this.disposables.push(watcher);
  }

  private getViewState(webviewId: string): ViewState {
    let state = this.viewStates.get(webviewId);
    if (!state) {
      state = { sessionId: null, trackedFiles: new Set() };
      this.viewStates.set(webviewId, state);
    }
    return state;
  }

  setSessionId(webviewId: string, sessionId: string | null): void {
    this.getViewState(webviewId).sessionId = sessionId;
  }

  getSessionId(webviewId: string): string | null {
    return this.getViewState(webviewId).sessionId;
  }

  trackFile(webviewId: string, filePath: string): void {
    this.getViewState(webviewId).trackedFiles.add(filePath);
  }

  getTracked(webviewId: string): Set<string> {
    return this.getViewState(webviewId).trackedFiles;
  }

  clearTracked(webviewId: string): void {
    this.getViewState(webviewId).trackedFiles.clear();
  }

  disposeView(webviewId: string): void {
    this.viewStates.delete(webviewId);
  }

  private async onFileChange(uri: vscode.Uri): Promise<void> {
    const workDir = this.getWorkDir();
    if (!workDir) return;
    const fsPath = uri.fsPath;

    for (const [webviewId, state] of this.viewStates) {
      if (!state.sessionId || !state.trackedFiles.has(fsPath)) continue;
      const changes = await baselineTracker.getChanges(workDir, state.sessionId, state.trackedFiles);
      this.broadcast("fileChangesUpdated", changes, webviewId);
    }
  }

  async searchFiles(query?: string): Promise<{ path: string; name: string; isDirectory: boolean }[]> {
    const pattern = query ? `**/*${query}*` : "**/*";
    const files = await vscode.workspace.findFiles(pattern, IGNORED_PATTERNS, 200);
    return files.map((uri) => ({
      path: vscode.workspace.asRelativePath(uri),
      name: path.basename(uri.fsPath),
      isDirectory: false,
    }));
  }

  async listDirectory(
    workDir: string,
    directory?: string,
  ): Promise<{ path: string; name: string; isDirectory: boolean }[]> {
    const target = directory ? path.join(workDir, directory) : workDir;
    try {
      const entries = await fs.promises.readdir(target, { withFileTypes: true });
      return entries
        .filter((entry) => !this.isIgnored(entry.name))
        .map((entry) => ({
          path: directory ? path.join(directory, entry.name) : entry.name,
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
    } catch {
      return [];
    }
  }

  private isIgnored(name: string): boolean {
    const ext = path.extname(name).toLowerCase();
    return name.startsWith(".") || name === "node_modules";
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.viewStates.clear();
  }
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getMediaMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
