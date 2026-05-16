import { vi } from "vitest";
import { EventEmitter } from "node:events";

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}`, scheme: "file", path }),
  joinPath: (uri: any, ...paths: string[]) => {
    const joined = [uri.fsPath, ...paths].join("/").replace(/\/+/g, "/");
    return { fsPath: joined, toString: () => `file://${joined}`, scheme: "file", path: joined };
  },
  from: ({ scheme, path, query }: any) => ({
    scheme,
    path,
    query,
    fsPath: path,
    toString: () => `${scheme}://${path}?${query}`,
  }),
  parse: (str: string) => {
    const url = new URL(str);
    return { fsPath: url.pathname, toString: () => str, scheme: url.protocol.slice(0, -1), path: url.pathname };
  },
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
}

export enum QuickPickItemKind {
  Default = 0,
  Separator = 1,
}

export const workspace = {
  workspaceFolders: null as any,
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: any) => defaultValue),
    update: vi.fn(),
  })),
  textDocuments: [] as any[],
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  asRelativePath: vi.fn((uriOrPath: any) => {
    if (typeof uriOrPath === "string") return uriOrPath;
    return uriOrPath.fsPath;
  }),
  findFiles: vi.fn(async () => []),
  fs: {
    readDirectory: vi.fn(async () => []),
    readFile: vi.fn(async () => Buffer.from("")),
    stat: vi.fn(async () => ({ size: 0, type: FileType.File })),
    writeFile: vi.fn(async () => undefined),
  },
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

export const window = {
  activeTextEditor: null as any,
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(() => ({
    webview: {
      html: "",
      asWebviewUri: vi.fn((uri: any) => uri),
      cspSource: "vscode-resource:",
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showQuickPick: vi.fn(async () => undefined),
  showOpenDialog: vi.fn(async () => undefined),
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
};

export const extensions = {
  getExtension: vi.fn(() => null),
};

export const env = {
  remoteName: undefined,
};

export class EventEmitterMock<T = any> {
  private listeners: Array<(e: T) => any> = [];
  event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire = (data: T) => this.listeners.forEach((l) => l(data));
}

export const CancellationTokenSource = vi.fn(() => ({
  token: { isCancellationRequested: false, onCancellationRequested: vi.fn() },
  cancel: vi.fn(),
  dispose: vi.fn(),
}));

export const ExtensionContext = vi.fn(() => ({
  extensionUri: Uri.file("/extension"),
  globalStorageUri: Uri.file("/globalStorage"),
  workspaceState: new MementoMock(),
  globalState: new MementoMock(),
  subscriptions: [],
}));

export class MementoMock {
  private storage = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.storage.has(key) ? this.storage.get(key) : defaultValue;
  }
  update(key: string, value: any): Thenable<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }
}

export default {
  Uri,
  FileType,
  ViewColumn,
  QuickPickItemKind,
  workspace,
  window,
  commands,
  extensions,
  env,
  EventEmitter: EventEmitterMock,
  CancellationTokenSource,
};
