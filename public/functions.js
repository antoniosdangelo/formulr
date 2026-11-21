/* Formulr: custom functions and shared helpers.
 * Loaded by taskpane.html, so it runs in the add-in's shared runtime next to the task pane.
 * The access token lives in memory only. Closing the workbook or waiting out the two hour expiry locks it again.
 */
(function (root) {
  "use strict";

  const state = (root.AIHelper = root.AIHelper || {});
  state.token = state.token || null;
  state.expiresAt = state.expiresAt || 0;

  const LOCKED = "Formulr is locked. Click Formulr on the Home tab and enter your access code.";
  const MAX_CACHE = 500;
  const MAX_CELL = 32000; // Excel holds 32,767 characters per cell
  const MAX_CONCURRENT = 8; // a filled down column asks many questions at once; the Worker and the AI provider handle this easily
  const cache = new Map();
  const waiting = [];
  let active = 0;

  // ---------- errors ----------

  function fnError(kind, message) {
    if (typeof CustomFunctions !== "undefined" && CustomFunctions.Error) {
      return new CustomFunctions.Error(CustomFunctions.ErrorCode[kind] || CustomFunctions.ErrorCode.invalidValue, message);
    }
    const err = new Error(message);
    err.kind = kind;
    return err;
  }

  // ---------- session ----------

  // Optional "remember this device": a signed, expiring token in this add-in's own storage.
  // It never contains the access code. Rotating the access code on the server invalidates every remembered device.
  const STORE_KEY = "excelAiHelper.token.v1";

  function store() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function persist(token, expiresAt) {
    const s = store();
    if (!s) return false;
    try {
      s.setItem(STORE_KEY, JSON.stringify({ token: token, expiresAt: expiresAt }));
      return true;
    } catch {
      return false;
    }
  }

  function forget() {
    const s = store();
    try {
      if (s) s.removeItem(STORE_KEY);
    } catch {
      /* nothing to forget */
    }
  }

  function restore() {
    const s = store();
    if (!s) return false;
    try {
      const saved = JSON.parse(s.getItem(STORE_KEY) || "null");
      if (saved && typeof saved.token === "string" && Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()) {
        state.token = saved.token;
        state.expiresAt = saved.expiresAt;
        state.remembered = true;
        return true;
      }
      s.removeItem(STORE_KEY);
    } catch {
      /* unreadable, treat as locked */
    }
    return false;
  }

  function setToken(token, expiresInSeconds, remember) {
    state.token = token;
    state.expiresAt = Date.now() + expiresInSeconds * 1000;
    state.remembered = remember === true && persist(token, state.expiresAt);
    if (!state.remembered) forget();
  }

  function lock() {
    state.token = null;
    state.expiresAt = 0;
    state.remembered = false;
    forget();
  }

  function isUnlocked() {
    return Boolean(state.token) && Date.now() < state.expiresAt;
  }

  function baseUrl() {
    if (state.base) return state.base;
    return typeof location !== "undefined" && location.origin && location.origin !== "null" ? location.origin : "";
  }

  // ---------- network with a small concurrency gate ----------

  async function acquire() {
    if (active < MAX_CONCURRENT) {
      active++;
      return;
    }
    await new Promise((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }

  // Nothing may wait forever: a call that hangs would keep its cell on #BUSY! (and hold one of the three request slots)
  // until the page is reloaded. Every attempt has a deadline, and short failures are retried.
  state.retryDelaysMs = state.retryDelaysMs || [2000, 5000, 12000, 25000]; // service busy (429)
  state.transientRetryDelaysMs = state.transientRetryDelaysMs || [600, 1800]; // network trouble, 502, 504
  // Deadline per attempt: 15 s plus a little for very long text. Normal answers take a few seconds, so a stall is caught fast and retried.
  const deadlineFor = (bodyText, careful) => state.attemptTimeoutMs || (careful ? 70000 : Math.min(70000, 15000 + Math.round(bodyText.length * 0.1)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function attemptOnce(payload) {
    const bodyText = JSON.stringify(payload);
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), deadlineFor(bodyText, payload.careful === true)) : null;
    try {
      const res = await fetch(baseUrl() + "/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + state.token },
        body: bodyText,
        signal: ctrl ? ctrl.signal : undefined,
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* keep null */
      }
      return { res: res, body: body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function callApi(payload) {
    if (!isUnlocked()) throw fnError("notAvailable", LOCKED);
    await acquire();
    try {
      let busyTries = 0;
      let transientTries = 0;
      let out;
      for (;;) {
        let failedToReach = false;
        try {
          out = await attemptOnce(payload);
        } catch {
          failedToReach = true;
        }
        if (failedToReach) {
          if (transientTries < state.transientRetryDelaysMs.length) {
            await sleep(state.transientRetryDelaysMs[transientTries++]);
            continue;
          }
          throw fnError("notAvailable", "Could not reach Formulr. Check your connection and try again.");
        }
        const status = out.res.status;
        if (status === 429 && busyTries < state.retryDelaysMs.length) {
          const hinted = Number(out.res.headers && out.res.headers.get && out.res.headers.get("retry-after"));
          await sleep(Math.min(Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 : state.retryDelaysMs[busyTries], 30000));
          busyTries++;
          continue;
        }
        if ((status === 502 || status === 504) && transientTries < state.transientRetryDelaysMs.length) {
          await sleep(state.transientRetryDelaysMs[transientTries++]);
          continue;
        }
        break;
      }
      const res = out.res;
      const body = out.body;
      if (!res.ok) {
        if (res.status === 401) lock();
        const kind = res.status === 400 || res.status === 413 || res.status === 415 || res.status === 422 ? "invalidValue" : "notAvailable";
        throw fnError(kind, (body && body.message) || "Request failed (" + res.status + ")");
      }
      try {
        state.lastTiming = res.headers.get("server-timing") || "";
      } catch {
        /* timing is optional */
      }
      return body;
    } finally {
      release();
    }
  }

  async function unlock(code, remember) {
    let res;
    try {
      res = await fetch(baseUrl() + "/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code, remember: remember === true }),
      });
    } catch {
      throw new Error("Could not reach Formulr. Check your connection.");
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* keep null */
    }
    if (!res.ok) throw new Error((body && body.message) || "Unlock failed (" + res.status + ")");
    setToken(body.token, body.expiresInSeconds, remember === true);
    return body.expiresInSeconds;
  }

  // ---------- cache: results are keyed by the exact inputs, so changed inputs never reuse an old answer ----------

  // Long inputs are fingerprinted so the cache never holds a second copy of a huge cell. Two independent 53-bit hashes plus the length make a collision practically impossible.
  function fingerprint(str) {
    let a1 = 0xdeadbeef, a2 = 0x41c6ce57, b1 = 0x9e3779b9, b2 = 0x85ebca6b;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      a1 = Math.imul(a1 ^ ch, 2654435761);
      a2 = Math.imul(a2 ^ ch, 1597334677);
      b1 = Math.imul(b1 ^ ch, 3266489917);
      b2 = Math.imul(b2 ^ ch, 668265263);
    }
    a1 = Math.imul(a1 ^ (a1 >>> 16), 2246822507) ^ Math.imul(a2 ^ (a2 >>> 13), 3266489909);
    a2 = Math.imul(a2 ^ (a2 >>> 16), 2246822507) ^ Math.imul(a1 ^ (a1 >>> 13), 3266489909);
    b1 = Math.imul(b1 ^ (b1 >>> 16), 2246822507) ^ Math.imul(b2 ^ (b2 >>> 13), 3266489909);
    b2 = Math.imul(b2 ^ (b2 >>> 16), 2246822507) ^ Math.imul(b1 ^ (b1 >>> 13), 3266489909);
    const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
    return str.length + ":" + hex(a1) + hex(a2) + hex(b1) + hex(b2);
  }

  function cacheKey(parts) {
    return parts.map((p) => fingerprint(typeof p === "string" ? p : JSON.stringify(p))).join("|");
  }

  // Answers are also kept in this browser for a week, so reopening a workbook does not ask
  // every question again. Only finished answers are saved, never errors.
  const SAVED_KEY = "formulr.answers.v1";
  const SAVED_TTL_MS = 7 * 24 * 3600 * 1000;
  const SAVED_MAX = 400;
  let saved = null;

  function storage() {
    try {
      return globalThis.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function loadSaved() {
    if (saved) return saved;
    saved = {};
    try {
      const raw = storage() && storage().getItem(SAVED_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && typeof data === "object") saved = data;
    } catch (e) {
      saved = {};
    }
    return saved;
  }

  function flushSaved() {
    const store = storage();
    if (!store) return;
    const keys = Object.keys(saved);
    if (keys.length > SAVED_MAX) {
      keys.sort((a, b) => saved[a].t - saved[b].t);
      for (const k of keys.slice(0, keys.length - SAVED_MAX)) delete saved[k];
    }
    try {
      store.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch (e) {
      /* storage full or blocked: the in-memory cache still works */
    }
  }

  function savedAnswer(key) {
    if (!storage()) return undefined;
    const hit = loadSaved()[key];
    if (!hit || Date.now() - hit.t > SAVED_TTL_MS) return undefined;
    return hit.v;
  }

  function saveAnswer(key, value) {
    if (!storage()) return;
    loadSaved()[key] = { t: Date.now(), v: value };
    flushSaved();
  }

  function clearSaved() {
    saved = {};
    const store = storage();
    try {
      if (store) store.removeItem(SAVED_KEY);
    } catch (e) {
      /* nothing to clear */
    }
  }

  function cached(parts, loader) {
    const key = cacheKey(parts);
    if (cache.has(key)) return cache.get(key);
    const keep = savedAnswer(key);
    if (keep !== undefined) {
      const hit = Promise.resolve(keep);
      cache.set(key, hit);
      return hit;
    }
    const promise = loader().then(
      (value) => {
        saveAnswer(key, value);
        return value;
      },
      (err) => {
        cache.delete(key);
        throw err;
      }
    );
    cache.set(key, promise);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return promise;
  }

  // ---------- helpers that are unit tested ----------

  const NUMERIC = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

  // Cut at a character boundary: never leave half of an emoji at the end.
  function safeSlice(s, max) {
    if (s.length <= max) return s;
    const last = s.charCodeAt(max - 1);
    return s.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
  }

  function escapeCell(value) {
    let s = value === null || value === undefined ? "" : String(value);
    if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && s.length > 1 && !NUMERIC.test(s))) s = "'" + s;
    return safeSlice(s, MAX_CELL);
  }

  function normalizeFields(fields) {
    const flat = [].concat(...(Array.isArray(fields) ? fields : [[fields]])).map((f) => String(f === null || f === undefined ? "" : f).trim());
    const names = flat.length === 1 ? flat[0].split(/[,;]/).map((f) => f.trim()) : flat;
    return names.filter((f) => f.length > 0);
  }

  function findPictureForCell(cell, shapes) {
    const tol = 1.5;
    const images = shapes.filter((s) => s.type === "Image");
    if (images.length === 0) throw new Error("There is no picture on this sheet. Paste or insert one first.");
    const inside = images.filter(
      (s) => s.left >= cell.left - tol && s.left <= cell.left + cell.width + tol && s.top >= cell.top - tol && s.top <= cell.top + cell.height + tol,
    );
    if (inside.length === 0) {
      // Selecting a cell that sits under a picture also works, when exactly one picture covers it.
      const covering = images.filter((s) => s.width > 0 && s.height > 0 && cell.left >= s.left - tol && cell.left <= s.left + s.width && cell.top >= s.top - tol && cell.top <= s.top + s.height);
      if (covering.length === 1) return covering[0];
      throw new Error("No picture has its top left corner inside the selected cell. Move the picture so its corner sits in that cell, then select the cell.");
    }
    if (inside.length > 1) throw new Error("More than one picture starts in this cell. Keep one picture per cell.");
    return inside[0];
  }

  function planWrite(values, formulas) {
    let occupied = 0;
    const blank = (v) => v === "" || v === null || v === undefined;
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        if (!blank(values[r][c]) || !blank(formulas && formulas[r] && formulas[r][c])) occupied++;
      }
    }
    return { ok: occupied === 0, occupied: occupied };
  }

  // ---------- custom functions ----------

  // Plain values, booleans as Excel shows them, and rich cells (linked data types) by their displayed text.
  function cellText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "object") {
      const shown = v.text !== undefined ? v.text : v.basicValue !== undefined ? v.basicValue : null;
      return shown !== null && typeof shown !== "object" ? String(shown) : JSON.stringify(v);
    }
    return String(v);
  }

  // Accepts one cell, a typed string, or any range. A range becomes text with a line break between rows and a tab between cells, so tables keep their shape.
  function toText(v) {
    if (!Array.isArray(v)) return cellText(v);
    if (v.length === 1 && Array.isArray(v[0]) && v[0].length === 1) return cellText(v[0][0]);
    const lines = v.map((row) => (Array.isArray(row) ? row.map(cellText).join("\t") : cellText(row)));
    // A generous range such as A1:A40 is fine: empty rows before and after the pasted text are ignored.
    let first = 0;
    let last = lines.length - 1;
    while (first <= last && lines[first].replace(/\t/g, "").trim() === "") first++;
    while (last >= first && lines[last].replace(/\t/g, "").trim() === "") last--;
    return lines.slice(first, last + 1).join("\n");
  }
  const text = toText;

  /**
   * Asks the AI about a cell or any text and returns a short answer.
   * @customfunction ASK
   * @param {string} instruction What to do, for example "Summarize in one line".
   * @param {any[][]} [input] The text to work on: a cell, a range, or pasted text of any length.
   * @returns {string} The answer.
   */
  async function ask(instruction, input) {
    const ins = text(instruction);
    const inp = text(input);
    if (!ins.trim()) throw fnError("invalidValue", 'Add an instruction');
    const out = await cached(["ask", ins, inp], () => callApi({ mode: "ask", instruction: ins, input: inp }));
    return out.answer;
  }

  /**
   * Pulls named fields out of text and spills them across one row.
   * @customfunction EXTRACT
   * @param {any[][]} input The text to read: a cell, a range, or pasted text of any length.
   * @param {any[][]} fields Field names, as a range like D1:F1 or text like "name, date, amount".
   * @returns {string[][]} One row with a value for each field.
   */
  async function extract(input, fields) {
    const inp = text(input);
    const names = normalizeFields(fields);
    if (!inp.trim()) throw fnError("invalidValue", "The input text is empty");
    if (names.length === 0) throw fnError("invalidValue", 'List the fields to pull out, for example D1:F1 or "name, date, amount"');
    const out = await cached(["extract", inp, names], () => callApi({ mode: "extract", input: inp, fields: names }));
    return [out.values];
  }

  restore();

  /**
   * Answers what the text asks and explains briefly, spilling the answer and the explanation into two cells.
   * @customfunction ANSWER
   * @param {any[][]} input The text to respond to: a cell, a range, or pasted text of any length.
   * @param {string} [instruction] Optional extra instruction, for example "in Spanish".
   * @returns {string[][]} One row: the answer, then a short explanation.
   */
  async function answer(input, instruction) {
    const inp = text(input);
    if (!inp.trim()) throw fnError("invalidValue", "The input text is empty");
    const ins = text(instruction);
    const out = await cached(["answer", inp, ins], () => callApi({ mode: "answer", input: inp, instruction: ins }));
    return [[out.answer, out.explanation]];
  }

  /**
   * Like ANSWER, but slower and more accurate: it reasons first and checks its own arithmetic. Use it for maths, finance and exam questions.
   * @customfunction CAREFUL
   * @param {any[][]} input The text to respond to: a cell, a range, or pasted text of any length.
   * @param {string} [instruction] Optional extra instruction, for example "in Spanish".
   * @returns {string[][]} One row: the answer, then a short explanation.
   */
  async function careful(input, instruction) {
    const inp = text(input);
    if (!inp.trim()) throw fnError("invalidValue", "The input text is empty");
    const ins = text(instruction);
    const out = await cached(["careful", inp, ins], () => callApi({ mode: "answer", input: inp, instruction: ins, careful: true }));
    return [[out.answer, out.explanation]];
  }

  /**
   * Just the answer, in one cell: no explanation. The tidiest and quickest formula.
   * @customfunction SHORT
   * @param {any[][]} input The text to respond to: a cell, a range, or pasted text of any length.
   * @param {string} [instruction] Optional extra instruction, for example "in Spanish".
   * @returns {string} The answer only.
   */
  // The one public formula: just the short answer, in a single cell.
  async function one(input, instruction) {
    const inp = text(input);
    if (!inp.trim()) throw fnError("invalidValue", "The input text is empty");
    const ins = text(instruction);
    const out = await cached(["answer", inp, ins], () => callApi({ mode: "answer", input: inp, instruction: ins }));
    return out.answer; // the model also writes a one line reason, which is only used to catch an answer that argues with itself
  }
  async function short(input, instruction) {
    const inp = text(input);
    if (!inp.trim()) throw fnError("invalidValue", "The input text is empty");
    const extra = text(instruction).trim();
    const ins = "Reply with only the final answer, as briefly as possible, with no explanation." + (extra ? " " + extra : "");
    const out = await cached(["short", inp, extra], () => callApi({ mode: "ask", instruction: ins, input: inp }));
    return out.answer;
  }

  // Excel's CustomFunctions object can appear slightly after this script runs, so keep trying for a few seconds.
  function associateNow() {
    if (state.associated) return true;
    if (typeof CustomFunctions === "undefined" || !CustomFunctions.associate) return false;
    CustomFunctions.associate("ANSWER", one);
    state.associated = true;
    return true;
  }

  if (!associateNow() && typeof setInterval === "function") {
    let tries = 0;
    const timer = setInterval(() => {
      if (associateNow() || ++tries > 100) clearInterval(timer);
    }, 100);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  state.callApi = callApi;
  state.unlock = unlock;
  state.lock = lock;
  state.isUnlocked = isUnlocked;
  state.setToken = setToken;
  state.restore = restore;
  state.associateNow = associateNow;
  state.LOCKED = LOCKED;
  state.util = { safeSlice: safeSlice, toText: toText, fingerprint: fingerprint, cacheKey: cacheKey, escapeCell: escapeCell, normalizeFields: normalizeFields, findPictureForCell: findPictureForCell, planWrite: planWrite };
  state.functions = { ask: ask, extract: extract, answer: answer, careful: careful, short: short, one: one };
  state._cache = cache;
  state.clearSaved = clearSaved;
  state._saved = { key: SAVED_KEY, ttl: SAVED_TTL_MS, max: SAVED_MAX, reload: () => (saved = null) };

  if (typeof module !== "undefined" && module.exports) module.exports = state;
})(typeof globalThis !== "undefined" ? globalThis : this);
