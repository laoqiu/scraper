import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await build({
  entryPoints: ["main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  treeShaking: true,
  keepNames: false,
});

await mkdir("dist", { recursive: true });
await copyFile("src/server/db/schema.sql", "dist/schema.sql");
