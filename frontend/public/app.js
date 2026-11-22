/* Task pane logic and the ribbon command. Shares the runtime with functions.js. */
(function (root) {
  "use strict";

  const AI = root.AIHelper;
  const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

  function setStatus(message, kind) {
    const el = $("status");
    if (!el) return;
    el.textContent = message;
    el.className = kind || "";
  }

  function showPane() {
    try {
      if (root.Office && Office.addin && Office.addin.showAsTaskpane) return Office.addin.showAsTaskpane();
    } catch {
      /* pane could not be shown, the error stays in the status line */
    }
    return Promise.resolve();
  }

  function updateLockUi() {
    const unlocked = AI.isUnlocked();
    const lockBadge = $("lock-state");
    if (lockBadge) {
      lockBadge.textContent = unlocked ? "Unlocked" : "Locked";
      lockBadge.className = "badge " + (unlocked ? "on" : "off");
    }
    const note = $("lock-note");
    if (note) {
      note.textContent = unlocked
        ? AI.remembered
          ? "Remembered on this device until " + new Date(AI.expiresAt).toLocaleDateString() + "."
          : "Unlocked until " + new Date(AI.expiresAt).toLocaleTimeString() + "."
        : "";
    }
  }

  function updateKeyUi() {
    const note = $("key-note");
    if (!note) return;
    const k = AI.userKey();
    // The key box stands out until a key is saved, unless this is the owner's pass.
    const box = $("key-section");
    if (box && box.classList) box.classList.toggle("needs-key", !k && AI.role !== "owner");
    if (k) {
      if ($("ai-provider")) $("ai-provider").value = k.provider;
      note.textContent = "Saved on this device: " + (k.provider === "anthropic" ? "Anthropic" : "Gemini") + " key ending in " + k.key.slice(-4) + ".";
    } else {
      note.textContent = AI.role === "owner" ? "No key saved. Your owner pass uses the service's own key." : "No key saved yet. Answers need your own key.";
    }
  }

  function onSaveKey() {
    const input = $("ai-key");
    const key = input.value;
    input.value = "";
    try {
      AI.setUserKey($("ai-provider").value, key);
      setStatus("Key saved on this device.", "ok");
    } catch (err) {
      setStatus(err.message, "error");
    }
    updateKeyUi();
  }

  async function onUnlock() {
    const input = $("code");
    const code = input.value;
    input.value = "";
    if (!code) return setStatus("Enter your access code first.", "error");
    setStatus("Unlocking...");
    try {
      const remember = Boolean($("remember") && $("remember").checked);
      await AI.unlock(code, remember);
      const needKey = AI.role !== "owner" && !AI.userKey();
      setStatus(
        (AI.remembered ? "Unlocked and remembered on this device." : "Unlocked for 2 hours.") +
          (needKey ? " Now add your own AI key below." : " Type =FORMULR.ANSWER(cell) next to a question."),
        "ok",
      );
    } catch (err) {
      setStatus(err.message, "error");
    }
    updateLockUi();
    updateKeyUi();
  }

  // The server accepts pictures up to 5 MB. A large screenshot is shrunk first (longest side 2000 px, JPEG), which keeps text readable.
  // Anything that cannot be shrunk here is sent unchanged.
  const SHRINK_ABOVE = 3 * 1024 * 1024;
  async function shrinkImage(b64) {
    if (!b64 || b64.length * 0.75 <= SHRINK_ABOVE) return b64;
    try {
      if (typeof document === "undefined" || typeof Image === "undefined") return b64;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = "data:image/png;base64," + b64;
      });
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx2d = canvas.getContext("2d");
      ctx2d.fillStyle = "#fff";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
      return out && out.length < b64.length ? out : b64;
    } catch (e) {
      return b64;
    }
  }

  // The picture the user has clicked, when this Excel can tell us (ExcelApi 1.19). Null otherwise.
  async function activePicture(ctx) {
    try {
      if (!Office.context.requirements.isSetSupported("ExcelApi", "1.19") || typeof ctx.workbook.getActiveShapeOrNullObject !== "function") return null;
      const shape = ctx.workbook.getActiveShapeOrNullObject();
      shape.load("isNullObject,type,top,left,width,height");
      await ctx.sync();
      return !shape.isNullObject && shape.type === "Image" && shape.width > 0 ? shape : null;
    } catch (e) {
      return null;
    }
  }

  function canTrackClick(ctx) {
    return Office.context.requirements.isSetSupported("ExcelApi", "1.19") && typeof ctx.workbook.getActiveShapeOrNullObject === "function";
  }

  // Poll for a clicked picture, so the button can be pressed before the picture is clicked.
  async function waitForClickedPicture(ctx, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const shape = await activePicture(ctx);
      if (shape) return shape;
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  }

  // Largest row or column index whose start is at or before the given point, found by halving the sheet.
  async function indexAt(ctx, sheet, axis, point, max) {
    let lo = 0;
    let hi = max;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const c = axis === "row" ? sheet.getCell(mid, 0) : sheet.getCell(0, mid);
      c.load(axis === "row" ? "top" : "left");
      await ctx.sync();
      if ((axis === "row" ? c.top : c.left) <= point) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // kind "extract": write the picture's table or text into the cells on the right.
  // kind "answer": write just the short answer into the one cell on the right.
  async function runImageTask(kind, instructionOverride) {
    // getAsImage is ExcelApi 1.9, but Range.top/left/width/height (used to find the picture's cell) are 1.10.
    if (!(root.Office && Office.context && Office.context.requirements.isSetSupported("ExcelApi", "1.10"))) {
      throw new Error("This version of Excel can't read pictures (needs Excel API 1.10). Run the checks in the pane to see what your Excel supports.");
    }
    if (!AI.isUnlocked()) throw new Error(AI.LOCKED);
    const instruction = instructionOverride !== undefined ? instructionOverride : ($("instruction") && $("instruction").value) || "";
    let summary = "";
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      // Best case: the picture itself is clicked (newer Excel). Otherwise find it from the selected cell.
      let shape = await activePicture(ctx);
      let row;
      let col;
      if (shape) {
        row = await indexAt(ctx, sheet, "row", shape.top + 1.5, 1048575);
        col = (await indexAt(ctx, sheet, "col", shape.left + shape.width - 1.5, 16383)) + 1;
      } else {
        const cell = ctx.workbook.getSelectedRange().getCell(0, 0);
        const canSeeCellImages = Office.context.requirements.isSetSupported("ExcelApi", "1.16");
        cell.load("top,left,width,height,rowIndex,columnIndex" + (canSeeCellImages ? ",valuesAsJson" : ""));
        const shapes = sheet.shapes;
        shapes.load("items/id,items/name,items/type,items/top,items/left,items/width,items/height");
        await ctx.sync();
        try {
          shape = AI.util.findPictureForCell(cell, shapes.items);
        } catch (err) {
          const v = canSeeCellImages && cell.valuesAsJson && cell.valuesAsJson[0] && cell.valuesAsJson[0][0];
          if (v && (v.type === "LocalImage" || v.type === "WebImage")) {
            throw new Error("This picture is placed inside a cell, and Excel does not let add-ins read those. Right click it, choose Place over Cells, then click the picture and press Ask about picture again.");
          }
          throw err;
        }
        row = cell.rowIndex;
        col = cell.columnIndex + 1;
        if (shape.width > 0 && cell.left <= shape.left + shape.width) {
          // The answer goes just past the picture's right edge, so a wide picture does not cover it.
          col = (await indexAt(ctx, sheet, "col", shape.left + shape.width - 1.5, 16383)) + 1;
        }
      }
      const firstTarget = sheet.getRangeByIndexes(row, col, 1, 1);
      firstTarget.load("values,formulas");
      const img = shape.getAsImage(Excel.PictureFormat.png);
      await ctx.sync();
      if (!AI.util.planWrite(firstTarget.values, firstTarget.formulas).ok) {
        throw new Error("The cell to the right of the picture is not empty. Clear it first. Nothing was sent.");
      }

      const data = await shrinkImage(img.value);
      const result = await AI.callApi({ mode: kind === "answer" ? "image_answer" : "image", instruction: instruction, image: { data: data } });
      const rows = kind === "answer" ? [[result.answer]] : result.rows;
      const target = sheet.getRangeByIndexes(row, col, rows.length, rows[0].length);
      target.load("values,formulas,address");
      await ctx.sync();
      const plan = AI.util.planWrite(target.values, target.formulas);
      if (!plan.ok) {
        throw new Error("The result needs " + rows.length + " rows by " + rows[0].length + " columns, but " + plan.occupied + " cells there already have content. Nothing was written.");
      }
      target.values = rows.map((r) => r.map(AI.util.escapeCell));
      await ctx.sync();
      summary = "Wrote " + rows.length + " rows by " + rows[0].length + " columns to " + target.address + ".";
    });
    return summary;
  }

  // Answer one picture: the one you clicked (either order, if Excel can tell us), else the one under the selected cell, else the only picture on the sheet.
  // Each answer goes in the cell just past that picture's right edge. A picture whose cell is already filled is not asked again,
  // so pressing the button again never repeats a question. A failure is written in that cell as "Formulr: ..." so it is visible.
  const FAIL_MARK = "Formulr:";
  async function runPictureAnswers(instructionOverride) {
    if (!(root.Office && Office.context && Office.context.requirements.isSetSupported("ExcelApi", "1.10"))) {
      throw new Error("This version of Excel can't read pictures (needs Excel API 1.10). Run the checks in the pane to see what your Excel supports.");
    }
    if (!AI.isUnlocked()) throw new Error(AI.LOCKED);
    const instruction = instructionOverride !== undefined ? instructionOverride : ($("instruction") && $("instruction").value) || "";
    let summary = "";
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const spot = async (shape) => ({
        shape: shape,
        row: await indexAt(ctx, sheet, "row", shape.top + 1.5, 1048575),
        col: (await indexAt(ctx, sheet, "col", shape.left + shape.width - 1.5, 16383)) + 1,
      });
      let picks = [];
      const clicked = await activePicture(ctx);
      if (clicked) picks = [await spot(clicked)];
      else {
        const cell = ctx.workbook.getSelectedRange().getCell(0, 0);
        const canSeeCellImages = Office.context.requirements.isSetSupported("ExcelApi", "1.16");
        cell.load("top,left,width,height,rowIndex,columnIndex" + (canSeeCellImages ? ",valuesAsJson" : ""));
        const shapes = sheet.shapes;
        shapes.load("items/id,items/name,items/type,items/top,items/left,items/width,items/height");
        await ctx.sync();
        try {
          const found = AI.util.findPictureForCell(cell, shapes.items);
          if (found.width > 0 && cell.left <= found.left + found.width) picks = [await spot(found)];
          else picks = [{ shape: found, row: cell.rowIndex, col: cell.columnIndex + 1 }];
        } catch (err) {
          const all = shapes.items.filter((x) => x.type === "Image" && x.width > 0);
          const noClick = new Error("No picture was clicked. Press Answer picture, then click the picture you want answered. The answer appears in the cell on its right.");
          if (all.length === 0) {
            const v = canSeeCellImages && cell.valuesAsJson && cell.valuesAsJson[0] && cell.valuesAsJson[0][0];
            if (v && v.type === "LocalImage" && v.image && typeof v.image.data === "string" && v.image.data) {
              // This Excel hands over the in-cell picture's data (it is a preview feature, so not every version does).
              summary = await answerImageData(v.image.data, instruction, { row: cell.rowIndex, col: cell.columnIndex + 1 });
              return;
            }
            if (v && (v.type === "LocalImage" || v.type === "WebImage")) {
              throw new Error("Excel does not give add-ins the pixels of a picture inside a cell. Copy the picture (Ctrl+C), then paste it into the box in the Formulr pane. Or right click it, choose Place over Cells, click it, and press Answer picture.");
            }
            throw err;
          }
          if (canTrackClick(ctx) && AI.app.clickWaitMs > 0) {
            // Pressed first, picture not clicked yet: wait for the click, then answer that one picture only.
            const waited = await waitForClickedPicture(ctx, AI.app.clickWaitMs);
            if (!waited) throw noClick;
            picks = [await spot(waited)];
          } else if (all.length === 1) {
            picks = [await spot(all[0])]; // an Excel that cannot tell which picture is clicked: the only picture on the sheet
          } else {
            throw noClick;
          }
        }
      }
      const targets = picks.map((p) => {
        const range = sheet.getRangeByIndexes(p.row, p.col, 1, 1);
        range.load("values,formulas");
        return range;
      });
      const images = picks.map((p) => p.shape.getAsImage(Excel.PictureFormat.png));
      await ctx.sync();
      const todo = [];
      let skipped = 0;
      picks.forEach((p, i) => {
        const here = targets[i].values[0][0];
        const free = AI.util.planWrite(targets[i].values, targets[i].formulas).ok || String(here).startsWith(FAIL_MARK);
        if (free) todo.push(i);
        else skipped++;
      });
      if (todo.length === 0) {
        throw new Error("The cell to the right of the picture is not empty. Clear it first. Nothing was sent.");
      }
      const results = await Promise.all(
        todo.map(async (i) => {
          try {
            const data = await shrinkImage(images[i].value);
            const r = await AI.callApi({ mode: "image_answer", instruction: instruction, image: { data: data } });
            return r.answer;
          } catch (err) {
            return FAIL_MARK + " " + String((err && err.message) || err).slice(0, 200);
          }
        }),
      );
      todo.forEach((i, k) => {
        const text = results[k];
        sheet.getRangeByIndexes(picks[i].row, picks[i].col, 1, 1).values = [[text.startsWith(FAIL_MARK) ? text : AI.util.escapeCell(text)]];
      });
      await ctx.sync();
      const failed = results.filter((t) => t.startsWith(FAIL_MARK)).length;
      summary = "Answered " + (todo.length - failed) + " picture(s)" + (failed ? ", " + failed + " failed (see the cell next to it)" : "") + (skipped ? ", skipped " + skipped + " already answered" : "") + ".";
    });
    return summary;
  }

  // Answer a picture that is not an Excel shape: bytes in, answer written into the cell just right of the selected cell.
  // Used by the paste box in the pane, and for in-cell pictures when Excel hands over their data.
  async function answerImageData(b64, instruction, where) {
    if (!AI.isUnlocked()) throw new Error(AI.LOCKED);
    const data = await shrinkImage(b64);
    let summary = "";
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      let row = where && where.row;
      let col = where && where.col;
      if (row === undefined) {
        const cell = ctx.workbook.getSelectedRange().getCell(0, 0);
        cell.load("rowIndex,columnIndex");
        await ctx.sync();
        row = cell.rowIndex;
        col = cell.columnIndex + 1;
      }
      const target = sheet.getRangeByIndexes(row, col, 1, 1);
      target.load("values,formulas,address");
      await ctx.sync();
      const free = AI.util.planWrite(target.values, target.formulas).ok || String(target.values[0][0]).startsWith(FAIL_MARK);
      if (!free) throw new Error("The cell to the right of the selected cell is not empty. Select a cell with an empty cell on its right. Nothing was sent.");
      let text;
      try {
        const r = await AI.callApi({ mode: "image_answer", instruction: instruction || "", image: { data: data } });
        text = AI.util.escapeCell(r.answer);
      } catch (err) {
        text = FAIL_MARK + " " + String((err && err.message) || err).slice(0, 200);
      }
      target.values = [[text]];
      await ctx.sync();
      summary = (text.startsWith(FAIL_MARK) ? "Failed, see " : "Answered in ") + target.address + ".";
    });
    return summary;
  }

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // The paste box: the picture is copied (a screenshot, or copied from a cell or sheet) and pasted here. No dependence on how Excel stores it.
  async function onPasteImage(event) {
    const items = (event.clipboardData && event.clipboardData.items) || [];
    const item = Array.prototype.find.call(items, (it) => it.kind === "file" && /^image\//.test(it.type));
    event.preventDefault();
    if (!item) {
      setStatus("No picture on the clipboard. Copy a screenshot or a picture first, then paste here.", "error");
      return;
    }
    try {
      setStatus("Reading the picture...");
      const b64 = await blobToBase64(item.getAsFile());
      setStatus(await answerImageData(b64, ($("instruction") && $("instruction").value) || ""), "ok");
    } catch (err) {
      setStatus(err.message || "Something went wrong.", "error");
    }
  }

  // Answer the text in the selected cell(s): the answer goes in the next cell to the right, the explanation in the one after.
  // Needs no formulas and no function registration. Up to 10 cells per click, never overwrites, skips blanks.
  async function runAnswerCells(instructionOverride) {
    if (!AI.isUnlocked()) throw new Error(AI.LOCKED);
    const instruction = instructionOverride !== undefined ? instructionOverride : ($("instruction") && $("instruction").value) || "";
    const MAX = 10;
    let summary = "";
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const sel = ctx.workbook.getSelectedRange();
      sel.load("rowIndex,columnIndex,rowCount,columnCount");
      await ctx.sync();
      const rows = Math.min(sel.rowCount, MAX);
      const src = sheet.getRangeByIndexes(sel.rowIndex, sel.columnIndex, rows, 1);
      src.load("values");
      await ctx.sync();
      let done = 0;
      let blank = 0;
      let busy = 0;
      for (let i = 0; i < rows; i++) {
        const text = String(src.values[i][0] === null || src.values[i][0] === undefined ? "" : src.values[i][0]).trim();
        if (!text) {
          blank++;
          continue;
        }
        const target = sheet.getRangeByIndexes(sel.rowIndex + i, sel.columnIndex + 1, 1, 2);
        target.load("values,formulas");
        await ctx.sync();
        if (!AI.util.planWrite(target.values, target.formulas).ok) {
          busy++;
          continue;
        }
        let out;
        try {
          out = await AI.callApi({ mode: "answer", input: text, instruction: instruction });
        } catch (err) {
          throw new Error(err.message + (done ? " (" + done + (done === 1 ? " cell was" : " cells were") + " already answered)" : ""));
        }
        target.load("values,formulas"); // re-check right before writing, in case the sheet changed while waiting
        await ctx.sync();
        if (!AI.util.planWrite(target.values, target.formulas).ok) {
          busy++;
          continue;
        }
        target.values = [[AI.util.escapeCell(out.answer), AI.util.escapeCell(out.explanation)]];
        await ctx.sync();
        done++;
      }
      const notes = [];
      if (busy) notes.push(busy + " skipped because the two cells to the right already have content");
      if (blank) notes.push(blank + " blank");
      if (sel.rowCount > MAX) notes.push("only the first " + MAX + " cells were done");
      summary = done
        ? "Answered " + done + " cell" + (done === 1 ? "" : "s") + (notes.length ? " (" + notes.join(", ") + ")." : ".")
        : "Nothing was answered: " + (notes.join(", ") || "select a cell that contains text, with the two cells to its right empty") + ".";
    });
    return summary;
  }

  // Tidy view: keep long questions to one line so the answers stand out. It only changes how the selected cells look, never what is in them.
  async function runCompact(compact) {
    let summary = "";
    await Excel.run(async (ctx) => {
      const sel = ctx.workbook.getSelectedRange();
      sel.load("rowCount,columnCount");
      await ctx.sync();
      if (sel.rowCount * sel.columnCount > 50000) throw new Error("Select fewer cells (up to 50,000) and try again.");
      if (compact) {
        sel.format.wrapText = false;
        sel.format.rowHeight = 15;
      } else {
        sel.format.wrapText = true;
        sel.format.autofitRows();
      }
      await ctx.sync();
      summary = (compact ? "Tidied " : "Expanded ") + sel.rowCount + (sel.rowCount === 1 ? " row." : " rows.") + (compact ? " Press Expand to show the full text again." : "");
    });
    return summary;
  }

  // Ask Excel to load the add-in whenever this workbook opens, so the formulas are ready straight away instead of
  // waiting for the runtime on the first calculation. Needs the shared runtime; harmless where it is not available.
  let startupSet = false;
  async function keepLoaded() {
    if (startupSet) return false;
    try {
      if (root.Office && Office.addin && Office.addin.setStartupBehavior && Office.StartupBehavior) {
        startupSet = true;
        await Office.addin.setStartupBehavior(Office.StartupBehavior.load);
        return true;
      }
    } catch (err) {
      startupSet = false;
      if (typeof console !== "undefined") console.info("[Formulr] could not set load on open", err && err.message);
    }
    return false;
  }

  // Fires several different questions at once, the way a filled down column does, and reports how long they took.
  async function runSpeedTest(count) {
    if (!AI.isUnlocked()) throw new Error(AI.LOCKED);
    const n = count || 6;
    const stamp = Date.now();
    const started = Date.now();
    const times = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const t = Date.now();
        await AI.functions.one("What is " + (i + 2) + " + " + (i + 3) + "? Reply with just the number. (speed test " + stamp + ")");
        return Date.now() - t;
      }),
    );
    const secs = (ms) => (ms / 1000).toFixed(1) + " s";
    const head = "Speed test: " + n + " questions at once finished in " + secs(Date.now() - started) + ". Fastest " + secs(Math.min(...times)) + ", slowest " + secs(Math.max(...times)) + ", average " + secs(times.reduce((a, b) => a + b, 0) / n) + ".";
    // One multiple choice calculation on its own: this is the slowest kind, since it uses the calculator tools.
    const mc = Date.now();
    await AI.functions.one("A bond has price $1,000, modified duration " + (6 + (stamp % 7) / 10).toFixed(1) + " and yields rise 50 bps. Ignoring convexity, what is the new price?\nA. $970.00\nB. $965.00\nC. $975.00\nD. $980.00\n(speed test " + stamp + ")");
    return head + " Multiple choice calculation alone: " + secs(Date.now() - mc) + ".";
  }

  const runExtractImage = (instruction) => runImageTask("extract", instruction);
  const runAskPicture = (instruction) => runPictureAnswers(instruction);

  function commandHandler(run, busyMessage) {
    return async function (event) {
      try {
        setStatus(busyMessage);
        setStatus(await run(), "ok");
      } catch (err) {
        setStatus(err.message || "Something went wrong.", "error");
        await showPane();
      } finally {
        if (event && typeof event.completed === "function") event.completed();
      }
    };
  }

  const tidyCells = commandHandler(() => runCompact(true), "Tidying...");
  const expandCells = commandHandler(() => runCompact(false), "Expanding...");
  const extractImage = commandHandler(runExtractImage, "Reading the picture...");
  const askPicture = commandHandler(runAskPicture, "Reading the picture...");
  const answerCells = commandHandler(runAnswerCells, "Answering...");

  // One click report you can paste to whoever is helping you. Never includes the access code or token.
  async function runDiagnostics(testModel) {
    const lines = [];
    const add = (ok, label, detail) => lines.push((ok === true ? "PASS" : ok === false ? "FAIL" : "INFO") + "  " + label + (detail ? "  " + detail : ""));
    const req = root.Office && Office.context && Office.context.requirements;
    const diag = (root.Office && Office.context && Office.context.diagnostics) || {};
    add(null, "Host", [diag.host, diag.platform, diag.version].filter(Boolean).join(" "));
    [["ExcelApi", "1.1"], ["ExcelApi", "1.9"], ["ExcelApi", "1.10"], ["SharedRuntime", "1.1"], ["CustomFunctionsRuntime", "1.1"]].forEach((s) => {
      let ok = false;
      try {
        ok = Boolean(req && req.isSetSupported(s[0], s[1]));
      } catch {
        /* treated as unsupported */
      }
      add(ok, s[0] + " " + s[1]);
    });
    add(typeof CustomFunctions !== "undefined", "CustomFunctions runtime is present (FORMULR.ANSWER can register)");
    add(AI.associated === true, "FORMULR.ANSWER is registered with Excel", AI.associated === true ? "" : "if this fails, click Home, Add-ins, My Add-ins, Formulr, then reopen the workbook");
    add(null, "Page address", typeof location !== "undefined" ? location.origin : "unknown");
    try {
      const res = await fetch((AI.base || (typeof location !== "undefined" ? location.origin : "")) + "/health");
      const body = await res.json();
      add(res.ok && body.configured === true, "Service health and secrets configured", "version " + body.version + ", configured=" + body.configured);
    } catch {
      add(false, "Service health", "could not reach the service");
    }
    add(AI.isUnlocked(), AI.isUnlocked() ? "Unlocked" : "Locked (enter the access code, then run again)");
    // Says only whether a key is saved and for which provider, never the key.
    const k = AI.userKey && AI.userKey();
    add(Boolean(k) || AI.role === "owner", k ? "Own AI key saved (" + k.provider + ")" : AI.role === "owner" ? "Owner pass, using the service key" : "No AI key saved (add yours in the pane)");
    if (testModel) {
      if (!AI.isUnlocked()) {
        add(false, "Model test", "skipped because it is locked");
      } else {
        try {
          const started = Date.now();
          const answer = await AI.functions.ask("Reply with exactly the word OK.", "connectivity check " + started);
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          add(/\bOK\b/i.test(answer), "Model test (1 call, " + secs + " s)", JSON.stringify(String(answer).slice(0, 60)) + (AI.lastTiming ? " | server " + AI.lastTiming : "") + (secs > 6 ? " (slow: send this report)" : ""));
        } catch (err) {
          add(false, "Model test (1 call)", err.message);
        }
      }
    }
    return lines.join("\n");
  }

  async function onDiagnostics(testModel) {
    const out = $("report");
    if (!out) return;
    out.textContent = "Running checks...";
    out.textContent = await runDiagnostics(testModel);
  }

  async function onCopyReport() {
    const out = $("report");
    if (!out || !out.textContent) return;
    try {
      await navigator.clipboard.writeText(out.textContent);
      setStatus("Report copied.", "ok");
    } catch {
      setStatus("Select the report text and copy it with Ctrl+C.", "");
    }
  }

  // Where a second laptop gets the add-in. Uses the clipboard when the host allows it, and a hidden text box otherwise.
  const installLink = () => ((root.location && root.location.origin) || AI.base || "") + "/install";

  async function copyText(text) {
    try {
      if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to the older way */
    }
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(box);
      return ok === true;
    } catch {
      return false;
    }
  }

  async function onCopyInstallLink() {
    const link = installLink();
    setStatus((await copyText(link)) ? "Install link copied. Open it on the other laptop: " + link : "Could not copy. Open this link on the other laptop: " + link, "ok");
  }

  if (root.Office && Office.actions && Office.actions.associate) {
    Office.actions.associate("extractImage", extractImage);
    Office.actions.associate("askPicture", askPicture);
    Office.actions.associate("answerCells", answerCells);
    Office.actions.associate("tidyCells", tidyCells);
    Office.actions.associate("expandCells", expandCells);
  }

  // Buttons are wired immediately so Unlock always works, even if Office.js is slow or blocked.
  function wireUi() {
    $("unlock").addEventListener("click", onUnlock);
    if ($("save-key")) $("save-key").addEventListener("click", onSaveKey);
    if ($("remove-key"))
      $("remove-key").addEventListener("click", () => {
        AI.clearUserKey();
        setStatus("Key removed from this device.", "");
        updateKeyUi();
      });
    updateKeyUi();
    $("code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") onUnlock();
    });
    $("run-answer").addEventListener("click", () => askPicture(null));
    if ($("paste-zone")) $("paste-zone").addEventListener("paste", onPasteImage);
    if ($("copy-link")) $("copy-link").addEventListener("click", onCopyInstallLink);
    if ($("install-link")) $("install-link").textContent = installLink();
    $("lock").addEventListener("click", () => {
      AI.lock();
      updateLockUi();
      setStatus("Locked. This device no longer remembers the access code.", "");
    });
    $("run-checks").addEventListener("click", () => onDiagnostics(false));
    $("test-ai").addEventListener("click", () => onDiagnostics(true));
    if ($("speed-test")) $("speed-test").addEventListener("click", async () => {
      const out = $("report");
      if (!out) return;
      out.textContent = "Running 6 questions at once...";
      try {
        out.textContent = await runSpeedTest(6);
      } catch (err) {
        out.textContent = err.message || "Speed test failed.";
      }
    });
    $("copy-report").addEventListener("click", onCopyReport);
    updateLockUi();
  }

  function warn(message) {
    const banner = $("banner");
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }

  function boot() {
    wireUi();
    const hasOffice = Boolean(root.Office && Office.onReady);
    if (typeof console !== "undefined") console.info("[Formulr] boot", { officeLoaded: hasOffice, customFunctions: typeof CustomFunctions !== "undefined", origin: root.location && root.location.origin });
    if (!hasOffice) {
      warn("Office.js did not load" + (root.__formulrOfficeFallback ? " (both Microsoft addresses failed)" : "") + ", so the formulas and picture buttons cannot work yet. Unlocking still works. A network filter, VPN or browser extension may be blocking Microsoft's script. Try another network or browser, then press Run checks and send the report.");
      setStatus("Ready, but Excel features are unavailable.", "error");
      return;
    }
    let ready = false;
    Office.onReady(function (info) {
      ready = true;
      const banner = $("banner");
      if (banner) banner.hidden = true; // Excel finished late: the warning no longer applies
      const inExcel = info && info.host === Office.HostType.Excel;
      setStatus(inExcel ? "Ready. Enter your access code to unlock." : "Open this inside Excel.", inExcel ? "" : "error");
      if (inExcel) keepLoaded();
    });
    setTimeout(() => {
      if (!ready) warn("Excel has not finished starting this add-in. Close and reopen the pane. If this stays, press Run checks and send the report.");
    }, root.AIHelperReadyTimeoutMs || 15000);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  AI.app = { clickWaitMs: 20000, onPasteImage: onPasteImage, answerImageData: answerImageData, shrinkImage: shrinkImage, keepLoaded: keepLoaded, runSpeedTest: runSpeedTest, runCompact: runCompact, copyText: copyText, installLink: installLink, runExtractImage: runExtractImage, runAskPicture: runAskPicture, runAnswerCells: runAnswerCells, runDiagnostics: runDiagnostics };
})(typeof globalThis !== "undefined" ? globalThis : this);
