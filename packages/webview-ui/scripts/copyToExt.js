#!/usr/bin/env node
/**
 * Copy built webview assets to vscode-ext/dist
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_DIR = path.resolve(__dirname, "../dist");
const PLUGIN_DIR = path.resolve(__dirname, "../../vscode-ext");
const ASSETS_DIR = path.join(PLUGIN_DIR, "assets");
const DIST_DIR = path.join(PLUGIN_DIR, "dist");

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  Copied: ${entry.name}`);
    }
  }
}

function main() {
  console.log("=== Copying webview-ui build to vscode-ext ===\n");

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Error: Source directory not found: ${SOURCE_DIR}`);
    console.error("Please run 'pnpm build' in webview-ui first.");
    process.exit(1);
  }

  // Copy to dist (for production & development)
  console.log(`Copying to dist: ${DIST_DIR}`);
  copyDir(SOURCE_DIR, DIST_DIR);
  console.log("");

  // Also copy to assets (optional, for backward compatibility)
  console.log(`Copying to assets: ${ASSETS_DIR}`);
  copyDir(SOURCE_DIR, ASSETS_DIR);
  console.log("");

  console.log("✅ Copy completed successfully!");
}

main();
