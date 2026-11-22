import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", {recursive:true});
await cp("static", "dist", {recursive:true});
await cp("data/current.tle","dist/current.tle");
let html=await readFile("dist/index.html","utf8");
html=html.replace('<script src="app.js" defer></script>','<script src="browser-api.bundle.js" defer></script>\n  <script src="app.js" defer></script>');
await writeFile("dist/index.html",html);
try {
  const response=await fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",{signal:AbortSignal.timeout(12000)});
  if(response.ok) await writeFile("dist/current.tle",await response.text());
} catch(error) { console.warn("Current ISS orbit unavailable during build:",error.message); }
await build({
  entryPoints:["static/browser-api.js"],
  outfile:"dist/browser-api.bundle.js",
  bundle:true,
  format:"iife",
  target:"es2020",
  minify:true
});
