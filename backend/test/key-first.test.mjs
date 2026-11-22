// The user facing pages must lead with "bring your own key", so nobody expects to use someone else's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const readme = read("../../README.md");
const install = read("../../frontend/public/install.html");
const pane = read("../../frontend/public/taskpane.html");

test("README leads with the install page and your own key, and self hosting is the advanced path", () => {
  const get = readme.indexOf("## Get Formulr");
  const own = readme.indexOf("## Your own AI key, always");
  const adv = readme.indexOf("## Advanced: run your own copy");
  assert.ok(get > 0 && own > get && adv > own, "Get Formulr, then the key promise, then Advanced");
  assert.match(readme.slice(get, own), /https:\/\/\S+\/install/, "the install page link is in Get Formulr");
  assert.match(readme.slice(get, own), /your own\*\* key/i);
  assert.ok(!readme.slice(0, adv).includes("setup.cmd"), "setup.cmd only appears under Advanced");
  assert.match(readme, /never uses anyone else's AI key/);
  assert.match(readme, /OWNER_CODE/);
  assert.equal(readme.match(/^\| `=FORMULR\.ANSWER\(B2\)`/gm).length, 1, "one ANSWER row in the formula table");
});

test("install page promises the key stays yours before any step", () => {
  const promise = install.indexOf("key-promise");
  const steps = install.indexOf('<ol class="steps">');
  assert.ok(promise > 0 && promise < steps);
  assert.match(install, /never uses anyone else's AI key/);
  assert.match(install, /Your key stays on your device/);
  assert.match(install, /Add your AI key/);
});

test("the side bar shows the key box first", () => {
  const key = pane.indexOf('id="key-section"');
  const code = pane.indexOf('id="code"');
  assert.ok(key > 0 && key < code, "key box comes before the access code");
  assert.match(pane, /never uses anyone else's key/);
});
