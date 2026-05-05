import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { vitePluginCssInjectedByJs } from "vite-plugin-css-injected-by-js";

export default defineConfig({
  plugins: [react(), tailwindcss(), vitePluginCssInjectedByJs()],
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "webview.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "webview.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
  base: "",
});
