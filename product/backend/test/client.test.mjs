import test from "node:test";
import assert from "node:assert/strict";

// functions.js and app.js attach to globalThis, as they do inside Excel's shared runtime.
await import("../../frontend/functions.js");
const AI = globalThis.AIHelper;
AI.base = "https://helper.test";
AI.retryDelaysMs = [];
AI.transientRetryDelaysMs = [];

// A minimal stand in for Office.js and Excel so app.js's real logic runs. This is NOT Excel.
const officeCalls = { associated: {}, shown: 0 };
globalThis.Office = {
  context: { requirements: { isSetSupported: () => true } },
  actions: { associate: (name, fn) => (officeCalls.associated[name] = fn) },
  addin: { showAsTaskpane: async () => void officeCalls.shown++ },
  onReady: () => {},
};
await import("../../frontend/app.js");

const unlocked = () => AI.setToken("tok", 3600);
const reset = () => {
  AI.lock();
  AI._cache.clear();
  AI.clearSaved();
};

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    return handler(url, init, calls);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// ---------- pure helpers ----------

test("escapeCell blocks formula injection but keeps real numbers", () => {
  const { escapeCell } = AI.util;
  assert.equal(escapeCell("=1+1"), "'=1+1");
  assert.equal(escapeCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCell("-abc"), "'-abc");
  assert.equal(escapeCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  for (const keep of ["-12.5", "+3", "1,234.50", "-7%", "hello", "-", ""]) assert.equal(escapeCell(keep), keep);
  assert.equal(escapeCell(null), "");
  assert.equal(escapeCell("x".repeat(40000)).length, 32000);
});

test("findPictureForCell picks the one picture anchored in the cell", () => {
  const { findPictureForCell } = AI.util;
  const cell = { top: 100, left: 50, width: 64, height: 20 };
  const pic = (id, left, top, type = "Image") => ({ id, type, left, top, name: id });
  assert.equal(findPictureForCell(cell, [pic("a", 51, 101), pic("b", 400, 400)]).id, "a");
  assert.equal(findPictureForCell(cell, [pic("a", 49, 99.5)]).id, "a", "small tolerance");
  assert.throws(() => findPictureForCell(cell, []), /no picture on this sheet/i);
  assert.throws(() => findPictureForCell(cell, [pic("b", 400, 400)]), /top left corner inside the selected cell/i);
  assert.throws(() => findPictureForCell(cell, [pic("a", 51, 101), pic("b", 60, 110)]), /More than one picture/);
  assert.throws(() => findPictureForCell(cell, [pic("t", 51, 101, "GeometricShape")]), /no picture on this sheet/i);
  // a cell that sits under one picture finds it; under two, it asks for a clearer choice
  const big = (id, left, top) => ({ id, type: "Image", left, top, width: 300, height: 200 });
  assert.equal(findPictureForCell(cell, [big("c", 20, 40)]).id, "c");
  assert.throws(() => findPictureForCell(cell, [big("c", 20, 40), big("d", 10, 30)]), /top left corner inside the selected cell/i);
});

test("planWrite counts any occupied cell, values or formulas", () => {
  const { planWrite } = AI.util;
  assert.deepEqual(planWrite([["", ""]], [["", ""]]), { ok: true, occupied: 0 });
  assert.equal(planWrite([["x", ""]], [["x", ""]]).occupied, 1);
  assert.equal(planWrite([[0]], [[0]]).ok, false, "zero is content");
  assert.equal(planWrite([[""]], [["=A1"]]).ok, false);
});

// ---------- custom functions ----------

test("functions are locked until unlocked and never call the network while locked", async () => {
  reset();
  await withFetch(
    () => reply({ answer: "x" }),
    async (calls) => {
      await assert.rejects(AI.functions.ask("Summarize", "hi"), (e) => e.kind === "notAvailable" && e.message === AI.NEEDS_KEY);
      assert.equal(calls.length, 0);
    },
  );
});

test("ask sends the token, caches identical inputs and refreshes when inputs change", async () => {
  reset();
  unlocked();
  await withFetch(
    (u, i, calls) => reply({ answer: "answer " + calls.length }),
    async (calls) => {
      assert.equal(await AI.functions.ask("Summarize", "alpha"), "answer 1");
      assert.equal(await AI.functions.ask("Summarize", "alpha"), "answer 1");
      assert.equal(calls.length, 1, "same inputs reuse the answer");
      assert.equal(await AI.functions.ask("Summarize", "beta"), "answer 2");
      assert.equal(calls.length, 2, "changed input is a new call, never a stale answer");
      assert.equal(calls[0].url, "https://helper.test/api/ai");
      assert.equal(calls[0].init.headers.authorization, "Bearer tok");
      assert.deepEqual(calls[0].body, { mode: "ask", instruction: "Summarize", input: "alpha" });
    },
  );
});

test("a failed call is not cached and a 401 locks the helper", async () => {
  reset();
  unlocked();
  await withFetch(
    (u, i, calls) => (calls.length === 1 ? reply({ error: "provider_busy", message: "busy" }, 429) : reply({ answer: "ok" })),
    async (calls) => {
      await assert.rejects(AI.functions.ask("Summarize", "x"), /busy/);
      assert.equal(await AI.functions.ask("Summarize", "x"), "ok");
      assert.equal(calls.length, 2, "retry after failure reaches the server again");
    },
  );
  await withFetch(
    () => reply({ error: "unauthorized", message: "Unlock Formulr with your access code" }, 401),
    async () => {
      await assert.rejects(AI.functions.ask("Summarize", "fresh"));
      assert.equal(AI.isUnlocked(), false);
    },
  );
});

test("ask validates its inputs", async () => {
  reset();
  unlocked();
  await assert.rejects(AI.functions.ask("  ", "x"), (e) => e.kind === "invalidValue");
});

test("no more than eight requests are ever in flight, and a filled down column really does run in parallel", async () => {
  reset();
  unlocked();
  let inFlight = 0;
  let peak = 0;
  await withFetch(
    async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return reply({ answer: "ok" });
    },
    async (calls) => {
      await Promise.all(Array.from({ length: 12 }, (_, i) => AI.functions.ask("Summarize", "row " + i)));
      assert.equal(calls.length, 12);
      assert.ok(peak <= 8, "peak concurrency was " + peak);
      assert.ok(peak >= 6, "the column should run in parallel, peak was " + peak);
    },
  );
});

