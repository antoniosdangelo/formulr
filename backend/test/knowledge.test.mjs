import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectPacks, knowledgeFor } from "../src/knowledge.js";
import { parsePack, buildKnowledge } from "../scripts/build-knowledge.mjs";
import { buildAnthropicBody } from "../src/core.js";

const BONDS = { name: "bonds.md", triggers: "\\b(bonds?|yield)\\b", text: "BOND NOTES" };
const ALWAYS = { name: "style.md", triggers: null, text: "HOUSE STYLE" };

test("a pack with a triggers line is used only for matching questions, and one without is always used", () => {
  const packs = [BONDS, ALWAYS];
  assert.deepEqual(selectPacks(packs, "What is the bond price?").map((p) => p.name), ["bonds.md", "style.md"]);
  assert.deepEqual(selectPacks(packs, "Translate hello").map((p) => p.name), ["style.md"]);
  assert.deepEqual(selectPacks(packs, "BOND yield").map((p) => p.name), ["bonds.md", "style.md"], "case insensitive");
  assert.equal(knowledgeFor([BONDS], "Translate hello"), "");
  assert.equal(knowledgeFor([BONDS, ALWAYS], "bond", "in Spanish"), "BOND NOTES\n\nHOUSE STYLE");
  assert.equal(knowledgeFor([], "anything"), "");
});

test("packs are added after the stable prompt, cached, only for questions, and per request notes come last", () => {
  const q = { mode: "answer", input: "A bond has a 5% coupon", instruction: "", careful: true };
  const body = buildAnthropicBody(q, "claude-sonnet-5-5", [BONDS, ALWAYS]);
  assert.equal(body.system.length, 3);
  assert.ok(!body.system[0].text.includes("BOND NOTES"), "the stable prompt comes first so caching works");
  assert.equal(body.system[1].text, "BOND NOTES\n\nHOUSE STYLE");
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" });
  assert.match(body.system[2].text, /Take your time/);
  const none = buildAnthropicBody({ mode: "answer", input: "Translate hello" }, "claude-sonnet-5-5", [BONDS]);
  assert.equal(none.system.length, 1, "no matching pack, no extra block");
  const extract = buildAnthropicBody({ mode: "extract", input: "bond data", fields: ["a"] }, "claude-sonnet-5-5", [BONDS, ALWAYS]);
  assert.equal(extract.system.length, 1, "mechanical jobs stay lean");
  assert.equal(buildAnthropicBody({ mode: "answer", input: "bond" }, "claude-sonnet-5-5", []).system.length, 1, "works with no packs at all");
});

test("pack files are parsed: optional triggers line, validation, and clear errors", () => {
  assert.deepEqual(parsePack("a.md", "triggers: foo|bar\nBody text\n"), { name: "a.md", triggers: "foo|bar", text: "Body text" });
  assert.deepEqual(parsePack("b.md", "\uFEFFNo triggers here\r\nSecond line"), { name: "b.md", triggers: null, text: "No triggers here\nSecond line" });
  assert.throws(() => parsePack("c.md", "triggers: (unclosed\nBody"), /not a valid regular expression/);
  assert.throws(() => parsePack("d.md", "triggers: x\n   \n"), /is empty/);
  assert.throws(() => parsePack("e.md", "x".repeat(200_001)), /longer than/);
});

test("the build script bundles knowledge files, skips the README, and writes a loadable module", async () => {
  const root = mkdtempSync(join(tmpdir(), "formulr-"));
  mkdirSync(join(root, "knowledge"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "knowledge", "README.md"), "# not a pack");
  writeFileSync(join(root, "knowledge", "z-notes.txt"), "Plain text pack");
  writeFileSync(join(root, "knowledge", "a-bonds.md"), "triggers: bond\nBond pack with \"quotes\" and `ticks` and ${dollars}");
  writeFileSync(join(root, "knowledge", "ignore.json"), "{}");
  assert.deepEqual(buildKnowledge(root), ["a-bonds.md", "z-notes.txt"]);
  const out = readFileSync(join(root, "src", "knowledge.data.js"), "utf8");
  const mod = await import("data:text/javascript;base64," + Buffer.from(out).toString("base64"));
  assert.equal(mod.PACKS.length, 2);
  assert.equal(mod.PACKS[0].text, 'Bond pack with "quotes" and `ticks` and ${dollars}', "special characters survive");
  const empty = mkdtempSync(join(tmpdir(), "formulr-empty-"));
  mkdirSync(join(empty, "src"));
  assert.deepEqual(buildKnowledge(empty), [], "no knowledge folder is fine");
});

test("the shared example pack is a valid pack with a checked number", () => {
  const raw = readFileSync(new URL("../knowledge/example-bonds.md", import.meta.url), "utf8");
  const pack = parsePack("example-bonds.md", raw);
  assert.ok(new RegExp(pack.triggers, "i").test("What is the price of this bond?"));
  const price = 50 / 1.06 + 50 / 1.06 ** 2 + 1050 / 1.06 ** 3;
  assert.ok(Math.abs(price - 973.27) < 0.006);
  assert.ok(pack.text.includes("973.27"));
});
