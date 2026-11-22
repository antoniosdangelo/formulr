import test from "node:test";
import assert from "node:assert/strict";

await import("../../frontend/public/functions.js");
const AI = globalThis.AIHelper;
AI.base = "https://helper.test";
AI.retryDelaysMs = [];
AI.transientRetryDelaysMs = [];
let supports = () => true;
globalThis.Office = {
  context: { requirements: { isSetSupported: (n, v) => supports(n, v) } },
  actions: { associate() {} },
  addin: { showAsTaskpane: async () => {} },
  onReady() {},
};
await import("../../frontend/public/app.js");
await import("../../frontend/public/selftest.js");

// ---------- a small in-memory Excel: grid, formulas that call the real AI.* functions, spills, pictures, sheets ----------

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function parseAddress(addr) {
  const m = addr.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  const r1 = Number(m[2]) - 1, c1 = colIndex(m[1]);
  const r2 = m[4] ? Number(m[4]) - 1 : r1, c2 = m[3] ? colIndex(m[3]) : c1;
  return { r: r1, c: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 };
}
function splitArgs(text) {
  const out = [];
  let cur = "", quote = false;
  for (const ch of text) {
    if (ch === '"') quote = !quote;
    if (ch === "," && !quote) (out.push(cur.trim()), (cur = ""));
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function createWorkbook({ unregistered = false, failAddImage = false, preexisting = false } = {}) {
  const sheets = new Map();
  const state = { active: null, selection: null, wrote: [] };
  const key = (r, c) => `${r},${c}`;

  function makeSheet(name) {
    const cells = new Map();
    const sheet = {
      name, cells, isNullObject: false, load() {},
      shapes: {
        items: [], load() {},
        addImage(b64) {
          if (failAddImage) throw new Error("addImage failed");
          const shape = { id: "pic" + (sheet.shapes.items.length + 1), name: "", type: "Image", top: 0, left: 0, getAsImage: () => ({ value: b64 }) };
          sheet.shapes.items.push(shape);
          return shape;
        },
      },
      activate() { state.active = sheet; },
      delete() { sheets.delete(name); if (state.active === sheet) state.active = [...sheets.values()].at(-1); },
      getRange(addr) { const a = parseAddress(addr); return range(sheet, a.r, a.c, a.rows, a.cols); },
      getRangeByIndexes: (r, c, rows, cols) => range(sheet, r, c, rows, cols),
    };
    return sheet;
  }

  const get = (sheet, r, c) => sheet.cells.get(key(r, c)) ?? { value: "" };
  const setValue = (sheet, r, c, value) => sheet.cells.set(key(r, c), { value });

  async function evaluate(sheet, r, c, formula) {
    const m = formula.match(/^=FORMULR\.(ANSWER)\((.*)\)$/);
    const resolve = (arg) => {
      if (arg.startsWith('"')) return arg.slice(1, -1);
      const a = parseAddress(arg);
      if (a.rows * a.cols === 1) return get(sheet, a.r, a.c).value;
      return Array.from({ length: a.rows }, (_, i) => Array.from({ length: a.cols }, (_, j) => get(sheet, a.r + i, a.c + j).value));
    };
    try {
      const out = await AI.functions.one(...splitArgs(m[2]).map(resolve));
      const rows = Array.isArray(out) ? out : [[out]];
      const blocked = rows.some((row, i) => row.some((_, j) => (i || j) && get(sheet, r + i, c + j).value !== ""));
      if (blocked) return void sheet.cells.set(key(r, c), { value: "#SPILL!", formula });
      rows.forEach((row, i) => row.forEach((v, j) => sheet.cells.set(key(r + i, c + j), { value: v, formula: i || j ? undefined : formula })));
    } catch (err) {
      sheet.cells.set(key(r, c), { value: "#VALUE!", formula, error: err.message });
    }
  }

  function range(sheet, r, c, rows, cols) {
    const grid = (pick) => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => pick(get(sheet, r + i, c + j))));
    return {
      load() {}, rowIndex: r, columnIndex: c, rowCount: rows, columnCount: cols,
      get top() { return r * 20; }, get left() { return c * 64; }, get width() { return cols * 64; }, get height() { return rows * 20; },
      get address() { return `${sheet.name}!R${r + 1}C${c + 1}`; },
      get values() { return grid((cell) => cell.value); },
      set values(m) { m.forEach((row, i) => row.forEach((v, j) => setValue(sheet, r + i, c + j, v))); state.wrote.push({ at: [r, c], values: m }); },
      get formulas() { return grid((cell) => cell.formula ?? cell.value); },
      set formulas(m) {
        m.forEach((row, i) => row.forEach((f, j) => {
          if (unregistered) return sheet.cells.set(key(r + i, c + j), { value: "#NAME?", formula: f });
          sheet.cells.set(key(r + i, c + j), { value: "#BUSY!", formula: f });
          evaluate(sheet, r + i, c + j, f);
        }));
      },
      getCell: (i, j) => range(sheet, r + i, c + j, 1, 1),
      select() { state.selection = { sheet, r, c, rows, cols }; },
      clear() { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) sheet.cells.delete(key(r + i, c + j)); },
    };
  }

  const first = makeSheet("Sheet1");
  sheets.set("Sheet1", first);
  sheets.set("Sheet2", makeSheet("Sheet2")); // deleting the active test sheet will land on this one unless the user's sheet is restored
  setValue(first, 0, 0, "my real data");
  state.active = first;
  if (preexisting) {
    const old = makeSheet("Formulr Self Test");
    setValue(old, 0, 0, "left over");
    sheets.set("Formulr Self Test", old);
  }
  state.sheets = sheets;

  globalThis.Excel = {
    PictureFormat: { png: "PNG" },
    run: async (fn) =>
      fn({
        sync: async () => {},
        workbook: {
          getSelectedRange: () => range(state.selection.sheet, state.selection.r, state.selection.c, state.selection.rows, state.selection.cols),
          worksheets: {
            getActiveWorksheet: () => state.active,
            getItem: (name) => sheets.get(name),
            getItemOrNullObject: (name) => sheets.get(name) ?? { isNullObject: true, load() {}, delete() {}, activate() {} },
            add: (name) => { if (sheets.has(name)) throw new Error("A worksheet with that name already exists"); const s = makeSheet(name); sheets.set(name, s); return s; },
          },
        },
      }),
  };
  return state;
}

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString("base64");
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const GOOD = {
  ask: () => reply({ answer: "Ada Lovelace" }),
  extract: () => reply({ values: ["Ada Lovelace", "$42", "2026-10-26"] }),
  answer: (b) => reply({ answer: /40 \+ 2/.test(b.input) ? "42" : "Ada Lovelace", explanation: "Short reason." }),
  image: () => reply({ rows: [["Item", "Qty"], ["Pen", "2"], ["Cup", "5"]] }),
  image_answer: () => reply({ answer: "5", explanation: "There are five cups." }),
};

