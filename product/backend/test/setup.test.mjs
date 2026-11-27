import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSetup } from "../scripts/setup.mjs";
import { DB_NAME, findDatabase, generateAccessCode, isLoggedOut, parseDbId, parseWorkersUrl, patchD1Block, readD1Id, secretNames } from "../scripts/setup-lib.mjs";

const CONFIG = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const UUID_A = "00000000-0000-0000-0000-000000000000"; // the placeholder shipped in wrangler.jsonc
const UUID_B = "11111111-2222-3333-4444-555555555555";
const GEMINI = "AIza-test-key-0000000000000000";

// ---------- pure helpers ----------

test("access codes are 20 unambiguous characters in five groups, and differ each time", () => {
  let n = 0;
  const rnd = (len) => Uint8Array.from({ length: len }, () => (n += 37) % 256);
  const code = generateAccessCode(rnd);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
  assert.notEqual(generateAccessCode(rnd), code);
  const { randomBytes } = await_crypto();
  assert.notEqual(generateAccessCode((k) => randomBytes(k)), generateAccessCode((k) => randomBytes(k)));
});
function await_crypto() {
  return { randomBytes: (k) => globalThis.crypto.getRandomValues(new Uint8Array(k)) };
}

test("the D1 block can be read and rewritten without touching the rest of the config", () => {
  assert.equal(readD1Id(CONFIG), UUID_A);
  const patched = patchD1Block(CONFIG, UUID_B);
  assert.equal(readD1Id(patched), UUID_B);
  assert.ok(patched.includes('"name": "excel-ai-helper"') && patched.includes('"html_handling": "none"') && patched.includes("// END D1"));
  assert.equal(patchD1Block(patched, UUID_A), CONFIG, "round trip is exact");
  for (const nl of ["\n", "\r\n"]) {
    const cfg = CONFIG.replace(/\r?\n/g, nl);
    assert.equal(patchD1Block(patchD1Block(cfg, UUID_B), UUID_A), cfg, "round trip keeps " + JSON.stringify(nl) + " line endings");
  }
  assert.throws(() => patchD1Block("{}", UUID_B), /markers/);
});

test("parsers read wrangler output defensively", () => {
  assert.equal(parseWorkersUrl("Deployed excel-ai-helper\n  https://excel-ai-helper.example.workers.dev\nCurrent Version ID: abc"), "https://excel-ai-helper.example.workers.dev");
  assert.equal(parseWorkersUrl("no url here"), null);
  assert.equal(parseDbId(`{ "binding": "DB", "database_id": "${UUID_B}" }`), UUID_B);
  assert.equal(parseDbId(`database_id = "${UUID_B}"`), UUID_B);
  assert.equal(findDatabase(JSON.stringify([{ uuid: UUID_B, name: DB_NAME }, { uuid: "x", name: "other" }])), UUID_B);
  assert.equal(findDatabase("not json"), null);
  assert.deepEqual([...secretNames(JSON.stringify([{ name: "A", type: "secret_text" }, { name: "B" }]))], ["A", "B"]);
  assert.equal(isLoggedOut("You are not authenticated", 0), true);
  assert.equal(isLoggedOut("anything", 1), true);
  assert.equal(isLoggedOut("Logged in as someone", 0), false);
});

// ---------- the orchestrator against a fake Cloudflare ----------

function harness({ loggedIn = true, dbs = [], secrets = [], deployUrl = "https://excel-ai-helper.example.workers.dev", keyInput = GEMINI, smokeFails = 0 } = {}) {
  const state = { loggedIn, dbs: [...dbs], secrets: new Set(secrets), config: CONFIG, calls: [], logs: [], asks: 0, puts: {}, smokes: 0 };
  const deps = {
    log: (m) => state.logs.push(m),
    readConfig: () => state.config,
    writeConfig: (t) => (state.config = t),
    newCode: () => "ABCD-EFGH-JKLM-NPQR-STUV",
    sleep: async () => {},
    ask: async () => (state.asks++, keyInput),
    smoke: async () => (state.smokes++ <= smokeFails - 1 ? { code: 1, out: "FAIL x" } : { code: 0, out: "All checks passed" }),
    exec: async (args, opts = {}) => {
      state.calls.push({ args, input: opts.input });
      const k = args.join(" ");
      if (k === "whoami") return state.loggedIn ? { code: 0, out: "Logged in as test" } : { code: 1, out: "You are not authenticated" };
      if (k === "login") return (state.loggedIn = true), { code: 0, out: "" };
      if (k === "d1 list --json") return { code: 0, out: JSON.stringify(state.dbs) };
      if (k === `d1 create ${DB_NAME}`) return state.dbs.push({ uuid: UUID_B, name: DB_NAME }), { code: 0, out: `"database_id": "${UUID_B}"` };
      if (k === "deploy") return { code: 0, out: `Uploaded\n  ${deployUrl}\n` };
      if (k === "secret list --format json") return { code: 0, out: JSON.stringify([...state.secrets].map((name) => ({ name }))) };
      if (args[0] === "secret" && args[1] === "put") return state.secrets.add(args[2]), (state.puts[args[2]] = opts.input), { code: 0, out: "ok" };
      return { code: 1, out: "unexpected " + k };
    },
  };
  return { state, deps };
}