test("unlock stores the token and surfaces server messages", async () => {
  reset();
  await withFetch(
    () => reply({ error: "bad_code", message: "That access code is not right" }, 401),
    async () => {
      await assert.rejects(AI.unlock("wrong"), /not right/);
      assert.equal(AI.isUnlocked(), false);
    },
  );
  await withFetch(
    () => reply({ token: "abc", expiresInSeconds: 7200 }),
    async (calls) => {
      assert.equal(await AI.unlock("right"), 7200);
      assert.equal(AI.isUnlocked(), true);
      assert.deepEqual(calls[0].body, { code: "right", remember: false });
    },
  );
});

// ---------- the Extract image command, against a fake workbook ----------

function fakeWorkbook({ cell, shapes, occupied = {} }) {
  const writes = [];
  const sheet = {
    shapes: { load() {}, items: shapes },
    getRangeByIndexes(r, c, rows, cols) {
      const blank = () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (occupied[`${r + i},${c + j}`] ? "taken" : "")));
      return {
        load() {},
        address: `R${r}C${c}:${rows}x${cols}`,
        values: blank(),
        formulas: blank(),
        set _unused(v) {},
      };
    },
  };
  // Writing to .values on a target range is recorded instead of stored.
  const original = sheet.getRangeByIndexes;
  sheet.getRangeByIndexes = (...args) => {
    const range = original(...args);
    let current = range.values;
    Object.defineProperty(range, "values", {
      get: () => current,
      set: (v) => {
        writes.push({ at: [args[0], args[1]], values: v });
        current = v;
      },
    });
    return range;
  };
  globalThis.Excel = {
    PictureFormat: { png: "PNG" },
    run: async (fn) =>
      fn({
        workbook: { worksheets: { getActiveWorksheet: () => sheet }, getSelectedRange: () => ({ getCell: () => cell }) },
        sync: async () => {},
      }),
  };
  return writes;
}

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString("base64");
const aCell = { load() {}, top: 100, left: 50, width: 64, height: 20, rowIndex: 4, columnIndex: 1 };
const aShape = { id: "p1", name: "Picture 1", type: "Image", top: 101, left: 51, getAsImage: () => ({ value: PNG_B64 }) };

test("Extract image writes an escaped grid to the cells right of the selection", async () => {
  reset();
  unlocked();
  const writes = fakeWorkbook({ cell: aCell, shapes: [aShape] });
  await withFetch(
    () => reply({ rows: [["Item", "Qty"], ["=HYPERLINK(\"x\")", "-3"]] }),
    async (calls) => {
      const summary = await AI.app.runExtractImage();
      assert.match(summary, /Wrote 2 rows by 2 columns/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.mode, "image");
      assert.equal(calls[0].body.image.data, PNG_B64);
      assert.deepEqual(writes, [{ at: [4, 2], values: [["Item", "Qty"], ["'=HYPERLINK(\"x\")", "-3"]] }]);
    },
  );
});

test("Extract image refuses to overwrite and spends nothing when the neighbor is occupied", async () => {
  reset();
  unlocked();
  const writes = fakeWorkbook({ cell: aCell, shapes: [aShape], occupied: { "4,2": true } });
  await withFetch(
    () => reply({ rows: [["x"]] }),
    async (calls) => {
      await assert.rejects(AI.app.runExtractImage(), /not empty.*Nothing was sent/s);
      assert.equal(calls.length, 0);
      assert.equal(writes.length, 0);
    },
  );
});

test("Extract image writes nothing if the result would land on content", async () => {
  reset();
  unlocked();
  const writes = fakeWorkbook({ cell: aCell, shapes: [aShape], occupied: { "5,3": true } });
  await withFetch(
    () => reply({ rows: [["a", "b"], ["c", "d"]] }),
    async () => {
      await assert.rejects(AI.app.runExtractImage(), /Nothing was written/);
      assert.equal(writes.length, 0);
    },
  );
});

test("Extract image reports a locked helper, a missing picture and server errors clearly", async () => {
  reset();
  fakeWorkbook({ cell: aCell, shapes: [aShape] });
  await assert.rejects(AI.app.runExtractImage(), /own AI key/i);
  unlocked();
  fakeWorkbook({ cell: aCell, shapes: [] });
  await assert.rejects(AI.app.runExtractImage(), /no picture on this sheet/i);
  fakeWorkbook({ cell: aCell, shapes: [aShape] });
  await withFetch(
    () => reply({ error: "nothing_found", message: "No text or table was found in the image" }, 422),
    async () => {
      await assert.rejects(AI.app.runExtractImage(), /No text or table was found/);
    },
  );
});