async function session(handlers, fn) {
  AI.lock();
  AI._cache.clear();
  AI.setToken("tok", 3600);
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.mode);
    const h = handlers[body.mode];
    return h ? h(body) : reply({ error: "x", message: "no handler for " + body.mode }, 500);
  };
  supports = () => true;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const runTest = () => AI.selfTest.run({ makePng: () => PNG_B64, pollMs: 1, timeoutMs: 400 });
const summary = (results) => results.map((r) => (r.ok ? "PASS " : "FAIL ") + r.label).join("\n");

// ---------- tests ----------

test("happy path: every step passes, five AI calls, and the workbook is left exactly as it was", async () => {
  const wb = createWorkbook();
  await session(GOOD, async (calls) => {
    const results = await runTest();
    assert.ok(results.every((r) => r.ok), summary(results));
    assert.equal(results.length, 8);
    assert.deepEqual([...calls].sort(), ["answer", "answer", "answer", "image", "image_answer"]);
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"], "temporary sheet deleted");
    assert.equal(wb.active.name, "Sheet1", "your sheet is active again");
    assert.equal(wb.sheets.get("Sheet1").cells.get("0,0").value, "my real data", "your data untouched");
    assert.match(AI.selfTest.format(results), /All steps passed/);
  });
});

test("a leftover test sheet from a crashed run is replaced, and other sheets are never touched", async () => {
  const wb = createWorkbook({ preexisting: true });
  await session(GOOD, async () => {
    const results = await runTest();
    assert.ok(results.every((r) => r.ok), summary(results));
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
  });
});

