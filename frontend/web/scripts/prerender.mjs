// Puts the rendered page into the built HTML, so it shows instantly and reads fine without JavaScript.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const out = path.resolve(web, "../public");
const ssrDir = path.join(web, ".ssr");

const { render } = await import(pathToFileURL(path.join(ssrDir, "entry-server.js")).href);
const markup = render();

for (const name of ["index.html", "install.html"]) {
  const file = path.join(out, name);
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("<!--app-->")) throw new Error(name + " has no <!--app--> placeholder");
  fs.writeFileSync(file, html.replace("<!--app-->", markup).replace(/\r\n/g, "\n"));
}
fs.rmSync(ssrDir, { recursive: true, force: true });
console.log("Prerendered index.html and install.html");