test("the ribbon handler is registered under the manifest's function name and always completes", async () => {
  reset();
  fakeWorkbook({ cell: aCell, shapes: [] });
  const handler = officeCalls.associated.extractImage;
  assert.equal(typeof handler, "function");
  let completed = 0;
  await handler({ completed: () => completed++ });
  assert.equal(completed, 1, "event.completed must run even on failure");
  assert.ok(officeCalls.shown >= 1, "pane opens so the error is visible");
});

// ---------- requirement sets and diagnostics ----------

async function withSupport(supports, fn) {
  const real = Office.context.requirements.isSetSupported;
  Office.context.requirements.isSetSupported = supports;
  try {
    return await fn();
  } finally {
    Office.context.requirements.isSetSupported = real;
  }
}

test("Extract image needs ExcelApi 1.10 (Range.top and left), not just 1.9, and spends nothing without it", async () => {
  reset();
  unlocked();
  fakeWorkbook({ cell: aCell, shapes: [aShape] });
  await withSupport(
    (name, version) => !(name === "ExcelApi" && version === "1.10"),
    () =>
      withFetch(
        () => reply({ rows: [["x"]] }),
        async (calls) => {
          await assert.rejects(AI.app.runExtractImage(), /1\.10/);
          assert.equal(calls.length, 0);
        },
      ),
  );
});

test("diagnostics list what Excel supports, run one model call on request and never leak the token", async () => {
  reset();
  AI.setToken("SECRET-TOKEN-123", 3600);
  await withSupport(
    (name, version) => !(name === "ExcelApi" && version === "1.10"),
    () =>
      withFetch(
        (url) => (String(url).endsWith("/health") ? reply({ status: "ok", configured: true, version: "0.1.0" }) : reply({ answer: "OK" })),
        async (calls) => {
          const report = await AI.app.runDiagnostics(true);
          assert.match(report, /PASS {2}ExcelApi 1\.9/);
          assert.match(report, /FAIL {2}ExcelApi 1\.10/);
          assert.match(report, /PASS {2}Service health and secrets configured/);
          assert.match(report, /PASS {2}Ready to answer/);
          assert.match(report, /PASS {2}Model test \(1 call, \d+\.\d s\)/);
          assert.equal(calls.filter((c) => c.url.endsWith("/api/ai")).length, 1, "exactly one model call");
          assert.ok(!report.includes("SECRET-TOKEN-123"));
        },
      ),
  );
});

test("diagnostics without the model test makes no model call, and a locked helper says so", async () => {
  reset();
  await withFetch(
    () => reply({ status: "ok", configured: false, version: "0.1.0" }),
    async (calls) => {
      const report = await AI.app.runDiagnostics(false);
      assert.match(report, /FAIL {2}Service health and secrets configured/);
      assert.match(report, /FAIL {2}No AI key saved and no owner sign in/);
      assert.equal(calls.filter((c) => c.url.endsWith("/api/ai")).length, 0);
      const locked = await AI.app.runDiagnostics(true);
      assert.match(locked, /FAIL {2}Model test.*skipped because no AI key is saved/);
    },
  );
});

// ---------- remember this device ----------

function fakeStorage({ failWrites = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error("quota");
      data.set(k, String(v));
    },
    removeItem: (k) => void data.delete(k),
  };
}

