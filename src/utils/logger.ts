import * as util from "node:util";

const namespaces = new Set<string>();
let enabled = "";

try {
  const env = process.env.DEBUG || "";
  enabled = env;
  for (const ns of env.split(",")) {
    if (ns) namespaces.add(ns);
  }
} catch {
  // ignore
}

function isEnabled(ns: string): boolean {
  for (const pattern of namespaces) {
    if (pattern === "*") return true;
    if (pattern.endsWith("*") && ns.startsWith(pattern.slice(0, -1))) return true;
    if (pattern === ns) return true;
  }
  return false;
}

export function createLogger(namespace: string) {
  const enabled = isEnabled(namespace);
  return {
    enabled,
    log: (...args: unknown[]): void => {
      if (!enabled) return;
      const msg = util.format(...args);
      const line = `${new Date().toISOString()} ${namespace} ${msg}`;
      console.error(line);
    },
    debug: (...args: unknown[]): void => {
      if (!enabled) return;
      const msg = util.format(...args);
      console.error(`%s %s %s`, new Date().toISOString(), namespace, msg);
    },
  };
}

export const logger = {
  protocol: createLogger("kimi-sdk:protocol").log,
  cli: createLogger("kimi-sdk:cli").log,
  config: createLogger("kimi-sdk:config").log,
  storage: createLogger("kimi-sdk:storage").log,
  bridge: createLogger("kimi-sdk:bridge").log,
};
