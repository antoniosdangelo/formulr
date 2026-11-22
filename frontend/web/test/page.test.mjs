// Checks the built page in ../public without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pub = new URL("../../public/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, pub), "utf8");
const text = (html) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

for (const name of ["index.html", "install.html"]) {
  test(`${name} is prerendered with the whole page in the HTML`, () => {
    const html = read(name);
    const t = text(html);
    assert.ok(!html.includes("<!--app-->"), "placeholder was replaced");
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
    assert.match(t, /=FORMULR\.ANSWER\(B2\)/);
    assert.match(t, /Set up in three steps/);
    assert.match(t, /Get the add-in/);
    assert.match(t, /Upload it in Excel/);
    assert.match(t, /Add your AI key/);
    assert.match(t, /never uses anyone else's AI key/);
    assert.match(t, /Your key stays on your device/);
    assert.match(t, /Supported providers/);
    assert.match(t, /Anthropic \(Claude\)/);
    assert.match(t, /Google Gemini/);
    assert.match(t, /Questions/);
    assert.match(t, /Privacy/);
    assert.match(html, /href="download"/, "download link keeps the /download route");
  });

  test(`${name} loads only external scripts from this site`, () => {
    const html = read(name);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 1);
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /src="\/web\/[\w.-]+\.js"/);
      assert.equal(body.trim(), "", "no inline script");
    }
    assert.doesNotMatch(html, /\son[a-z]+="/i, "no inline event handlers");
  });

  test(`${name} never asks for an access code`, () => {
    const t = text(read(name)).replace(/no (sign up and no |sign up, no )?access code/gi, "");
    assert.doesNotMatch(t, /access code/i);
  });
}

test("the built files the pages point at exist", () => {
  const html = read("install.html");
  for (const [, src] of html.matchAll(/(?:src|href)="(\/web\/[^"]+)"/g)) {
    assert.ok(fs.existsSync(new URL("." + src, pub)), src + " exists");
  }
});

test("the add-in files are still there, untouched by the build", () => {
  for (const f of ["taskpane.html", "functions.js", "functions.json", "app.js", "styles.css", "_headers", "icon-32.png"]) {
    assert.ok(fs.existsSync(new URL(f, pub)), f);
  }
  assert.match(read("taskpane.html"), /id="key-section"/);
});