test("locked or too old: reports why and creates nothing", async () => {
  const wb = createWorkbook();
  await session(GOOD, async (calls) => {
    AI.lock();
    let results = await runTest();
    assert.equal(results.length, 1);
    assert.match(results[0].detail, /locked/i);
    AI.setToken("tok", 3600);
    supports = (n, v) => !(n === "ExcelApi" && v === "1.10");
    results = await runTest();
    assert.equal(results.length, 1);
    assert.match(results[0].detail, /1\.10/);
    assert.equal(calls.length, 0);
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
  });
});

test("if Excel has not registered the functions, the report says so in plain words and still cleans up", async () => {
  const wb = createWorkbook({ unregistered: true });
  await session(GOOD, async () => {
    const results = await runTest();
    const failed = results.filter((r) => !r.ok).map((r) => r.label);
    assert.deepEqual(failed, ["=FORMULR.ANSWER with an instruction", "=FORMULR.ANSWER gives one short answer"]);
    assert.match(results.find((r) => !r.ok).detail, /does not know the AI functions/);
    assert.ok(results.find((r) => r.label === "Extract image writes the table").ok, "picture steps are independent");
    assert.ok(results.find((r) => r.label.startsWith("Answer selected cells")).ok, "the no-formula path works even when formulas are not registered");
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
  });
});

test("a wrong answer is a FAIL with what was actually returned", async () => {
  createWorkbook();
  await session({ ...GOOD, answer: (b) => reply({ answer: /40 \+ 2/.test(b.input) ? "42" : "Grace Hopper", explanation: "x" }) }, async () => {
    const results = await runTest();
    const ask = results.find((r) => r.label.startsWith("=FORMULR.ANSWER with"));
    assert.equal(ask.ok, false);
    assert.equal(results.filter((r) => !r.ok).length, 1, "only that step fails");
    assert.match(AI.selfTest.format(results), /1 step\(s\) failed/);
  });
});

test("a server error in the picture step is reported with its message and later steps still run", async () => {
  const wb = createWorkbook();
  await session({ ...GOOD, image: () => reply({ error: "nothing_found", message: "No text or table was found in the image" }, 422) }, async () => {
    const results = await runTest();
    const extract = results.find((r) => r.label === "Extract image writes the table");
    assert.equal(extract.ok, false);
    assert.match(extract.detail, /No text or table was found/);
    assert.ok(results.find((r) => r.label.startsWith("Ask about picture")).ok);
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
  });
});

test("slow formulas time out with a clear message, and the sheet is still removed", async () => {
  const wb = createWorkbook();
  const slow = (v) => async () => (await new Promise((r) => setTimeout(r, 700)), reply(v));
  await session({ ...GOOD, ask: slow({ answer: "Ada" }), extract: slow({ values: ["a", "b", "c"] }), answer: slow({ answer: "42", explanation: "e" }) }, async () => {
    const results = await AI.selfTest.run({ makePng: () => PNG_B64, pollMs: 5, timeoutMs: 150 });
    assert.ok(results.some((r) => !r.ok && r.label === "Formulas finished in time"));
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
  });
});

test("if Excel throws midway the run stops, says so, and still deletes the temporary sheet", async () => {
  const wb = createWorkbook({ failAddImage: true });
  await session(GOOD, async () => {
    const results = await runTest();
    assert.ok(results.some((r) => !r.ok && r.label === "Self-test stopped" && /addImage failed/.test(r.detail)));
    assert.deepEqual([...wb.sheets.keys()], ["Sheet1", "Sheet2"]);
    assert.equal(wb.active.name, "Sheet1");
    assert.ok(results.at(-1).ok && /removed/.test(results.at(-1).label));
  });
});

test("the self-test never exceeds the server's per minute limit", async () => {
  createWorkbook();
  await session(GOOD, async (calls) => {
    await runTest();
    assert.ok(calls.length <= 6 && calls.length < 20);
  });
});

// ---------- Answer selected cells (no formulas) ----------

