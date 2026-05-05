const esbuild = require("esbuild");

async function watch() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    sourcemap: true,
    define: {
      "process.env.NODE_ENV": '"development"',
    },
  });

  await ctx.watch();
  console.log("Watching for changes...");
}

watch().catch((err) => {
  console.error(err);
  process.exit(1);
});