test("first run on a fresh account: logs in, links an existing database, deploys, sets both secrets, checks the service", async () => {
  const { state, deps } = harness({ loggedIn: false, dbs: [{ uuid: UUID_A, name: DB_NAME }] });
  const result = await runSetup(deps);
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://excel-ai-helper.example.workers.dev");
  assert.ok(state.calls.some((c) => c.args[0] === "login"));
  assert.equal(readD1Id(state.config), UUID_A);
  assert.equal(state.puts.GEMINI_API_KEY, GEMINI + "\n");
  assert.equal(state.puts.APP_PASSWORD, "ABCD-EFGH-JKLM-NPQR-STUV\n");
  const order = state.calls.map((c) => c.args[0] + (c.args[1] ? " " + c.args[1] : ""));
  assert.ok(order.indexOf("deploy") < order.indexOf("secret put"), "deploy first so secrets attach to a real Worker");
  assert.ok(state.logs.join("\n").includes("ABCD-EFGH-JKLM-NPQR-STUV"), "access code is shown once on screen");
});

test("a different account gets its own database created and linked", async () => {
  const { state, deps } = harness({ dbs: [] });
  await runSetup(deps);
  assert.ok(state.calls.some((c) => c.args.join(" ") === `d1 create ${DB_NAME}`));
  assert.equal(readD1Id(state.config), UUID_B);
});

test("secrets never appear on a command line or in the log, except the access code that is shown once", async () => {
  const { state, deps } = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }] });
  await runSetup(deps);
  const argvText = state.calls.map((c) => c.args.join(" ")).join("\n");
  assert.ok(!argvText.includes(GEMINI) && !argvText.includes("ABCD-EFGH"), "secrets only travel over stdin");
  assert.ok(!state.logs.join("\n").includes(GEMINI), "the Gemini key is never printed");
  assert.ok(!state.config.includes(GEMINI) && !state.config.includes("ABCD-EFGH"), "and never written to the config");
});

test("running again changes nothing: no prompts, no new code, secrets kept", async () => {
  const { state, deps } = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], secrets: ["GEMINI_API_KEY", "APP_PASSWORD"] });
  const before = state.config;
  const result = await runSetup(deps);
  assert.equal(result.accessCode, null);
  assert.equal(state.asks, 0);
  assert.deepEqual(state.puts, {});
  assert.equal(state.config, before, "config untouched when already linked");
});

test("--rotate-code issues a new code only, and --reset-key asks for the key only", async () => {
  const a = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], secrets: ["GEMINI_API_KEY", "APP_PASSWORD"] });
  await runSetup(a.deps, { rotateCode: true });
  assert.equal(a.state.puts.APP_PASSWORD, "ABCD-EFGH-JKLM-NPQR-STUV\n");
  assert.equal(a.state.puts.GEMINI_API_KEY, undefined);
  const b = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], secrets: ["GEMINI_API_KEY", "APP_PASSWORD"] });
  await runSetup(b.deps, { resetKey: true });
  assert.equal(b.state.puts.GEMINI_API_KEY, GEMINI + "\n");
  assert.equal(b.state.puts.APP_PASSWORD, undefined);
});

test("a bad key is rejected before anything is saved, and a failed deploy stops early with the reason", async () => {
  const bad = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], keyInput: "short" });
  await assert.rejects(runSetup(bad.deps), /does not look like an API key/);
  assert.deepEqual(bad.state.puts, {});
  const { deps } = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }] });
  const real = deps.exec;
  deps.exec = async (args, o) => (args[0] === "deploy" ? { code: 1, out: "Authentication error [code: 10000]" } : real(args, o));
  await assert.rejects(runSetup(deps), /Deploy failed:[\s\S]*Authentication error/);
});

test("the live check is retried while the new Worker warms up, and a persistent failure is reported not hidden", async () => {
  const ok = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], smokeFails: 2 });
  assert.equal((await runSetup(ok.deps)).ok, true);
  assert.equal(ok.state.smokes, 3);
  const bad = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], smokeFails: 99 });
  const r = await runSetup(bad.deps);
  assert.equal(r.ok, false);
  assert.match(bad.state.logs.join("\n"), /Some checks failed/);
});

test("the launchers exist and point at the script", () => {
  const cmd = readFileSync(new URL("../../../setup.cmd", import.meta.url), "utf8");
  assert.match(cmd, /node product\\backend\\scripts\\setup\.mjs/);
  assert.match(cmd, /winget install -e --id OpenJS\.NodeJS\.LTS/);
  assert.match(readFileSync(new URL("../../../setup.sh", import.meta.url), "utf8"), /product\/backend\/scripts\/setup\.mjs/);
});

test("unattended mode: an access code supplied by the environment is used but never printed, and a short one is refused", async () => {
  const env = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }] });
  env.deps.newCode = () => "my-own-long-code-123";
  env.deps.codeFromEnv = true;
  await runSetup(env.deps);
  assert.equal(env.state.puts.APP_PASSWORD, "my-own-long-code-123\n");
  assert.ok(!env.state.logs.join("\n").includes("my-own-long-code-123"), "not echoed to the log");
  const short = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }] });
  short.deps.newCode = () => "tooshort";
  await assert.rejects(runSetup(short.deps), /at least 12 characters/);
  assert.equal(short.state.puts.APP_PASSWORD, undefined, "the short code is never saved");
});

test("an Anthropic key is saved as ANTHROPIC_API_KEY, any other key as GEMINI_API_KEY", async () => {
  const AK = "sk-ant-api03-test-key-000000000000";
  const a = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], keyInput: AK });
  await runSetup(a.deps);
  assert.equal(a.state.puts.ANTHROPIC_API_KEY, AK + "\n");
  assert.equal(a.state.puts.GEMINI_API_KEY, undefined);
  assert.ok(!a.state.logs.join("\n").includes(AK));
  const b = harness({ dbs: [{ uuid: UUID_A, name: DB_NAME }], secrets: ["GEMINI_API_KEY", "APP_PASSWORD"] });
  await runSetup(b.deps, { resetKey: true });
  assert.equal(b.state.puts.GEMINI_API_KEY, GEMINI + "\n");
});
