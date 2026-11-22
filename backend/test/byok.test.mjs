// Bring your own key: only the owner pass may spend the Worker's key, guests must send their own,
// and a user's key is never logged, stored or echoed back.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";
import { signToken } from "../src/core.js";

const ORIGIN = "https://helper.test";
const GUEST = "guest-code-1234";
const OWNER = "owner-code-for-tests-only";
const SERVER_AKEY = "sk-ant-SERVER" + "s".repeat(30);
const SERVER_GKEY = "AIzaSERVER" + "g".repeat(30);
const USER_AKEY = "sk-ant-USER" + "u".repeat(30);
const USER_GKEY = "AIzaUSER" + "v".repeat(30);

// A D1 look-alike on real SQLite that also records every value written to it.
function spyD1() {
  const db = new DatabaseSync(":memory:");
  const seen = [];
  return {
    seen,
    prepare(sql) {
      const st = db.prepare(sql);
      return {
        bind: (...args) => {
          seen.push(sql, ...args.map(String));
          return { first: async () => st.get(...args) ?? null, run: async () => (st.run(...args), { success: true }) };
        },
        run: async () => (seen.push(sql), st.run(), { success: true }),
      };
    },
  };
}

const envWith = (extra = {}) => ({
  APP_PASSWORD: GUEST,
  OWNER_CODE: OWNER,
  ANTHROPIC_API_KEY: SERVER_AKEY,
  GEMINI_API_KEY: SERVER_GKEY,
  QUOTAS_DB: spyD1(),
  ...extra,
});

