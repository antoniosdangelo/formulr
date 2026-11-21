import test from "node:test";
import assert from "node:assert/strict";

// Functions must be registered with Excel even when Excel's CustomFunctions object shows up after the script loads.
test("association is retried until Excel's CustomFunctions object appears", async () => {
  const seen = [];
  setTimeout(() => {
    globalThis.CustomFunctions = { associate: (id) => seen.push(id), Error: class {}, ErrorCode: {} };
  }, 250);
  await import("../../frontend/public/functions.js");
  const AI = globalThis.AIHelper;
  assert.equal(AI.associated, undefined, "not registered yet, Excel's object is not there");
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(seen.sort(), ["ANSWER"]);
  assert.equal(AI.associated, true);
  assert.equal(AI.associateNow(), true);
  assert.equal(seen.length, 1, "never registered twice");
});
