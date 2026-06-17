#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function resolvePnpm() {
  if (commandExists("pnpm")) {
    return ["pnpm"];
  }
  if (commandExists("corepack")) {
    return ["corepack", "pnpm"];
  }
  console.error("Could not find pnpm or corepack. Please install Node.js with Corepack enabled.");
  process.exit(1);
}

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const pnpm = resolvePnpm();
const pnpmCommand = pnpm[0];
const pnpmPrefix = pnpm.slice(1);

run("Build webview UI", pnpmCommand, [
  ...pnpmPrefix,
  "--filter",
  "kimix-webview-ui",
  "run",
  "build",
]);

run("Copy webview assets into VS Code extension", pnpmCommand, [
  ...pnpmPrefix,
  "--filter",
  "kimix-webview-ui",
  "run",
  "copy-to-ext",
]);

run("Build VS Code extension host", pnpmCommand, [
  ...pnpmPrefix,
  "--filter",
  "kimix-vscode-ext",
  "run",
  "build:extension",
]);

console.log("\nDone. Reload the VS Code window to use the rebuilt extension.");
