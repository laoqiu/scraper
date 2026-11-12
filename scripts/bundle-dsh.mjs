import { build } from "esbuild";
import { copyFile, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("dsh/package.json", "utf8"));

await build({
  entryPoints: ["dsh/index.ts"],
  outfile: "dsh/dist/index.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
});

await build({
  entryPoints: ["dsh/client.tsx"],
  outfile: "dsh/dist/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  external: ["react", "react/*", "@deepseek-ai/*"],
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: "return module.exports;}});" },
});

await Promise.all(["main.js", "mcp-app.html", "schema.sql"].map(
  file => copyFile(`dist/${file}`, `dsh/dist/${file}`),
));
