const esbuild = require("esbuild");

const isProduction = process.argv.includes("--production");

async function build() {
  await esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    sourcemap: !isProduction,
    minify: isProduction,
    define: {
      "process.env.NODE_ENV": isProduction ? '"production"' : '"development"',
    },
  });
  console.log("Extension built successfully.");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