test("remembering stores only a pass, restores it on the next load, and lock forgets it", async () => {
  reset();
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    await withFetch(
      () => reply({ token: "device-pass", expiresInSeconds: 30 * 86400 }),
      async (calls) => {
        await AI.unlock("the-secret-code", true);
        assert.equal(calls[0].body.remember, true);
        assert.equal(AI.remembered, true);
        const saved = [...storage.data.values()].join("");
        assert.ok(saved.includes("device-pass"));
        assert.ok(!saved.includes("the-secret-code"), "the access code itself is never stored");
      },
    );
    // Simulate a fresh page load: memory is empty, storage still has the pass.
    AI.token = null;
    AI.expiresAt = 0;
    assert.equal(AI.isUnlocked(), false);
    AI.remembered = false;
    assert.equal(AI.restore(), true);
    assert.equal(AI.isUnlocked(), true);
    assert.equal(AI.remembered, true, "a restored pass is reported as remembered");
    AI.lock();
    assert.equal(storage.data.size, 0, "lock clears the stored pass");
    assert.equal(AI.restore(), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("not remembering stores nothing, and expired or damaged stored passes are ignored and removed", async () => {
  reset();
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    await withFetch(
      () => reply({ token: "short-lived", expiresInSeconds: 7200 }),
      async () => {
        await AI.unlock("code", false);
        assert.equal(storage.data.size, 0);
        assert.equal(AI.remembered, false);
      },
    );
    reset();
    const key = "excelAiHelper.token.v1";
    storage.setItem(key, JSON.stringify({ token: "old", expiresAt: Date.now() - 1000 }));
    assert.equal(AI.restore(), false);
    assert.equal(storage.data.has(key), false, "expired pass removed");
    storage.setItem(key, "{not json");
    assert.equal(AI.restore(), false);
    storage.setItem(key, JSON.stringify({ token: 42, expiresAt: Date.now() + 99999 }));
    assert.equal(AI.restore(), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("a server 401 on a remembered pass forgets it, and unusable storage never breaks unlocking", async () => {
  reset();
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    AI.setToken("pass", 3600, true);
    assert.equal(storage.data.size, 1);
    await withFetch(
      () => reply({ error: "unauthorized", message: "Unlock Formulr with your access code" }, 401),
      async () => {
        await assert.rejects(AI.functions.ask("Summarize", "x"));
      },
    );
    assert.equal(AI.isUnlocked(), false);
    assert.equal(storage.data.size, 0, "rejected pass is removed from the device");
    globalThis.localStorage = fakeStorage({ failWrites: true });
    AI.setToken("pass2", 3600, true);
    assert.equal(AI.isUnlocked(), true, "still unlocked for this session");
    assert.equal(AI.remembered, false, "but honestly reported as not remembered");
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- the formula ----------

test("FORMULR.ANSWER returns the answer and caches by input", async () => {
  reset();
  unlocked();
  await withFetch(
    () => reply({ answer: "Paris", explanation: "It is the capital of France." }),
    async (calls) => {
      assert.equal(await AI.functions.one("Capital of France?"), "Paris");
      await AI.functions.one("Capital of France?");
      assert.equal(calls.length, 1);
      await AI.functions.one("Capital of France?", "in Spanish");
      assert.equal(calls.length, 2, "a different instruction is a different question");
      assert.deepEqual(calls[1].body, { mode: "answer", input: "Capital of France?", instruction: "in Spanish" });
      await assert.rejects(AI.functions.one("   "), (e) => e.kind === "invalidValue");
    },
  );
});

test("Ask about picture writes only the answer into the one cell to the right, escaped", async () => {
  reset();
  unlocked();
  const writes = fakeWorkbook({ cell: aCell, shapes: [aShape] });
  await withFetch(
    () => reply({ answer: "=1+1", explanation: "It adds two." }),
    async (calls) => {
      const summary = await AI.app.runAskPicture();
      assert.match(summary, /Answered 1 picture/);
      assert.equal(calls[0].body.mode, "image_answer");
      assert.deepEqual(writes, [{ at: [4, 2], values: [["'=1+1"]] }]);
    },
  );
});

test("Ask about picture needs the cell free and spends nothing otherwise", async () => {
  reset();
  unlocked();
  const writes = fakeWorkbook({ cell: aCell, shapes: [aShape], occupied: { "4,2": true } });
  await withFetch(
    () => reply({ answer: "x", explanation: "y" }),
    async (calls) => {
      await assert.rejects(AI.app.runAskPicture(), /not empty.*Nothing was sent/s);
      assert.equal(calls.length, 0);
      assert.equal(writes.length, 0);
    },
  );
});

test("both ribbon handlers are registered and always complete", async () => {
  reset();
  fakeWorkbook({ cell: aCell, shapes: [] });
  for (const name of ["extractImage", "askPicture"]) {
    let completed = 0;
    await officeCalls.associated[name]({ completed: () => completed++ });
    assert.equal(completed, 1, name);
  }
});

// ---------- ranges, any length, any format ----------

test("toText keeps a pasted range's shape: tabs between cells, line breaks between rows", () => {
  const { toText } = AI.util;
  assert.equal(toText("plain"), "plain");
  assert.equal(toText([["only"]]), "only");
  assert.equal(toText([["a", 1], ["b", true]]), "a\t1\nb\tTRUE");
  assert.equal(toText([["a", ""], [null, "d"]]), "a\t\n\td");
  assert.equal(toText(undefined), "");
  assert.equal(toText(12.5), "12.5");
});

test("cell text with line breaks, tabs, emoji and markup is sent unchanged", async () => {
  reset();
  unlocked();
  const odd = "Line1\r\nLine2\t<b>x</b> **y** 日本語 🙂 =SUM(A1) \"q\" 'z'\n";
  await withFetch(
    () => reply({ answer: "a", explanation: "e" }),
    async (calls) => {
      await AI.functions.one([[odd]]);
      assert.equal(calls[0].body.input, odd);
    },
  );
});

test("a whole range can be the input to ANSWER and ASK", async () => {
  reset();
  unlocked();
  await withFetch(
    () => reply({ answer: "a", explanation: "e" }),
    async (calls) => {
      const range = [["Item", "Qty"], ["Pen", 2]];
      await AI.functions.one(range);
      await AI.functions.ask("Total?", range);
      assert.deepEqual(calls.map((c) => c.body.input), ["Item\tQty\nPen\t2", "Item\tQty\nPen\t2"]);
    },
  );
});

test("a 300000 character cell works, is cached by fingerprint, and one changed character is a new question", async () => {
  reset();
  unlocked();
  const big = "word ".repeat(60000);
  await withFetch(
    () => reply({ answer: "a", explanation: "e" }),
    async (calls) => {
      await AI.functions.one(big);
      await AI.functions.one(big);
      assert.equal(calls.length, 1);
      await AI.functions.one(big.slice(0, -1) + "!");
      assert.equal(calls.length, 2, "a one character change is not served from the cache");
      for (const key of AI._cache.keys()) assert.ok(key.length < 200, "the cache never stores the full text");
    },
  );
});

test("cache keys separate inputs that only differ by where the parts split", () => {
  const { cacheKey } = AI.util;
  assert.notEqual(cacheKey(["ab", "c"]), cacheKey(["a", "bc"]));
  assert.notEqual(cacheKey(["x", ""]), cacheKey(["", "x"]));
  assert.notEqual(cacheKey(["a\tb"]), cacheKey(["a b"]));
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(cacheKey(["answer", "row " + i + " value", ""]));
  assert.equal(seen.size, 20000);
});

test("answers are escaped but not shortened below Excel's cell size", () => {
  const { escapeCell } = AI.util;
  assert.equal(escapeCell("x".repeat(31000)).length, 31000);
});

test("rich cells and booleans are read by what Excel shows, not as [object Object]", () => {
  const { toText } = AI.util;
  assert.equal(toText([[{ type: "Entity", text: "Apple Inc." }]]), "Apple Inc.");
  assert.equal(toText([[{ basicValue: 42 }]]), "42");
  assert.equal(toText([[false]]), "FALSE");
});

test("clipping never leaves half an emoji", () => {
  const { safeSlice } = AI.util;
  const s = "🙂".repeat(20000);
  const out = safeSlice(s, 32000 - 1);
  assert.equal(out.length % 2, 0);
  assert.ok(!/[\ud800-\udbff]$/.test(out));
  assert.equal(safeSlice("short", 32000), "short");
});

test("a busy service (429) is retried and then succeeds, so a filled column does not stay on errors", async () => {
  reset();
  unlocked();
  AI.retryDelaysMs = [1, 1, 1];
  try {
    await withFetch(
      (u, i, calls) => (calls.length < 3 ? reply({ error: "quota", message: "Usage limit reached." }, 429) : reply({ answer: "ok", explanation: "e" })),
      async (calls) => {
        assert.equal(await AI.functions.one("q"), "ok");
        assert.equal(calls.length, 3);
      },
    );
    await withFetch(
      () => reply({ error: "quota", message: "Usage limit reached." }, 429),
      async (calls) => {
        await assert.rejects(AI.functions.one("q2"), /Usage limit/);
        assert.equal(calls.length, 4, "gives up after the last retry");
      },
    );
  } finally {
    AI.retryDelaysMs = [];
  }
});

// ---------- never hang, never need a page reload ----------

test("a call that never answers times out, frees its slot, and the same formula works on the next try", async () => {
  reset();
  unlocked();
  AI.attemptTimeoutMs = 30;
  AI.transientRetryDelaysMs = [];
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (url, init) => {
    n++;
    if (n <= 4) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    return Promise.resolve(reply({ answer: "ok", explanation: "e" }));
  };
  try {
    for (let i = 0; i < 4; i++) await assert.rejects(AI.functions.one("hang " + i), /Could not reach Formulr/);
    assert.equal(await AI.functions.one("hang 0"), "ok", "the failure was not cached and no request slot leaked");
  } finally {
    globalThis.fetch = real;
    AI.attemptTimeoutMs = undefined;
  }
});

test("a dropped connection or a 502 is retried quietly before the cell shows an error", async () => {
  reset();
  unlocked();
  AI.transientRetryDelaysMs = [1, 1];
  try {
    let n = 0;
    const real = globalThis.fetch;
    globalThis.fetch = async () => {
      n++;
      if (n === 1) throw new TypeError("network");
      if (n === 2) return reply({ error: "provider_error", message: "x" }, 502);
      return reply({ answer: "ok", explanation: "e" });
    };
    try {
      assert.equal(await AI.functions.one("flaky"), "ok");
      assert.equal(n, 3);
    } finally {
      globalThis.fetch = real;
    }
  } finally {
    AI.transientRetryDelaysMs = [];
  }
});

// ---------- install helpers in the side bar ----------

test("the side bar offers the install file and a copy link button that really copies", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../../frontend/taskpane.html", import.meta.url), "utf8");
  assert.match(html, /<a class="button" id="dl-manifest" href="download"/);
  assert.match(html, /id="copy-link"/);
  const copied = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => copied.push(t) } }, configurable: true });
  try {
    assert.equal(await AI.app.copyText("https://x.test/install"), true);
    assert.deepEqual(copied, ["https://x.test/install"]);
    assert.equal(AI.app.installLink(), "https://formulr.dev/install");
    Object.defineProperty(globalThis, "location", { value: { origin: "https://my-copy.example.workers.dev" }, configurable: true });
    assert.equal(AI.app.installLink(), "https://my-copy.example.workers.dev/download");
    delete globalThis.location;
  } finally {
    delete globalThis.navigator;
  }
});

test("copying falls back to false when neither the clipboard nor the document is available", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, configurable: true });
  try {
    assert.equal(await AI.app.copyText("x"), false);
  } finally {
    delete globalThis.navigator;
  }
});

