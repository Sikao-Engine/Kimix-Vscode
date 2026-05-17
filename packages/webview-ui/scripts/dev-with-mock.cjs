const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

console.log("Starting mock server + vite dev server...\n");

const mock = spawn("node", ["scripts/mock-server.cjs"], {
  stdio: "inherit",
  cwd: ROOT,
});

const vite = spawn("node", [path.join(ROOT, "node_modules", "vite", "bin", "vite.js")], {
  stdio: "inherit",
  cwd: ROOT,
});

function cleanup() {
  mock.kill();
  vite.kill();
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