let ip = 0;
function post(path, body, env, headers = {}) {
  return worker.fetch(
    new Request(ORIGIN + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++ip}`, ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
}

const bearer = async (secret) => ({ authorization: "Bearer " + (await signToken(secret)) });
const ask = (env, headers) => post("/api/ai", { mode: "answer", input: "What is 2 + 2?", instruction: "" }, env, headers);

const claudeOk = () =>
  new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ answer: "4", explanation: "2 plus 2." }) }] }), { status: 200 });
const geminiOk = () =>
  new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ answer: "4", explanation: "2 plus 2." }) }] } }] }), { status: 200 });

// Records every upstream call and everything written to the console during the test.
async function watch(handler, fn) {
  const realFetch = globalThis.fetch;
  const calls = [];
  const logged = [];
  const names = ["log", "info", "warn", "error", "debug"];
  const realConsole = Object.fromEntries(names.map((n) => [n, console[n]]));
  for (const n of names) console[n] = (...a) => logged.push(a.map(String).join(" "));
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: String(init?.body ?? "") });
    return handler(url, init);
  };
  try {
    return await fn(calls, logged);
  } finally {
    globalThis.fetch = realFetch;
    for (const n of names) console[n] = realConsole[n];
  }
}

const sentKeys = (calls) => calls.map((c) => c.headers["x-api-key"] ?? c.headers["x-goog-api-key"]);

// ---------- sign in ----------

test("the owner code signs in as owner, the guest code as guest", async () => {
  const env = envWith();
  const owner = await (await post("/api/session", { code: OWNER }, env)).json();
  const guest = await (await post("/api/session", { code: GUEST }, env)).json();
  assert.equal(owner.role, "owner");
  assert.equal(guest.role, "guest");
  assert.equal((await post("/api/session", { code: "wrong-code-123" }, env)).status, 401);
});

test("an owner code equal to the guest code, or too short, grants no owner pass", async () => {
  for (const OWNER_CODE of [GUEST, "short"]) {
    const env = envWith({ OWNER_CODE });
    const res = await (await post("/api/session", { code: GUEST }, env)).json();
    assert.equal(res.role, "guest");
    await watch(claudeOk, async (calls) => {
      assert.equal((await ask(env, await bearer(GUEST))).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

// ---------- no fallback to the Worker's key ----------

test("a guest with no key of their own is refused and no AI provider is called", async () => {
  const env = envWith();
  await watch(claudeOk, async (calls) => {
    const res = await ask(env, await bearer(GUEST));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "needs_key");
    assert.equal(calls.length, 0);
  });
});

test("a guest's own Anthropic key is the only key sent upstream", async () => {
  const env = envWith();
  await watch(claudeOk, async (calls) => {
    const res = await ask(env, { ...(await bearer(GUEST)), "x-formulr-provider": "anthropic", "x-formulr-key": USER_AKEY });
    assert.equal(res.status, 200);
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((c) => c.url.startsWith("https://api.anthropic.com/")));
    assert.deepEqual([...new Set(sentKeys(calls))], [USER_AKEY]);
  });
});

test("a guest's own Gemini key goes to Gemini even when the Worker prefers Anthropic", async () => {
  const env = envWith();
  await watch(geminiOk, async (calls) => {
    const res = await ask(env, { ...(await bearer(GUEST)), "x-formulr-provider": "gemini", "x-formulr-key": USER_GKEY });
    assert.equal(res.status, 200);
    assert.ok(calls.every((c) => c.url.startsWith("https://generativelanguage.googleapis.com/")));
    assert.deepEqual([...new Set(sentKeys(calls))], [USER_GKEY]);
  });
});

test("the careful retry reuses the guest's key, never the Worker's", async () => {
  const env = envWith();
  let n = 0;
  const contradicting = () =>
    ++n === 1
      ? new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ answer: "B", explanation: "Actually the answer is C." }) }] }), { status: 200 })
      : claudeOk();
  await watch(contradicting, async (calls) => {
    await ask(env, { ...(await bearer(GUEST)), "x-formulr-provider": "anthropic", "x-formulr-key": USER_AKEY });
    assert.ok(!sentKeys(calls).includes(SERVER_AKEY));
    assert.ok(!sentKeys(calls).includes(SERVER_GKEY));
  });
});

test("the owner pass uses the Worker's key, or the owner's own key when one is sent", async () => {
  const env = envWith();
  await watch(claudeOk, async (calls) => {
    assert.equal((await ask(env, await bearer(OWNER))).status, 200);
    assert.deepEqual([...new Set(sentKeys(calls))], [SERVER_AKEY]);
  });
  await watch(claudeOk, async (calls) => {
    assert.equal((await ask(env, { ...(await bearer(OWNER)), "x-formulr-key": USER_AKEY })).status, 200);
    assert.deepEqual([...new Set(sentKeys(calls))], [USER_AKEY]);
  });
});

test("a malformed key or unknown provider is refused before any call", async () => {
  const env = envWith();
  await watch(claudeOk, async (calls) => {
    const h = await bearer(GUEST);
    assert.equal((await ask(env, { ...h, "x-formulr-key": "too short" })).status, 400);
    assert.equal((await ask(env, { ...h, "x-formulr-provider": "openai", "x-formulr-key": USER_AKEY })).status, 400);
    assert.equal(calls.length, 0);
  });
});

test("guests count in their own usage bucket and cannot use up the owner's limit", async () => {
  const env = envWith({ AI_PER_MINUTE: "1" });
  await watch(claudeOk, async () => {
    const g = { ...(await bearer(GUEST)), "x-formulr-key": USER_AKEY };
    assert.equal((await ask(env, g)).status, 200);
    assert.equal((await ask(env, g)).status, 429);
    assert.equal((await ask(env, await bearer(OWNER))).status, 200);
  });
});

// ---------- the key is never kept or echoed ----------

test("a user's key never appears in logs, the database, responses or the request body sent upstream", async () => {
  const env = envWith();
  const h = { ...(await bearer(GUEST)), "x-formulr-provider": "anthropic", "x-formulr-key": USER_AKEY };
  const outputs = [];
  for (const handler of [claudeOk, () => new Response(JSON.stringify({ error: { message: "invalid x-api-key " + USER_AKEY } }), { status: 401 }), () => new Response("boom " + USER_AKEY, { status: 500 })]) {
    await watch(handler, async (calls, logged) => {
      const res = await ask(env, h);
      outputs.push(await res.text(), JSON.stringify([...res.headers]), ...logged, ...calls.map((c) => c.url + c.body));
    });
  }
  outputs.push(...env.QUOTAS_DB.seen);
  for (const text of outputs) assert.ok(!text.includes(USER_AKEY), "key leaked into: " + text.slice(0, 120));
});

test("health never reports a key and a guest-only Worker with no key of its own is still configured", async () => {
  const env = envWith({ ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: undefined });
  const health = await (await worker.fetch(new Request(ORIGIN + "/health"), env)).json();
  assert.equal(health.configured, true);
  assert.equal(health.provider, null);
  await watch(claudeOk, async (calls) => {
    assert.equal((await ask(env, await bearer(OWNER))).status, 403);
    assert.equal(calls.length, 0);
  });
});
