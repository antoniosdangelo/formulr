// The add-in side of bring your own key: the key lives only in this device's storage,
// rides along on each answer request, and a missing key gives a clear message.
import test from "node:test";
import assert from "node:assert/strict";

await import("../../../frontend/public/functions.js");
const AI = globalThis.AIHelper;
AI.base = "https://helper.test";
AI.retryDelaysMs = [];
AI.transientRetryDelaysMs = [];

const USER_KEY = "sk-ant-USER" + "u".repeat(30);

function fakeStorage() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), removeItem: (k) => void data.delete(k) };
}

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: String(init?.body ?? "") });
    return handler(url, init);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

function fresh() {
  AI.lock();
  AI._cache.clear();
  AI.clearSaved();
  globalThis.localStorage = fakeStorage();
  AI.setToken("tok", 3600);
}

test("a saved key is sent in headers on each answer, never in the body or the URL", async () => {
  fresh();
  try {
    AI.setUserKey("anthropic", USER_KEY);
    await withFetch(
      () => reply({ answer: "4", explanation: "2 plus 2." }),
      async (calls) => {
        await AI.functions.one("What is 2 + 2?");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].headers["x-formulr-key"], USER_KEY);
        assert.equal(calls[0].headers["x-formulr-provider"], "anthropic");
        assert.ok(!calls[0].body.includes(USER_KEY));
        assert.ok(!calls[0].url.includes(USER_KEY));
      },
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("with no saved key no key headers are sent, and the server's needs_key reply becomes a clear cell message", async () => {
  fresh();
  try {
    await withFetch(
      () => reply({ error: "needs_key", message: "Add your own AI key" }, 403),
      async (calls) => {
        await assert.rejects(AI.functions.one("What is 2 + 2?"), (err) => err.message === AI.NEEDS_KEY);
        assert.equal(calls[0].headers["x-formulr-key"], undefined);
      },
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("bad keys and providers are refused before saving, and remove clears the key", () => {
  fresh();
  try {
    assert.throws(() => AI.setUserKey("anthropic", "short"));
    assert.throws(() => AI.setUserKey("openai", USER_KEY));
    assert.equal(AI.userKey(), null);
    AI.setUserKey("gemini", "  AIza" + "g".repeat(30) + "  ");
    assert.equal(AI.userKey().provider, "gemini");
    assert.equal(AI.userKey().key, "AIza" + "g".repeat(30), "spaces around a pasted key are trimmed");
    AI.clearUserKey();
    assert.equal(AI.userKey(), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test("locking forgets the pass but keeps the key, and the stored pass never holds the key", async () => {
  fresh();
  const storage = globalThis.localStorage;
  try {
    AI.setUserKey("anthropic", USER_KEY);
    await withFetch(
      () => reply({ token: "device-pass", expiresInSeconds: 3600, role: "guest" }),
      async () => {
        await AI.unlock("guest-code-1234", true);
      },
    );
    assert.equal(AI.role, "guest");
    const passEntry = [...storage.data.entries()].find(([, v]) => v.includes("device-pass"));
    assert.ok(passEntry && !passEntry[1].includes(USER_KEY));
    AI.lock();
    assert.equal(AI.userKey().key, USER_KEY);
  } finally {
    delete globalThis.localStorage;
  }
});

test("with a saved key and no sign in, answers go out with the key and no pass", async () => {
  fresh();
  AI.lock();
  try {
    AI.setUserKey("anthropic", USER_KEY);
    assert.equal(AI.canAsk(), true);
    await withFetch(
      () => reply({ answer: "4", explanation: "2 plus 2." }),
      async (calls) => {
        await AI.functions.one("What is 2 + 2?");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].headers.authorization, undefined);
        assert.equal(calls[0].headers["x-formulr-key"], USER_KEY);
      },
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("with no key and no sign in, nothing is sent and the message asks for a key", async () => {
  fresh();
  AI.lock();
  try {
    assert.equal(AI.canAsk(), false);
    await withFetch(
      () => reply({ answer: "x" }),
      async (calls) => {
        await assert.rejects(AI.functions.one("What is 2 + 2?"), (err) => err.message === AI.NEEDS_KEY);
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete globalThis.localStorage;
  }
});
