/** Minimal vscode API mock for unit tests (Disposable + EventEmitter only). */
export class Disposable {
  constructor(private fn: () => void) {}
  dispose() {
    this.fn();
  }
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(data: T) {
    for (const l of this.listeners) {
      l(data);
    }
  }
  dispose() {
    this.listeners = [];
  }
}

export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    show: () => {},
  }),
  showErrorMessage: () => {},
  showInformationMessage: () => Promise.resolve(undefined),
  registerWebviewViewProvider: () => new Disposable(() => {}),
  createWebviewPanel: () => ({}),
};

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, def: unknown) => def,
  }),
  onDidChangeConfiguration: () => new Disposable(() => {}),
  workspaceFolders: [] as unknown[],
  findFiles: () => Promise.resolve([]),
  asRelativePath: (uri: { fsPath?: string } | string, _includeWorkspaceFolder?: boolean) => {
    const fsPath = typeof uri === "string" ? uri : uri.fsPath ?? "";
    const roots = ["/workspace"];
    for (const root of roots) {
      if (fsPath.startsWith(root + "/")) {
        return fsPath.slice(root.length + 1);
      }
    }
    return fsPath;
  },
};

export const commands = {
  registerCommand: () => new Disposable(() => {}),
  executeCommand: () => Promise.resolve([]),
};

export const Uri = {
  joinPath: (...parts: unknown[]) => ({ parts }),
  file: (p: string) => ({ fsPath: p }),
};

export const ViewColumn = { Active: 1, Beside: 2 };

export const SymbolKind: Record<number, string> = {
  0: "File",
  1: "Module",
  2: "Namespace",
  3: "Package",
  4: "Class",
  5: "Method",
  6: "Property",
  7: "Field",
  8: "Constructor",
  9: "Enum",
  10: "Interface",
  11: "Function",
  12: "Variable",
  13: "Constant",
  14: "String",
  15: "Number",
  16: "Boolean",
  17: "Array",
  18: "Object",
  19: "Key",
  20: "Null",
  21: "EnumMember",
  22: "Struct",
  23: "Event",
  24: "Operator",
  25: "TypeParameter",
};
