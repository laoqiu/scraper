import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const input = process.env.INPUT;
if (!input) throw new Error("INPUT environment variable is not set");

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    sourcemap: process.env.NODE_ENV === "development" ? "inline" : undefined,
    minify: process.env.NODE_ENV === "development" ? false : "terser",
    terserOptions: {
      compress: {
        passes: 2,
        drop_debugger: true,
      },
      mangle: {
        toplevel: true,
      },
      format: {
        comments: false,
      },
    },
    cssMinify: process.env.NODE_ENV !== "development",
    rollupOptions: { input },
    outDir: "dist",
    emptyOutDir: true,
  },
});