// ---------- Office.js loading ----------

test("the pane loads Office.js from Microsoft, with a second address if the first is blocked", async () => {
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const html = fs.readFileSync(new URL("../../frontend/taskpane.html", import.meta.url), "utf8");
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  assert.ok(head.indexOf("officeapis.public.onecdn.static.microsoft/1/office.js") < head.indexOf("office-fallback.js"), "fallback runs right after the first tag");
  assert.ok(html.indexOf("office-fallback.js") < html.indexOf('src="functions.js"'), "before any of our own scripts");
  const src = fs.readFileSync(new URL("../../frontend/office-fallback.js", import.meta.url), "utf8");
  const run = (win) => vm.runInNewContext(src, win);
  const written = [];
  const blocked = { document: { write: (t) => written.push(t) } };
  blocked.window = blocked;
  run(blocked);
  assert.equal(written.length, 1);
  assert.match(written[0], /appsforoffice\.microsoft\.com\/lib\/1\/hosted\/office\.js/);
  const fine = { Office: {}, document: { write: (t) => written.push(t) } };
  fine.window = fine;
  run(fine);
  assert.equal(written.length, 1, "nothing is added when Office.js already loaded");
});

test("Tidy view keeps questions to one line and Expand brings the full text back, without touching the cell contents", async () => {
  const calls = [];
  let rows = 3;
  const sel = {
    rowCount: 3,
    columnCount: 1,
    load() {},
    format: {
      set wrapText(v) { calls.push(["wrapText", v]); },
      set rowHeight(v) { calls.push(["rowHeight", v]); },
      autofitRows() { calls.push(["autofitRows"]); },
    },
    set values(v) { calls.push(["VALUES WRITTEN"]); },
  };
  globalThis.Excel = { run: async (fn) => fn({ workbook: { getSelectedRange: () => sel }, sync: async () => {} }) };
  assert.match(await AI.app.runCompact(true), /Tidied 3 rows\. Press Expand/);
  assert.deepEqual(calls, [["wrapText", false], ["rowHeight", 15]]);
  calls.length = 0;
  assert.match(await AI.app.runCompact(false), /Expanded 3 rows\./);
  assert.deepEqual(calls, [["wrapText", true], ["autofitRows"]]);
  sel.rowCount = 60000;
  await assert.rejects(AI.app.runCompact(true), /Select fewer cells/);
  assert.ok(!calls.some((c) => c[0] === "VALUES WRITTEN"));
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../../frontend/taskpane.html", import.meta.url), "utf8");
  assert.match(html, /FORMULR\.ANSWER\(B2\)/);
});