const cellKey = (addr) => { const a = parseAddress(addr); return `${a.r},${a.c}`; };
const put = (wb, addr, value) => wb.active.cells.set(cellKey(addr), { value });
const at = (wb, addr) => wb.active.cells.get(cellKey(addr))?.value ?? "";
const select = (wb, addr) => wb.active.getRange(addr).select();

test("Answer selected cells fills answer and explanation to the right, skips blanks, and passes the instruction", async () => {
  const wb = createWorkbook();
  put(wb, "A2", "What is 40 + 2?"); put(wb, "A4", "Capital of France?"); select(wb, "A2:A4");
  let bodies = [];
  await session({ ...GOOD, answer: (b) => (bodies.push(b), reply({ answer: "ans:" + b.input, explanation: "because" })) }, async (calls) => {
    const summary = await AI.app.runAnswerCells("be brief");
    assert.match(summary, /Answered 2 cells.*1 blank/);
    assert.equal(at(wb, "B2"), "ans:What is 40 + 2?");
    assert.equal(at(wb, "C2"), "because");
    assert.equal(at(wb, "B3"), "", "blank row untouched");
    assert.equal(at(wb, "B4"), "ans:Capital of France?");
    assert.deepEqual(bodies.map((b) => b.instruction), ["be brief", "be brief"]);
    assert.equal(calls.length, 2);
  });
});

test("Answer selected cells never overwrites and spends nothing on rows whose neighbors are taken", async () => {
  const wb = createWorkbook();
  put(wb, "A2", "q1"); put(wb, "C2", "keep me"); put(wb, "A3", "q2"); select(wb, "A2:A3");
  await session(GOOD, async (calls) => {
    const summary = await AI.app.runAnswerCells("");
    assert.match(summary, /Answered 1 cell.*1 skipped/);
    assert.equal(at(wb, "C2"), "keep me");
    assert.equal(at(wb, "B2"), "");
    assert.equal(calls.length, 1, "only the free row was sent");
  });
});

test("Answer selected cells does only the first 10 cells and says so", async () => {
  const wb = createWorkbook();
  for (let r = 2; r <= 14; r++) put(wb, "A" + r, "question " + r);
  select(wb, "A2:A14");
  await session(GOOD, async (calls) => {
    const summary = await AI.app.runAnswerCells("");
    assert.match(summary, /Answered 10 cells.*only the first 10/);
    assert.equal(calls.length, 10);
    assert.equal(at(wb, "B12"), "", "row 12 is the 11th cell and was not done");
  });
});

test("if the server fails midway, earlier answers stay and the message says how many were done", async () => {
  const wb = createWorkbook();
  put(wb, "A2", "q1"); put(wb, "A3", "q2"); select(wb, "A2:A3");
  let n = 0;
  await session({ ...GOOD, answer: () => (++n === 2 ? reply({ error: "provider_busy", message: "The AI provider is rate limiting requests." }, 429) : reply({ answer: "a", explanation: "e" })) }, async () => {
    await assert.rejects(AI.app.runAnswerCells(""), /rate limiting.*1 cell was already answered/);
    assert.equal(at(wb, "B2"), "a");
    assert.equal(at(wb, "B3"), "");
  });
});

test("a cell filled in while the model was thinking is not overwritten", async () => {
  const wb = createWorkbook();
  put(wb, "A2", "q1"); select(wb, "A2");
  await session({ ...GOOD, answer: () => (put(wb, "B2", "typed meanwhile"), reply({ answer: "late", explanation: "late" })) }, async () => {
    const summary = await AI.app.runAnswerCells("");
    assert.equal(at(wb, "B2"), "typed meanwhile");
    assert.match(summary, /Nothing was answered|skipped/);
  });
});

test("answers that look like formulas are stored as text, and a locked helper sends nothing", async () => {
  const wb = createWorkbook();
  put(wb, "A2", "q"); select(wb, "A2");
  await session({ ...GOOD, answer: () => reply({ answer: "=HYPERLINK(\"x\")", explanation: "+cmd" }) }, async (calls) => {
    await AI.app.runAnswerCells("");
    assert.equal(at(wb, "B2"), "'=HYPERLINK(\"x\")");
    assert.equal(at(wb, "C2"), "'+cmd");
    AI.lock();
    await assert.rejects(AI.app.runAnswerCells(""), /own AI key/i);
    assert.equal(calls.length, 1);
  });
});
