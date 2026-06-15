import * as vscode from "vscode";

export interface KimixConfig {
  executable: string;
  host: string;
  basePort: number;
  environmentVariables: Record<string, string>;
  showThinking: boolean;
  autoScroll: boolean;
  enableMentions: boolean;
  planModeEnabled: boolean;
  planFilePath: string;
  planAgent: string;
  planMaxAttempts: number;
  openPlanFileAfterGeneration: boolean;
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
    planModeEnabled: c.get<boolean>("planModeEnabled", true),
    planFilePath: c.get<string>("planFilePath", ".kimix/plan.md"),
    planAgent: c.get<string>("planAgent", ""),
    planMaxAttempts: c.get<number>("planMaxAttempts", 3),
    openPlanFileAfterGeneration: c.get<boolean>("openPlanFileAfterGeneration", true),
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