// ---------- paste a block, point a formula at it ----------

test("a question pasted as many rows works as a range, and blank rows around it are ignored", async () => {
  const { toText } = AI.util;
  const pasted = [["Round to two decimal places."], [""], ["A. 4.86%"], ["B. 5.00%"], ["C. 4.93%"], ["D. 4.80%"], [""], ["Your challenge"], [null], [null], [null]];
  assert.equal(toText(pasted), "Round to two decimal places.\n\nA. 4.86%\nB. 5.00%\nC. 4.93%\nD. 4.80%\n\nYour challenge", "inner blank lines kept, outer blank rows dropped");
  assert.equal(toText([[""], [""], ["only line"], [""]]), "only line");
  assert.equal(toText([["a", "b"], ["", ""], ["c", ""]]), "a\tb\n\t\nc\t", "table shape is kept");
  assert.equal(toText([[""], [""]]), "", "an empty block is still empty, so the formula asks for text");
  reset();
  unlocked();
  await withFetch(
    () => reply({ answer: "x" }),
    async (calls) => {
      await AI.functions.one(pasted);
      await AI.functions.one(pasted.slice(0, 8));
      assert.equal(calls.length, 1, "the same question with more or fewer blank rows below it is the same question");
    },
  );
});

// ---------- speed ----------

test("the speed test fires different questions at once and reports the total, fastest, slowest and average", async () => {
  reset();
  await assert.rejects(AI.app.runSpeedTest(3), /own AI key/i);
  unlocked();
  let n = 0;
  await withFetch(
    async () => {
      const mine = ++n;
      await new Promise((r) => setTimeout(r, mine * 20));
      return reply({ answer: "5" });
    },
    async (calls) => {
      const report = await AI.app.runSpeedTest(4);
      assert.equal(calls.length, 5, "four different questions and one multiple choice, none served from the cache");
      assert.equal(new Set(calls.map((c) => c.body.input)).size, 5);
      assert.match(report, /^Speed test: 4 questions at once finished in \d+\.\d s\. Fastest \d+\.\d s, slowest \d+\.\d s, average \d+\.\d s\. Multiple choice calculation alone: \d+\.\d s\.$/);
    },
  );
});

test("the add-in asks Excel to load with the workbook, once, and copes with Excel versions that cannot", async () => {
  let calls = 0;
  const savedOffice = globalThis.Office;
  globalThis.Office = { addin: { setStartupBehavior: async (v) => { calls++; assert.equal(v, "load"); } }, StartupBehavior: { load: "load" } };
  assert.equal(await AI.app.keepLoaded(), true);
  assert.equal(await AI.app.keepLoaded(), false, "only once");
  assert.equal(calls, 1);
  globalThis.Office = savedOffice;
});

// ---------- saved answers ----------

function fakeSavedStorage() {
  const m = new Map();
  const store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), _m: m };
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true, writable: true });
  return store;
}

test("a finished answer is reused after the in memory cache is gone, without calling the API", async () => {
  fakeSavedStorage();
  reset();
  unlocked();
  let n = 0;
  await withFetch(
    () => (n++, reply({ answer: "B. 4.10%", explanation: "ok" })),
    async () => {
      const first = await AI.functions.one([["q"]], "");
      AI._cache.clear();
      AI._saved.reload();
      const second = await AI.functions.one([["q"]], "");
      assert.deepEqual(second, first);
    }
  );
  assert.equal(n, 1);
});

test("errors are never saved and old or other version entries are ignored", async () => {
  const store = fakeSavedStorage();
  reset();
  unlocked();
  await withFetch(
    () => reply({ error: "nope" }, 400),
    async () => {
      await AI.functions.one([["bad"]], "");
    }
  ).catch(() => {});
  assert.ok(!store.getItem(AI._saved.key) || !Object.keys(JSON.parse(store.getItem(AI._saved.key))).length);
  const key = AI.util.cacheKey(["answer", "old", ""]);
  store._m.set(AI._saved.key, JSON.stringify({ [key]: { t: Date.now() - AI._saved.ttl - 1000, v: "stale" } }));
  AI._saved.reload();
  AI._cache.clear();
  let n = 0;
  await withFetch(
    () => (n++, reply({ answer: "fresh", explanation: "e" })),
    async () => {
      const out = await AI.functions.one([["old"]], "");
      assert.equal(out, "fresh");
    }
  );
  assert.equal(n, 1);
});

