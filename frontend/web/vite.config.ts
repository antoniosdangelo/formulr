import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The page builds straight into ../public next to the add-in files, which it must never delete.
// File names have no hashes so a rebuild of the same source gives the same files (CI checks this).
// The second, server side build only renders the page to HTML at build time and is thrown away after.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  // House standard: each project has its own dev port, and Vite stops instead of drifting to another one.
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
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
