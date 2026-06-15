import * as vscode from "vscode";

export interface KimixConfig {
  executable: string;
  host: string;
  basePort: number;
  environmentVariables: Record<string, string>;
  showThinking: boolean;
  autoScroll: boolean;
  enableMentions: boolean;
}

const SECTION = "kimix";

/** Read the current extension configuration. */
export function readConfig(): KimixConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    executable: c.get<string>("executable", "opencode") || "opencode",
    host: c.get<string>("host", "127.0.0.1") || "127.0.0.1",
    basePort: c.get<number>("basePort", 4096) || 4096,
    environmentVariables: c.get<Record<string, string>>(
      "environmentVariables",
      {},
    ),
    showThinking: c.get<boolean>("showThinking", true),
    autoScroll: c.get<boolean>("autoScroll", true),
    enableMentions: c.get<boolean>("enableMentions", true),
  };
}

/** Subscribe to changes of any `kimix.*` setting. */
export function onConfigChange(
  cb: (config: KimixConfig) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      cb(readConfig());
    }
  });
}
