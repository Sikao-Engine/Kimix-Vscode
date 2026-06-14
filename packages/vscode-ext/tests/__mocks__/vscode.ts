/** Minimal vscode API mock for unit tests (Disposable + EventEmitter only). */
export class Disposable {
  constructor(private fn: () => void) {}
  dispose() {
    this.fn();
  }
}

export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    show: () => {},
  }),
  showErrorMessage: () => {},
  registerWebviewViewProvider: () => new Disposable(() => {}),
  createWebviewPanel: () => ({}),
};

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, def: unknown) => def,
  }),
  onDidChangeConfiguration: () => new Disposable(() => {}),
  workspaceFolders: [] as unknown[],
};

export const commands = {
  registerCommand: () => new Disposable(() => {}),
};

export const Uri = {
  joinPath: (...parts: unknown[]) => ({ parts }),
  file: (p: string) => ({ fsPath: p }),
};

export const ViewColumn = { Active: 1, Beside: 2 };
