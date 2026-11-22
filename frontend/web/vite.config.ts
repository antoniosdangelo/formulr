import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The page builds straight into ../public next to the add-in files, which it must never delete.
// File names have no hashes so a rebuild of the same source gives the same files (CI checks this).
// The second, server side build only renders the page to HTML at build time and is thrown away after.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  base: "/",
  build: isSsrBuild
    ? { outDir: ".ssr", emptyOutDir: true }
    : {
        outDir: "../public",
        emptyOutDir: false,
        assetsDir: "web",
        modulePreload: { polyfill: false },
        rollupOptions: {
          input: { index: "index.html", install: "install.html" },
          output: {
            entryFileNames: "web/[name].js",
            chunkFileNames: "web/[name].js",
            assetFileNames: "web/[name][extname]",
          },
        },
      },
}));