test("saved answers are pruned and storage failures do not break answers", async () => {
  const store = fakeSavedStorage();
  reset();
  unlocked();
  store.setItem = () => {
    throw new Error("quota");
  };
  await withFetch(
    () => reply({ answer: "ok", explanation: "e" }),
    async () => {
      const out = await AI.functions.one([["q2"]], "");
      assert.equal(out, "ok");
    }
  );
  fakeSavedStorage();
});

// ---------- picture placement ----------

AI.app.clickWaitMs = 0; // the tests that need the wait turn it on themselves


function gridWorkbook({ active, activeFn, shapes = [], selected, occupied = {} }) {
  const writes = [];
  const sheet = {
    shapes: { load() {}, items: shapes },
    getCell: (r, c) => ({ load() {}, top: r * 20, left: c * 64 }),
    getRangeByIndexes(r, c, rows, cols) {
      const blank = () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (occupied[`${r + i},${c + j}`] ? "taken" : "")));
      let current = blank();
      return {
        load() {},
        address: `R${r}C${c}`,
        formulas: blank(),
        get values() { return current; },
        set values(v) { writes.push({ at: [r, c], values: v }); current = v; },
      };
    },
  };
  globalThis.Excel = {
    PictureFormat: { png: "PNG" },
    run: async (fn) =>
      fn({
        workbook: {
          worksheets: { getActiveWorksheet: () => sheet },
          getSelectedRange: () => ({ getCell: () => selected }),
          getActiveShapeOrNullObject: () => (activeFn ? activeFn() : active) ?? { isNullObject: true, load() {} },
        },
        sync: async () => {},
      }),
  };
  return writes;
}

const bigPic = { id: "p", name: "p", type: "Image", load() {}, isNullObject: false, left: 64 + 1, top: 40 + 1, width: 200, height: 100, getAsImage: () => ({ value: PNG_B64 }) };

test("with the picture clicked, the answer lands in the first cell past its right edge, on its top row", async () => {
  reset();
  unlocked();
  const writes = gridWorkbook({ active: bigPic });
  await withFetch(
    () => reply({ answer: "C", explanation: "Because." }),
    async () => {
      await AI.app.runAskPicture();
    },
  );
  // picture spans x 65..265, columns are 64 wide: column 4 starts at 256, so the first column fully past the edge is 5... the column holding the right edge is 4, answer in 5
  assert.deepEqual(writes, [{ at: [2, 5], values: [["C"]] }]);
});

test("with only a cell under a wide picture selected, the answer still goes past the picture, not under it", async () => {
  reset();
  unlocked();
  const shape = { id: "p", name: "p", type: "Image", left: 65, top: 41, width: 200, height: 100, getAsImage: () => ({ value: PNG_B64 }) };
  const writes = gridWorkbook({ selected: { load() {}, top: 40, left: 64, width: 64, height: 20, rowIndex: 2, columnIndex: 1 }, shapes: [shape] });
  await withFetch(
    () => reply({ answer: "7", explanation: "x" }),
    async () => {
      await AI.app.runAskPicture();
    },
  );
  assert.deepEqual(writes, [{ at: [2, 5], values: [["7"]] }]);
});

test("a picture too large is shrunk when the browser can, and sent unchanged when it cannot", async () => {
  const small = "AAAA";
  assert.equal(await AI.app.shrinkImage(small), small);
  const huge = "A".repeat(5 * 1024 * 1024);
  assert.equal(await AI.app.shrinkImage(huge), huge, "no canvas here, so unchanged");
});

test("a picture placed inside a cell is explained, since Excel cannot give add-ins its pixels", async () => {
  reset();
  unlocked();
  gridWorkbook({ selected: { load() {}, top: 40, left: 64, width: 64, height: 20, rowIndex: 2, columnIndex: 1, valuesAsJson: [[{ type: "LocalImage" }]] }, shapes: [] });
  await assert.rejects(AI.app.runAskPicture(), /inside a cell.*Place over Cells/s);
});

test("with two pictures and none clicked, nothing is answered and nothing is sent", async () => {
  reset();
  unlocked();
  const pic = (id, left, top) => ({ id, name: id, type: "Image", left, top, width: 120, height: 60, getAsImage: () => ({ value: PNG_B64 }) });
  const writes = gridWorkbook({ selected: { load() {}, top: 4000, left: 4000, width: 64, height: 20, rowIndex: 200, columnIndex: 60 }, shapes: [pic("a", 65, 41), pic("b", 65, 241)] });
  await withFetch(
    () => reply({ answer: "B", explanation: "Because." }),
    async (calls) => {
      await assert.rejects(AI.app.runAskPicture(), /No picture was clicked.*Press Answer picture, then click the picture/s);
      assert.equal(calls.length, 0);
    },
  );
  assert.equal(writes.length, 0);
});

