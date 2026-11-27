// The user facing pages must lead with "bring your own key", so nobody expects to use someone else's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const readme = read("../../../README.md");
const pane = read("../../frontend/taskpane.html");

test("README leads with the install page and your own key, and self hosting is under Build from source", () => {
  const install = readme.indexOf("## Install");
  const use = readme.indexOf("## Use");
  const build = readme.indexOf("## Build from source");
  assert.ok(install > 0 && use > install && build > use, "Install, then Use, then Build from source");
  assert.match(readme.slice(install, use), /https:\/\/\S+\/install/, "the install page link is in Install");
  assert.match(readme.slice(0, install), /your own\*\* AI key/i);
  assert.ok(!readme.slice(0, build).includes("setup.cmd"), "self hosting only appears under Build from source");
  assert.match(readme, /never uses anyone else's AI key/);
  assert.equal(readme.match(/^\| `=FORMULR\.ANSWER\(B2\)`/gm).length, 1, "one ANSWER row in the formula table");
});

test("the side bar shows the key box first", () => {
  const key = pane.indexOf('id="key-section"');
  const code = pane.indexOf('id="code"');
  assert.ok(key > 0 && key < code, "key box comes before the access code");
  assert.match(pane, /never uses anyone else's key/);
});

test("the add-in pane checks a key before saving it and links to the website guide", () => {
  assert.match(pane, /How do I get a key\?/);
  assert.match(pane, /href="https:\/\/formulr\.dev\/#get-key"/);
  assert.match(read("../../frontend/app.js"), /AI\.checkKey\(/);
  const fn = read("../../frontend/functions.js");
  assert.doesNotMatch(fn, /\/api\/key-check/, "the pane checks keys with the provider directly");
  assert.match(fn, /anthropic-dangerous-direct-browser-access/);
});
