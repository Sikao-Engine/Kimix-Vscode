import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { CliError } from "../protocol/errors";
import { CliErrorCode } from "../protocol/types";
import { CheckCliResult } from "./types";

interface PlatformConfig {
  uv: { target: string; ext: string };
  exe: string;
  wrapper: string;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  "darwin-arm64": { uv: { target: "aarch64-apple-darwin", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "darwin-x64": { uv: { target: "x86_64-apple-darwin", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "linux-arm64": { uv: { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "linux-x64": { uv: { target: "x86_64-unknown-linux-gnu", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "alpine-arm64": { uv: { target: "aarch64-unknown-linux-musl", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "alpine-x64": { uv: { target: "x86_64-unknown-linux-musl", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "win32-x64": { uv: { target: "x86_64-pc-windows-msvc", ext: "zip" }, exe: "kimi.exe", wrapper: "kimi.bat" },
};

function isMusl(): boolean {
  try {
    return execSync("ldd --version 2>&1 || true", { encoding: "utf-8" }).toLowerCase().includes("musl");
  } catch {
    return false;
  }
}

function getPlatformKey(): string {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") {
    const variant = isMusl() ? "alpine" : "linux";
    return arch === "arm64" ? `${variant}-arm64` : `${variant}-x64`;
  }
  if (platform === "win32") return "win32-x64";
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

function getPlatformConfig(): PlatformConfig {
  return PLATFORMS[getPlatformKey()];
}

interface Manifest {
  version: string;
  url: string;
}

interface InstalledInfo {
  version: string;
}

function readManifest(dir: string): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
  } catch {
    return null;
  }
}

function readInstalled(dir: string): InstalledInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "installed.json"), "utf-8"));
  } catch {
    return null;
  }
}

function writeInstalled(dir: string, info: InstalledInfo): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "installed.json"), JSON.stringify(info));
}

export class CliBinaryManager {
  readonly extensionBinPath: string;
  readonly kimiPath: string;
  readonly uvPath: string;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    const binDir = path.join(ctx.globalStorageUri.fsPath, "bin");
    this.extensionBinPath = path.join(ctx.extensionUri.fsPath, "bin", "kimi");
    this.kimiPath = path.join(binDir, "kimi");
    this.uvPath = path.join(binDir, "uv");
  }

  getExecutablePath(): string {
    const custom = vscode.workspace.getConfiguration("kimi").get<string>("executablePath", "");
    if (custom) return custom;
    return this.kimiPath;
  }

  checkInstalled(workDir: string): CheckCliResult {
    const execPath = this.getExecutablePath();
    try {
      execSync(`"${execPath}" --version`, { cwd: workDir, stdio: "ignore" });
      return {
        ok: true,
        resolved: {
          isCustomPath: execPath !== this.kimiPath,
          path: execPath,
        },
      };
    } catch {
      return {
        ok: false,
        resolved: {
          isCustomPath: execPath !== this.kimiPath,
          path: execPath,
        },
        error: {
          type: "not_found",
          message: "Kimi Code CLI not found.",
        },
      };
    }
  }

  async download(): Promise<void> {
    const platform = getPlatformConfig();
    const binDir = path.dirname(this.kimiPath);
    // Download logic would go here; simplified for type-safe reconstruction
    throw new CliError(CliErrorCode.CliNotFound, "Auto-download not implemented in reconstructed source");
  }
}