test("a failed picture shows its message in the cell, and pressing again retries only that one", async () => {
  reset();
  unlocked();
  const shape = { id: "p", name: "p", type: "Image", left: 65, top: 41, width: 64, height: 20, getAsImage: () => ({ value: PNG_B64 }) };
  const writes = gridWorkbook({ selected: { load() {}, top: 4000, left: 4000, width: 64, height: 20, rowIndex: 200, columnIndex: 60 }, shapes: [shape] });
  await withFetch(
    () => reply({ error: "provider_busy", message: "The AI provider is busy." }, 429),
    async () => {
      const summary = await AI.app.runAskPicture();
      assert.match(summary, /1 failed/);
    },
  );
  assert.match(writes[0].values[0][0], /^Formulr: /);
  // the failure text counts as free, so a second press tries again
  const writes2 = gridWorkbook({ selected: { load() {}, top: 4000, left: 4000, width: 64, height: 20, rowIndex: 200, columnIndex: 60 }, shapes: [shape], occupied: { "2,2": true } });
  await withFetch(() => reply({ answer: "x", explanation: "y" }), async () => {
    await assert.rejects(AI.app.runAskPicture(), /not empty/);
  });
  assert.equal(writes2.length, 0);
});

// ---------- pasted and in-cell pictures ----------

test("a pasted picture is answered into the cell right of the selected cell, and a failure shows in that cell", async () => {
  reset();
  unlocked();
  const sel = { load() {}, rowIndex: 4, columnIndex: 1 };
  const writes = gridWorkbook({ selected: sel });
  const pasted = (type = "image/png") => ({
    preventDefault() {},
    clipboardData: { items: [{ kind: "file", type, getAsFile: () => new Blob([Buffer.from(PNG_B64, "base64")], { type }) }] },
  });
  await withFetch(
    () => reply({ answer: "C", explanation: "Because." }),
    async (calls) => {
      await AI.app.onPasteImage(pasted());
      assert.equal(calls[0].body.mode, "image_answer");
      assert.equal(calls[0].body.image.data, PNG_B64);
    },
  );
  assert.deepEqual(writes, [{ at: [4, 2], values: [["C"]] }]);
  const writes2 = gridWorkbook({ selected: sel });
  await withFetch(() => reply({ error: "provider_busy", message: "The AI provider is busy." }, 429), async () => {
    await AI.app.onPasteImage(pasted());
  });
  assert.match(writes2[0].values[0][0], /^Formulr: /);
  const writes3 = gridWorkbook({ selected: sel, occupied: { "4,2": true } });
  await withFetch(() => reply({ answer: "x", explanation: "y" }), async (calls) => {
    await AI.app.onPasteImage(pasted());
    assert.equal(calls.length, 0, "nothing is sent when the cell is taken");
  });
  assert.equal(writes3.length, 0);
});

test("an in-cell picture whose data Excel hands over is answered; without data the message says to paste it in the pane", async () => {
  reset();
  unlocked();
  const cellWith = (v) => ({ load() {}, top: 40, left: 64, width: 64, height: 20, rowIndex: 2, columnIndex: 1, valuesAsJson: [[v]] });
  const writes = gridWorkbook({ selected: cellWith({ type: "LocalImage", image: { type: "PNG", data: PNG_B64 } }), shapes: [] });
  await withFetch(() => reply({ answer: "A", explanation: "x" }), async (calls) => {
    assert.match(await AI.app.runAskPicture(), /Answered in/);
    assert.equal(calls[0].body.image.data, PNG_B64);
  });
  assert.deepEqual(writes, [{ at: [2, 2], values: [["A"]] }]);
  gridWorkbook({ selected: cellWith({ type: "LocalImage", image: { cachedUid: "abc" } }), shapes: [] });
  await assert.rejects(AI.app.runAskPicture(), /paste it into the box in the Formulr pane/);
});

test("pressing the button first and clicking the picture afterwards works, and the wait ends if nothing is clicked", async () => {
  reset();
  unlocked();
  let polls = 0;
  const pic = { id: "p", name: "p", type: "Image", load() {}, isNullObject: false, left: 65, top: 41, width: 200, height: 100, getAsImage: () => ({ value: PNG_B64 }) };
  const far = { load() {}, top: 4000, left: 4000, width: 64, height: 20, rowIndex: 200, columnIndex: 60 };
  const writes = gridWorkbook({ selected: far, shapes: [pic], activeFn: () => (++polls >= 3 ? pic : null) });
  AI.app.clickWaitMs = 3000;
  try {
    await withFetch(() => reply({ answer: "D", explanation: "x" }), async (calls) => {
      assert.match(await AI.app.runAskPicture(), /Answered 1 picture/);
      assert.equal(calls.length, 1);
    });
    assert.ok(polls >= 3);
    assert.deepEqual(writes.map((w) => w.at), [[2, 5]]);
    // nothing ever clicked: after the wait, a clear message and nothing sent
    AI.app.clickWaitMs = 500;
    gridWorkbook({ selected: far, shapes: [pic], activeFn: () => null });
    await withFetch(() => reply({ answer: "E", explanation: "y" }), async (calls) => {
      await assert.rejects(AI.app.runAskPicture(), /No picture was clicked/);
      assert.equal(calls.length, 0);
    });
    // no pictures at all: no waiting, an immediate message
    gridWorkbook({ selected: far, shapes: [], activeFn: () => null });
    const t = Date.now();
    await assert.rejects(AI.app.runAskPicture(), /no picture on this sheet/i);
    assert.ok(Date.now() - t < 300);
  } finally {
    AI.app.clickWaitMs = 0;
  }
});

test("the formula puts only the answer in the cell, never the reasoning", async () => {
  reset();
  unlocked();
  await withFetch(() => reply({ answer: "C", explanation: "6.18 - 3.27 = 2.91%, so 291 bps." }), async () => {
    assert.equal(await AI.functions.one("Spread?\nA. 281\nB. 286\nC. 291\nD. 296"), "C");
  });
});
