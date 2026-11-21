/* One click self-test that runs inside the real Excel. It adds a temporary sheet, exercises every formula and both
 * picture buttons, reports PASS or FAIL per step, then deletes the sheet. It uses 6 AI calls and never touches your sheets.
 */
(function (root) {
  "use strict";

  const AI = root.AIHelper;
  const SHEET = "Formulr Self Test";
  const PENDING = /^#(BUSY|GETTING_DATA|CALC)/i;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const has = (value, needle) => String(value === null || value === undefined ? "" : value).toLowerCase().includes(String(needle).toLowerCase());
  const isPending = (value) => value === "" || value === null || value === undefined || PENDING.test(String(value));

  // A small table drawn with the browser's canvas, so the self-test needs no files.
  function renderTable() {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 150;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 360, 150);
    g.fillStyle = "#000000";
    g.strokeStyle = "#000000";
    g.lineWidth = 2;
    g.strokeRect(5, 5, 350, 140);
    g.beginPath();
    g.moveTo(5, 52);
    g.lineTo(355, 52);
    g.moveTo(200, 5);
    g.lineTo(200, 145);
    g.stroke();
    g.font = "bold 28px Arial";
    g.fillText("Item", 20, 40);
    g.fillText("Qty", 220, 40);
    g.font = "28px Arial";
    g.fillText("Pen", 20, 88);
    g.fillText("2", 220, 88);
    g.fillText("Cup", 20, 130);
    g.fillText("5", 220, 130);
    return canvas.toDataURL("image/png").split(",")[1];
  }

  async function run(options) {
    const opts = options || {};
    const makePng = opts.makePng || renderTable;
    const timeoutMs = opts.timeoutMs || 60000;
    const pollMs = opts.pollMs === undefined ? 1500 : opts.pollMs;
    const results = [];
    const add = (ok, label, detail) => {
      results.push({ ok: ok, label: label, detail: detail || "" });
      if (opts.onStep) opts.onStep(results.slice());
    };

    if (!AI.isUnlocked()) {
      add(false, "Unlock first", AI.LOCKED);
      return results;
    }
    if (!(root.Office && Office.context && Office.context.requirements.isSetSupported("ExcelApi", "1.10"))) {
      add(false, "Excel version", "needs Excel API 1.10 for the picture steps. Run checks shows what is supported.");
      return results;
    }

    let previousSheet = null;
    const read = async (address) => {
      let values = [];
      await Excel.run(async (ctx) => {
        const range = ctx.workbook.worksheets.getItem(SHEET).getRange(address);
        range.load("values");
        await ctx.sync();
        values = range.values;
      });
      return values;
    };
    // A formula is settled when its cell holds a result or an error.
    const stillPending = (v) => isPending(v[0][0]) || isPending(v[2][0]);
    const readSettled = async (address) => {
      const deadline = Date.now() + timeoutMs;
      let values;
      for (;;) {
        if (pollMs) await sleep(pollMs);
        values = await read(address);
        const pending = stillPending(values);
        if (!pending || Date.now() > deadline) return { values: values, timedOut: pending };
      }
    };
    const explain = (value) =>
      /^#NAME/i.test(String(value)) ? "Excel does not know the AI functions yet. Close and reopen the workbook, then run again." : String(value).slice(0, 120);

    try {
      await Excel.run(async (ctx) => {
        const active = ctx.workbook.worksheets.getActiveWorksheet();
        active.load("name");
        const old = ctx.workbook.worksheets.getItemOrNullObject(SHEET);
        old.load("isNullObject");
        await ctx.sync();
        previousSheet = active.name;
        if (!old.isNullObject) {
          old.delete();
          await ctx.sync();
        }
        const sheet = ctx.workbook.worksheets.add(SHEET);
        sheet.activate();
        sheet.getRange("A1").values = [["Ada Lovelace paid $42 on 2026-10-26"]];
        sheet.getRange("D1:F1").values = [["name", "amount", "date"]];
        sheet.getRange("A3").values = [["What is 40 + 2?"]];
        sheet.getRange("B1").formulas = [['=FORMULR.ANSWER(A1, "Who paid? Reply with just the name.")']];
        sheet.getRange("B3").formulas = [["=FORMULR.ANSWER(A3)"]];
        await ctx.sync();
      });
      add(true, "Temporary test sheet created");

      const formulas = await readSettled("B1:B3");
      const v = formulas.values;
      if (formulas.timedOut) add(false, "Formulas finished in time", "still calculating after " + Math.round(timeoutMs / 1000) + " seconds");
      add(has(v[0][0], "ada"), "=FORMULR.ANSWER with an instruction", has(v[0][0], "ada") ? JSON.stringify(v[0][0]) : explain(v[0][0]));
      const answerOk = has(v[2][0], "42");
      add(answerOk, "=FORMULR.ANSWER gives one short answer", answerOk ? JSON.stringify(v[2][0]) : explain(v[2][0]));

      try {
        await Excel.run(async (ctx) => {
          const sheet = ctx.workbook.worksheets.getItem(SHEET);
          sheet.getRange("A20").values = [["What is 40 + 2?"]];
          sheet.getRange("A20").select();
          await ctx.sync();
        });
        await AI.app.runAnswerCells("Answer with just the number.");
        const row = (await read("B20:C20"))[0];
        const ok = has(row[0], "42") && !isPending(row[1]);
        add(ok, "Answer selected cells (no formula) writes answer and explanation", ok ? JSON.stringify(row) : "wrote: " + JSON.stringify(row));
      } catch (err) {
        add(false, "Answer selected cells (no formula) writes answer and explanation", err.message);
      }

      await Excel.run(async (ctx) => {
        const sheet = ctx.workbook.worksheets.getItem(SHEET);
        const a10 = sheet.getRange("A10");
        a10.load("top,left");
        await ctx.sync();
        const shape = sheet.shapes.addImage(makePng());
        shape.name = "FormulrSelfTestPicture";
        shape.left = a10.left + 1;
        shape.top = a10.top + 1;
        a10.select();
        await ctx.sync();
      });
      add(true, "Test picture placed in A10");

      try {
        const summary = await AI.app.runExtractImage("Extract the table, one row per table row.");
        const table = (await read("B10:C13")).flat().join(" | ");
        const ok = has(table, "pen") && has(table, "cup") && has(table, "2") && has(table, "5");
        add(ok, "Extract image writes the table", ok ? summary : "wrote: " + table.slice(0, 120));
      } catch (err) {
        add(false, "Extract image writes the table", err.message);
      }

      await Excel.run(async (ctx) => {
        ctx.workbook.worksheets.getItem(SHEET).getRange("B10:Z14").clear();
        ctx.workbook.worksheets.getItem(SHEET).getRange("A10").select();
        await ctx.sync();
      });
      try {
        await AI.app.runAskPicture("How many Cups are listed? Answer with just the number.");
        const row = [(await read("B10:Z10"))[0].find((c) => !isPending(c))];
        const ok = has(row[0], "5");
        add(ok, "Ask about picture writes the answer in one cell", ok ? JSON.stringify(row) : "wrote: " + JSON.stringify(row));
      } catch (err) {
        add(false, "Ask about picture writes the answer in one cell", err.message);
      }
    } catch (err) {
      add(false, "Self-test stopped", err.message);
    } finally {
      try {
        await Excel.run(async (ctx) => {
          const sheet = ctx.workbook.worksheets.getItemOrNullObject(SHEET);
          sheet.load("isNullObject");
          await ctx.sync();
          if (!sheet.isNullObject) sheet.delete();
          if (previousSheet) {
            const back = ctx.workbook.worksheets.getItemOrNullObject(previousSheet);
            back.load("isNullObject");
            await ctx.sync();
            if (!back.isNullObject) back.activate();
          }
          await ctx.sync();
        });
        add(true, "Temporary test sheet removed");
      } catch (err) {
        add(false, "Temporary test sheet removed", "delete the sheet named '" + SHEET + "' by hand (" + err.message + ")");
      }
    }
    return results;
  }

  function format(results) {
    const failed = results.filter((r) => !r.ok).length;
    const lines = results.map((r) => (r.ok ? "PASS" : "FAIL") + "  " + r.label + (r.detail ? "  " + r.detail : ""));
    lines.push("", failed ? failed + " step(s) failed. Copy this report and send it to whoever is helping you." : "All steps passed.");
    return lines.join("\n");
  }

  AI.selfTest = { run: run, format: format, renderTable: renderTable };

  if (typeof document !== "undefined") {
    const attach = function () {
      const button = document.getElementById("run-selftest");
      if (!button) return;
      button.addEventListener("click", async () => {
        const out = document.getElementById("report");
        button.disabled = true;
        if (out) out.textContent = "Running the self-test. This takes about a minute...";
        const results = await run({ onStep: (r) => out && (out.textContent = format(r).replace(/\n\n.*$/s, "") + "\n...") });
        if (out) out.textContent = format(results);
        button.disabled = false;
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
    else attach();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
