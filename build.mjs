import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", {recursive:true});
await cp("static", "dist", {recursive:true});
execFileSync(process.platform === "win32" ? "python" : "python3", ["nasa_oem.py","dist/nasa-forecast.json"], {stdio:"inherit"});
let html=await readFile("dist/index.html","utf8");
html=html.replace('<script src="app.js" defer></script>','<script src="browser-api.bundle.js" defer></script>\n  <script src="app.js" defer></script>');
await writeFile("dist/index.html",html);
await build({
  entryPoints:["static/browser-api.js"],
  outfile:"dist/browser-api.bundle.js",
  bundle:true,
  format:"iife",
  target:"es2020",
  minify:true
});
