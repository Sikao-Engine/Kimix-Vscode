import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { BridgeContext } from "./context";
import { RpcMethod, WebviewEvent, MCPServer, ModelInfo } from "../protocol/types";
import { baselineTracker } from "../file/baseline";
import { login, logout } from "../cli/operations";
import { getExtensionConfig } from "../config";
import { McpManager } from "../mcp/manager";
import { normalizeError, classifyErrorPhase } from "../utils/errors";

const debug = require("debug")("kimi-sdk:bridge");

const SAFE_FILE_TOOLS = new Set([
  "WriteFile",
  "CreateFile",
  "StrReplaceFile",
  "PatchFile",
  "DeleteFile",
  "AppendFile",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  baselineSaved: boolean;
}

function getEditorContext(): {
  content: string;
  language: string;
  fileName: string;
  selection?: { text: string; startLine: number; endLine: number };
} | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const doc = editor.document;
  const sel = editor.selection;
  return {
    content: doc.getText(),
    language: doc.languageId,
    fileName: doc.fileName,
    selection: sel.isEmpty
      ? undefined
      : {
          text: doc.getText(sel),
          startLine: sel.start.line + 1,
          endLine: sel.end.line + 1,
        },
  };
}

function resolvePath(workDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
}

function isWithinWorkDir(workDir: string, target: string): boolean {
  const rel = path.relative(workDir, target);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function getMediaMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
    webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

const editorContextCache = new Map<string, string>();

function buildSystemContext(webviewId: string): string {
  const cfg = getExtensionConfig().editorContext;
  if (cfg === "never") return "";

  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";

  const doc = editor.document;
  const relPath = vscode.workspace.asRelativePath(doc.uri);
  const cached = editorContextCache.get(webviewId);

  if (cfg === "onConversationStart") {
    if (cached !== undefined) return "";
  } else if (cached === relPath) {
    return "";
  }

  editorContextCache.set(webviewId, relPath);
  const sel = editor.selection;
  const selectionText = sel.isEmpty
    ? ""
    : ` (L${sel.start.line + 1}-${sel.end.line + 1} selected)`;
  const dirty = doc.isDirty ? ", unsaved" : "";

  return `<system>Editor context (use only if relevant to user's query): ${relPath}:${sel.active.line + 1}${selectionText}${dirty}.</system>\n`;
}

async function streamChat(params: {
  content: string | { type: string; text: string }[];
  model: string;
  thinking?: boolean;
  sessionId?: string;
}, ctx: BridgeContext): Promise<{ done: boolean }> {
  if (!ctx.workDir) {
    ctx.broadcast(WebviewEvent.StreamEvent, {
      type: "error",
      code: "NO_WORKSPACE",
      message: "Please open a folder to start.",
      phase: "preflight",
    }, ctx.webviewId);

    vscode.window
      .showWarningMessage("Kimi: Please open a folder first.", "Open Folder")
      .then((choice) => {
        if (choice) vscode.commands.executeCommand("vscode.openFolder");
      });

    return { done: false };
  }

  if (getExtensionConfig().autosave) {
    await ctx.saveAllDirty();
  }

  const session = ctx.getOrCreateSession(params.model, !!params.thinking, params.sessionId);
  const workDir = ctx.workDir;
  const sessionId = session.sessionId;

  baselineTracker.initSession(workDir, sessionId);
  ctx.broadcast(WebviewEvent.StreamEvent, {
    type: "session_start",
    sessionId,
    model: session.model,
    _sessionId: sessionId,
  }, ctx.webviewId);

  const systemCtx = buildSystemContext(ctx.webviewId);
  const content = typeof params.content === "string"
    ? params.content + (systemCtx ? "\n" + systemCtx : "")
    : enrichContent(params.content, systemCtx);

  const pendingToolCalls = new Map<string, ToolCallState>();
  let lastToolCallId: string | null = null;

  try {
    const turn = session.prompt(content);
    ctx.setTurn(turn);

    for await (const event of turn) {
      const payload = (event as any).payload;
      const eventType = (event as any).type;

      if (eventType === "ToolCall" && payload?.id) {
        const tc: ToolCallState = {
          id: payload.id,
          name: payload.function?.name || "",
          arguments: payload.function?.arguments || "",
          baselineSaved: false,
        };
        pendingToolCalls.set(payload.id, tc);
        lastToolCallId = payload.id;
        saveToolBaseline(tc, workDir, sessionId);
      }

      if (eventType === "ToolCallPart" && payload?.arguments_part && lastToolCallId) {
        const tc = pendingToolCalls.get(lastToolCallId);
        if (tc) {
          tc.arguments += payload.arguments_part;
          saveToolBaseline(tc, workDir, sessionId);
        }
      }

      if (eventType === "StatusUpdate") {
        for (const tc of pendingToolCalls.values()) {
          saveToolBaseline(tc, workDir, sessionId);
        }
      }

      if (eventType === "ToolResult" && payload?.tool_call_id) {
        pendingToolCalls.delete(payload.tool_call_id);
        if (lastToolCallId === payload.tool_call_id) {
          lastToolCallId = null;
        }
      }

      ctx.broadcast(WebviewEvent.StreamEvent, { ...event, _sessionId: sessionId }, ctx.webviewId);
    }

    const result = await turn.result;
    ctx.broadcast(WebviewEvent.StreamEvent, {
      type: "stream_complete",
      result,
      _sessionId: sessionId,
    }, ctx.webviewId);
    ctx.setTurn(null);
    return { done: true };
  } catch (err) {
    ctx.setTurn(null);
    const errorCode = normalizeError(err);
    const phase = classifyErrorPhase(errorCode);
    const message = err instanceof Error ? err.message : String(err);
    ctx.broadcast(WebviewEvent.StreamEvent, {
      type: "error",
      code: errorCode,
      message,
      phase,
      _sessionId: sessionId,
    }, ctx.webviewId);
    return { done: false };
  }
}

function saveToolBaseline(tc: ToolCallState, workDir: string, sessionId: string): void {
  if (tc.baselineSaved || !SAFE_FILE_TOOLS.has(tc.name) || !tc.arguments) return;
  try {
    const args = JSON.parse(tc.arguments);
    if (args.path) {
      const target = resolvePath(workDir, args.path);
      if (isWithinWorkDir(workDir, target)) {
        const rel = path.relative(workDir, target);
        let content = "";
        if (fs.existsSync(target)) {
          try {
            content = fs.readFileSync(target, "utf-8");
          } catch {
            // ignore
          }
        }
        baselineTracker.saveBaseline(workDir, sessionId, rel, content);
        tc.baselineSaved = true;
      }
    }
  } catch {
    // ignore parse errors
  }
}

function enrichContent(
  content: { type: string; text: string }[],
  systemCtx: string,
): { type: string; text: string }[] {
  if (!systemCtx) return content;
  const idx = content.findIndex((c) => c.type === "text");
  if (idx >= 0) {
    const copy = [...content];
    copy[idx] = { type: "text", text: systemCtx + copy[idx].text };
    return copy;
  }
  return [{ type: "text", text: systemCtx }, ...content];
}

export const handlers: Record<
  RpcMethod,
  (params: any, ctx: BridgeContext) => Promise<unknown>
> = {
  // Workspace
  [RpcMethod.CheckWorkspace]: async (_params, ctx) => ({
    ok: !!ctx.workspaceRoot,
    workDir: ctx.workspaceRoot,
  }),

  [RpcMethod.OpenFolder]: async () => {
    await vscode.commands.executeCommand("vscode.openFolder");
    return { ok: true };
  },

  [RpcMethod.RunCLI]: async (params: { args: string[] }, ctx) => {
    // Would execute CLI with args
    debug("RunCLI: %o", params);
    return { ok: true, output: "" };
  },

  [RpcMethod.GetInputHistory]: async (_params, ctx) => {
    const history = ctx.workspaceState.get<string[]>("kimi.inputHistory", []);
    return history;
  },

  [RpcMethod.AddInputHistory]: async (params: { input: string }, ctx) => {
    const history = ctx.workspaceState.get<string[]>("kimi.inputHistory", []);
    const filtered = history.filter((h) => h !== params.input);
    filtered.unshift(params.input);
    await ctx.workspaceState.update("kimi.inputHistory", filtered.slice(0, 100));
    return { ok: true };
  },

  // Config
  [RpcMethod.SaveConfig]: async (params: { model: string; thinking?: boolean }) => {
    // Would update config file
    debug("SaveConfig: %o", params);
    return { ok: true };
  },

  [RpcMethod.GetExtensionConfig]: async () => getExtensionConfig(),

  [RpcMethod.OpenSettings]: async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "kimi");
    return { ok: true };
  },

  [RpcMethod.GetModels]: async () => {
    // Would call CLI for models
    return [] as ModelInfo[];
  },

  [RpcMethod.ShowLogs]: async (_params, ctx) => {
    ctx.showLogs();
    return { ok: true };
  },

  [RpcMethod.ReloadWebview]: async (_params, ctx) => {
    ctx.reloadWebview();
    return { ok: true };
  },

  // MCP
  [RpcMethod.GetMCPServers]: async (_params, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    return mcp.getServers();
  },

  [RpcMethod.AddMCPServer]: async (params: MCPServer, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    const servers = mcp.addServer(params);
    ctx.broadcast(WebviewEvent.MCPServersChanged, servers, ctx.webviewId);
    return servers;
  },

  [RpcMethod.UpdateMCPServer]: async (params: MCPServer, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    const servers = mcp.updateServer(params);
    ctx.broadcast(WebviewEvent.MCPServersChanged, servers, ctx.webviewId);
    return servers;
  },

  [RpcMethod.RemoveMCPServer]: async (params: { name: string }, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    const servers = mcp.removeServer(params.name);
    ctx.broadcast(WebviewEvent.MCPServersChanged, servers, ctx.webviewId);
    return servers;
  },

  [RpcMethod.AuthMCP]: async (params: { name: string }, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    await mcp.auth(params.name);
    return { ok: true };
  },

  [RpcMethod.ResetAuthMCP]: async (params: { name: string }, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    await mcp.resetAuth(params.name);
    return { ok: true };
  },

  [RpcMethod.TestMCP]: async (params: { name: string }, ctx) => {
    const mcp = new McpManager(ctx.workspaceState);
    return mcp.test(params.name);
  },

  // Chat
  [RpcMethod.StreamChat]: streamChat,

  [RpcMethod.AbortChat]: async (_params, ctx) => {
    const turn = ctx.getTurn();
    if (turn) {
      turn.interrupted = true;
      turn.interrupt();
    }
    return { ok: true };
  },

  [RpcMethod.ResetSession]: async (_params, ctx) => {
    await ctx.closeSession();
    return { ok: true };
  },

  [RpcMethod.SetPlanMode]: async (params: { enabled: boolean }) => {
    return { ok: true };
  },

  [RpcMethod.SteerChat]: async (params: { direction: string }) => {
    return { ok: true };
  },

  [RpcMethod.RespondApproval]: async (params: { approved: boolean }) => {
    return { ok: true };
  },

  [RpcMethod.RespondQuestion]: async (params: { answer: string }) => {
    return { ok: true };
  },

  // Sessions
  [RpcMethod.GetKimiSessions]: async (_params, ctx) => {
    if (!ctx.workDir) return [];
    // Would call SessionManager
    return [];
  },

  [RpcMethod.GetAllKimiSessions]: async (_params, ctx) => {
    if (!ctx.workspaceRoot) return [];
    return [];
  },

  [RpcMethod.GetRegisteredWorkDirs]: async (_params, ctx) => {
    if (!ctx.workspaceRoot) return [];
    return [];
  },

  [RpcMethod.SetWorkDir]: async (params: { workDir: string | null }, ctx) => {
    if (!ctx.workspaceRoot) return { ok: false };
    const target = params.workDir;
    if (target && target !== ctx.workspaceRoot && !target.startsWith(ctx.workspaceRoot + path.sep)) {
      return { ok: false };
    }
    ctx.setCustomWorkDir(target);
    return { ok: true, workDir: target || ctx.workspaceRoot };
  },

  [RpcMethod.BrowseWorkDir]: async (_params, ctx) => {
    if (!ctx.workspaceRoot) return { ok: false, workDir: null };
    const rootUri = vscode.Uri.file(ctx.workspaceRoot);
    const dirs = (await vscode.workspace.fs.readDirectory(rootUri))
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name)
      .filter((name) => !name.startsWith("."))
      .sort();

    const items = [
      { label: "$(folder) Browse...", description: "Open folder picker", alwaysShow: true },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...dirs.map((d) => ({ label: `$(folder) ${d}`, description: path.join(ctx.workspaceRoot!, d) })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a subdirectory or browse...",
      title: "Working Directory",
    });

    if (!picked) return { ok: false, workDir: null };

    let selected: string;
    if (picked.label === "$(folder) Browse...") {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: rootUri,
        openLabel: "Select Working Directory",
      });
      if (!uris || uris.length === 0) return { ok: false, workDir: null };
      selected = uris[0].fsPath;
    } else {
      selected = picked.description!;
    }

    if (selected !== ctx.workspaceRoot && !selected.startsWith(ctx.workspaceRoot + path.sep)) {
      vscode.window.showWarningMessage("Selected directory must be within the workspace.");
      return { ok: false, workDir: null };
    }

    ctx.setCustomWorkDir(selected === ctx.workspaceRoot ? null : selected);
    return { ok: true, workDir: selected };
  },

  [RpcMethod.LoadKimiSessionHistory]: async (params: { kimiSessionId: string }, ctx) => {
    if (!ctx.workDir) return [];
    // Would validate UUID and load history
    return [];
  },

  [RpcMethod.DeleteKimiSession]: async (params: { sessionId: string }, ctx) => {
    if (!ctx.workDir) return { ok: false };
    return { ok: true };
  },

  [RpcMethod.ForkKimiSession]: async (params: { sessionId: string; turnIndex: number }, ctx) => {
    if (!ctx.workDir || params.turnIndex < 0) return null;
    return null;
  },

  // Editor / File
  [RpcMethod.GetProjectFiles]: async (params: { directory?: string; query?: string }, ctx) => {
    if (!ctx.workDir) return [];
    if (params.directory !== undefined) {
      return ctx.fileManager.listDirectory(ctx.workDir, params.directory);
    }
    return ctx.fileManager.searchFiles(params.query);
  },

  [RpcMethod.GetEditorContext]: async () => getEditorContext(),

  [RpcMethod.InsertText]: async (params: { text: string }) => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((edit) => edit.insert(editor.selection.active, params.text));
    }
    return { ok: true };
  },

  [RpcMethod.PickMedia]: async (params: { maxCount?: number; includeVideo?: boolean }) => {
    const maxCount = params.maxCount ?? 9;
    const includeVideo = params.includeVideo ?? true;
    const filters: Record<string, string[]> = { Images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"] };
    if (includeVideo) {
      filters.Videos = ["mp4", "webm", "mov"];
      filters["All Media"] = [...filters.Images, ...filters.Videos];
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters,
      title: "Select Media",
    });

    if (!uris) return [];

    const results: string[] = [];
    const imageLimit = 10 * 1024 * 1024;
    const videoLimit = 20 * 1024 * 1024;

    for (const uri of uris.slice(0, maxCount)) {
      try {
        const ext = path.extname(uri.fsPath).toLowerCase().slice(1);
        const limit = VIDEO_EXTENSIONS.has(`.${ext}`) ? videoLimit : imageLimit;
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > limit) continue;
        const data = await vscode.workspace.fs.readFile(uri);
        const mime = getMediaMimeType(ext);
        results.push(`data:${mime};base64,${Buffer.from(data).toString("base64")}`);
      } catch {
        // ignore
      }
    }

    return results;
  },

  [RpcMethod.OpenFile]: async (params: { filePath: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const target = resolvePath(workDir, params.filePath);
    if (!isWithinWorkDir(workDir, target)) return { ok: false };
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(target));
    return { ok: true };
  },

  [RpcMethod.OpenFileDiff]: async (params: { filePath: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const sessionId = ctx.getSessionId();
    if (!sessionId) return { ok: false };
    const target = resolvePath(workDir, params.filePath);
    if (!isWithinWorkDir(workDir, target)) return { ok: false };
    const rel = path.relative(workDir, target);
    const baselineUri = vscode.Uri.from({
      scheme: "kimi-baseline",
      path: "/" + rel,
      query: new URLSearchParams({ workDir, sessionId }).toString(),
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      baselineUri,
      vscode.Uri.file(target),
      `${path.basename(rel)} (changes from Kimi)`,
    );
    return { ok: true };
  },

  [RpcMethod.SaveBaselines]: async (params: { paths: string[] }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const sessionId = ctx.getSessionId();
    if (!sessionId) return { ok: false };
    for (const p of params.paths) {
      const target = resolvePath(workDir, p);
      if (!isWithinWorkDir(workDir, target)) continue;
      const rel = path.relative(workDir, target);
      let content = "";
      if (fs.existsSync(target)) {
        try {
          content = fs.readFileSync(target, "utf-8");
        } catch {
          // ignore
        }
      }
      baselineTracker.saveBaseline(workDir, sessionId, rel, content);
    }
    return { ok: true };
  },

  [RpcMethod.TrackFiles]: async (params: { paths: string[] }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const sessionId = ctx.getSessionId();
    if (!sessionId) return [];
    for (const p of params.paths) {
      const target = resolvePath(workDir, p);
      if (isWithinWorkDir(workDir, target)) {
        ctx.fileManager.trackFile(ctx.webviewId, target);
      }
    }
    const tracked = ctx.fileManager.getTracked(ctx.webviewId);
    const changes = await baselineTracker.getChanges(workDir, sessionId, tracked);
    ctx.broadcast(WebviewEvent.FileChangesUpdated, changes, ctx.webviewId);
    return changes;
  },

  [RpcMethod.ClearTrackedFiles]: async (_params, ctx) => {
    ctx.fileManager.clearTracked(ctx.webviewId);
    ctx.broadcast(WebviewEvent.FileChangesUpdated, [], ctx.webviewId);
    return { ok: true };
  },

  [RpcMethod.RevertFiles]: async (params: { filePath?: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const sessionId = ctx.getSessionId();
    if (!sessionId) return { ok: false };
    const tracked = ctx.fileManager.getTracked(ctx.webviewId);
    if (params.filePath) {
      const target = resolvePath(workDir, params.filePath);
      if (!isWithinWorkDir(workDir, target)) return { ok: false };
      const rel = path.relative(workDir, target);
      baselineTracker.revertFile(workDir, sessionId, rel);
    } else {
      baselineTracker.revertAll(workDir, sessionId, tracked);
      ctx.fileManager.clearTracked(ctx.webviewId);
    }
    const remaining = ctx.fileManager.getTracked(ctx.webviewId);
    const changes = await baselineTracker.getChanges(workDir, sessionId, remaining);
    ctx.broadcast(WebviewEvent.FileChangesUpdated, changes, ctx.webviewId);
    return { ok: true };
  },

  [RpcMethod.KeepChanges]: async (params: { filePath?: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const sessionId = ctx.getSessionId();
    if (!sessionId) return { ok: false };
    const tracked = ctx.fileManager.getTracked(ctx.webviewId);
    if (params.filePath) {
      const target = resolvePath(workDir, params.filePath);
      if (!isWithinWorkDir(workDir, target)) return { ok: false };
      const rel = path.relative(workDir, target);
      baselineTracker.clearBaseline(workDir, sessionId, rel);
    } else {
      baselineTracker.clearBaselines(workDir, sessionId, tracked);
      ctx.fileManager.clearTracked(ctx.webviewId);
    }
    const remaining = ctx.fileManager.getTracked(ctx.webviewId);
    const changes = await baselineTracker.getChanges(workDir, sessionId, remaining);
    ctx.broadcast(WebviewEvent.FileChangesUpdated, changes, ctx.webviewId);
    return { ok: true };
  },

  [RpcMethod.CheckFileExists]: async (params: { filePath: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const target = resolvePath(workDir, params.filePath);
    return fs.existsSync(target);
  },

  [RpcMethod.CheckFilesExist]: async (params: { paths: string[] }, ctx) => {
    const workDir = ctx.requireWorkDir();
    return params.paths.map((p) => {
      const target = resolvePath(workDir, p);
      return { path: p, exists: fs.existsSync(target) };
    });
  },

  [RpcMethod.GetImageDataUri]: async (params: { filePath: string }, ctx) => {
    const workDir = ctx.requireWorkDir();
    const target = resolvePath(workDir, params.filePath);
    if (!isWithinWorkDir(workDir, target)) return null;
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
      const ext = path.extname(target).toLowerCase().slice(1);
      const mime = getMediaMimeType(ext);
      return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
    } catch {
      return null;
    }
  },

  // CLI
  [RpcMethod.CheckCLI]: async (_params, ctx) => {
    if (!ctx.workDir) {
      return {
        ok: false,
        resolved: { isCustomPath: false, path: "" },
        error: { type: "not_found", message: "No workspace folder open" },
      };
    }
    // Would call CliBinaryManager
    return { ok: true, resolved: { isCustomPath: false, path: "kimi" } };
  },

  // Auth
  [RpcMethod.CheckLoginStatus]: async () => {
    return { loggedIn: false };
  },

  [RpcMethod.Login]: async (_params, ctx) => {
    const result = await login({
      onUrl: (url) => {
        ctx.broadcast(WebviewEvent.LoginUrl, { url }, ctx.webviewId);
      },
    });
    return result;
  },

  [RpcMethod.Logout]: async () => {
    return logout();
  },
};

