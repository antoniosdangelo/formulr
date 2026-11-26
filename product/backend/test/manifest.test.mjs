import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import worker from "../src/worker.js";
import { renderManifest, ADD_IN_ID } from "../src/manifest.js";

const ORIGIN = "https://helper.test";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const xml = renderManifest(ORIGIN);

test("manifest XML is well formed", () => {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClose] = m;
    if (selfClose) continue;
    if (closing) assert.equal(stack.pop(), name, "mismatched closing tag </" + name + ">");
    else stack.push(name);
  }
  assert.deepEqual(stack, [], "unclosed tags: " + stack.join(","));
});

test("every resid the manifest references is defined, and nothing is left undefined", () => {
  const used = new Set([...xml.matchAll(/resid="([^"]+)"/g)].map((m) => m[1]));
  const defined = new Set([...xml.matchAll(/<bt:(?:Image|Url|String) id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of used) assert.ok(defined.has(id), "missing resource: " + id);
  for (const id of defined) assert.ok(used.has(id), "unused resource: " + id);
});

test("manifest wires the shared runtime, custom functions and ribbon the way Microsoft's sample does", () => {
  assert.match(xml, /<Id>[0-9a-f-]{36}<\/Id>/);
  assert.ok(xml.includes(ADD_IN_ID));
  assert.match(xml, /<Runtime resid="Taskpane\.Url" lifetime="long"\/>/);
  assert.match(xml, /<Set Name="SharedRuntime" MinVersion="1\.1"\/>/);
  assert.match(xml, /<Permissions>ReadWriteDocument<\/Permissions>/);
  assert.match(xml, /<ExtensionPoint xsi:type="CustomFunctions">/);
  assert.match(xml, /<Namespace resid="Functions\.Namespace"\/>/);
  assert.match(xml, /<bt:String id="Functions\.Namespace" DefaultValue="FORMULR"\/>/);
  assert.match(xml, /<FunctionFile resid="Taskpane\.Url"\/>/);
  assert.match(xml, /<FunctionName>askPicture<\/FunctionName>/);
  // Microsoft: with a shared runtime the pane page, function file and custom functions page must all be the same URL.
  const urls = Object.fromEntries([...xml.matchAll(/<bt:Url id="([^"]+)" DefaultValue="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.equal(urls["Taskpane.Url"], ORIGIN + "/taskpane.html");
  assert.match(xml, new RegExp("<SourceLocation DefaultValue=\"" + ORIGIN + "/taskpane\\.html\"/>"));
  // Office limits: labels 32 chars, supertip descriptions 250.
  for (const m of xml.matchAll(/<bt:String id="[^"]*Label" DefaultValue="([^"]+)"/g)) assert.ok(m[1].length <= 32, m[1]);
  for (const m of xml.matchAll(/<bt:String id="[^"]*Tooltip" DefaultValue="([^"]+)"/g)) assert.ok(m[1].length <= 250, m[1]);
});

test("the manifest is served for whatever origin it is requested from, and escapes it", async () => {
  const res = await worker.fetch(new Request("https://other.example/manifest.xml"), {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /xml/);
  const text = await res.text();
  assert.ok(text.includes("https://other.example/taskpane.html"));
  assert.ok(!text.includes(ORIGIN));
  assert.ok(renderManifest('https://a.test/"><x').includes("&quot;&gt;&lt;x"));
});

test("function metadata, code and manifest agree", () => {
  const meta = JSON.parse(read("../../frontend/functions.json"));
  const code = read("../../frontend/functions.js");
  for (const fn of meta.functions) {
    assert.ok(code.includes(`CustomFunctions.associate("${fn.id}"`), "no associate() for " + fn.id);
    assert.ok(fn.parameters.length > 0 && !fn.description, "no description: it only adds a pop up under the formula");
    let sawOptional = false;
    for (const p of fn.parameters) {
      if (sawOptional) assert.ok(p.optional, "optional parameters must come last in " + fn.id);
      if (p.optional) sawOptional = true;
    }
  }
  assert.deepEqual(meta.functions.map((f) => f.id), ["ANSWER"]);
  const appJs = read("../../frontend/app.js");
  for (const name of [...xml.matchAll(/<FunctionName>(\w+)<\/FunctionName>/g)].map((m) => m[1])) {
    assert.ok(appJs.includes(`Office.actions.associate("${name}"`), "ribbon action without a registered handler: " + name);
  }
  assert.equal([...xml.matchAll(/<FunctionName>/g)].length, 1, "one ribbon command: askPicture");
});

test("task pane follows Microsoft's loading rules and has no inline script", () => {
  const html = read("../../frontend/taskpane.html");
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  assert.ok(head.includes("https://officeapis.public.onecdn.static.microsoft/1/office.js"), "official CDN in <head>");
  assert.ok(head.indexOf("office.js") < head.indexOf("styles.css"));
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "inline scripts would break the CSP");
  assert.ok(!/\sstyle="/i.test(html) && !/<style/i.test(html), "inline styles would break the CSP");
  assert.ok(html.indexOf("functions.js") < html.indexOf("app.js"));
  assert.ok(html.indexOf('id="status"') < html.indexOf('id="run-answer"'), "the status line is near the top, not below the fold");
  assert.ok(html.includes('id="banner"'));
});

test("security headers allow Excel on the web to frame the pane and nothing else", () => {
  const headers = read("../../frontend/_headers");
  const fa = headers.match(/frame-ancestors ([^\n]+)/)[1];
  for (const host of ["*.office.com", "*.officeapps.live.com", "*.cloud.microsoft", "*.microsoft.com"]) assert.ok(fa.includes("https://" + host), host);
  assert.ok(!/frame-ancestors[^\n]*(\*\s|\s\*$|http:)/.test(headers), "no wildcard or plain http parents");
  const scriptSrc = headers.match(/script-src ([^;]+)/)[1];
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/, "scripts cannot be inline or eval");
  assert.doesNotMatch(headers, /unsafe-eval/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test("secrets never appear in source or config", () => {
  for (const f of ["../src/worker.js", "../src/core.js", "../wrangler.jsonc", "../../frontend/app.js", "../../frontend/functions.js"]) {
    const t = read(f);
    assert.doesNotMatch(t, /AIza[0-9A-Za-z_-]{20,}/, f + " contains something shaped like a Google key");
  }
});

test("every URL in the manifest maps to a real file, and HTML is served without redirects", () => {
  const cfg = read("../wrangler.jsonc");
  assert.match(cfg, /"html_handling":\s*"none"/, "Workers assets would otherwise 307 /taskpane.html to /taskpane");
  for (const m of xml.matchAll(/DefaultValue="(https:\/\/helper\.test)(\/[^"]*)"/g)) {
    const path = m[2];
    if (path === "/manifest.xml") continue;
    assert.ok(existsSync(new URL("../../frontend" + path, import.meta.url)), "manifest points at a missing file: " + path);
  }
});

test("the function metadata and script are readable cross origin, as Excel on the web fetches them from its own origin", () => {
  const headers = read("../../frontend/_headers");
  for (const file of ["/functions.json", "/functions.js"]) {
    const block = headers.split(/\n(?=\/)/).find((b) => b.startsWith(file));
    assert.ok(block && /Access-Control-Allow-Origin: \*/.test(block), file + " needs Access-Control-Allow-Origin");
  }
  assert.ok(!/\/api|manifest/.test(headers.split("/functions.json")[1] ?? ""), "only the public static files are opened up");
});

test("shared runtime rules from Microsoft: no TaskpaneId under the long runtime, and one consistent Taskpane.Url", () => {
  const xml = renderManifest(ORIGIN);
  assert.ok(!xml.includes("TaskpaneId"), "a task pane id would start a second, non shared pane runtime");
  assert.equal((xml.match(/resid="Taskpane\.Url"/g) || []).length, 4, "Runtime, Page, FunctionFile and ShowTaskpane");
  assert.ok(!xml.includes("Shared.Url"));
});
