import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, runTool, TOOLS } from "../src/calc.js";

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const out = (name, input) => JSON.parse(runTool(name, input).content);

test("the expression parser follows the usual rules and refuses anything else", () => {
  assert.equal(evaluate("1+2*3"), 7);
  assert.equal(evaluate("(1+2)*3"), 9);
  assert.equal(evaluate("-2^2"), -4);
  assert.equal(evaluate("2^3^2"), 512);
  assert.equal(evaluate("10/4"), 2.5);
  assert.equal(evaluate("sqrt(16) + pow(2, 3)"), 12);
  assert.equal(evaluate("round(2.34567, 3)"), 2.346);
  assert.equal(evaluate("$1,250.50 * 2"), 2501);
  assert.ok(near(evaluate("1.2*0.12+1.4*0.22+3.3*0.14+0.6*0.8+1.05"), 2.444));
  for (const bad of ["", "1/0", "process.exit()", "constructor", "1 +", "((1)", "1 2", "foo(1)", "x".repeat(600), "1; 2", "`a`", "__proto__"]) {
    assert.throws(() => evaluate(bad), undefined, bad);
  }
});

test("T-bill yields: face and 360 for discount, price and 365 for bond equivalent", () => {
  const r = out("tbill_yields", { face: 250000, price: 243750, days: 182 });
  assert.equal(r.bank_discount_yield_pct.toFixed(2), "4.95");
  assert.equal(r.bond_equivalent_yield_pct.toFixed(2), "5.14");
  assert.equal(runTool("tbill_yields", { face: 100, price: 0, days: 90 }).is_error, true);
});

test("interpolation, taxable equivalent yield and the duration convexity price change", () => {
  const i = out("interpolate", { x: 8.5, x1: 7, y1: 3.12, x2: 10, y2: 3.42 });
  assert.ok(near(i.weight, 0.5) && near(i.value, 3.27) && i.between_points === true);
  assert.equal(Math.round((6.18 - i.value) * 100), 291);
  assert.equal(out("interpolate", { x: 12, x1: 7, y1: 3, x2: 10, y2: 4 }).between_points, false);
  assert.equal(out("taxable_equivalent_yield", { tax_exempt_yield_pct: 3.36, tax_rate_pct: 28 }).taxable_equivalent_yield_pct.toFixed(2), "4.67");
  const p = out("price_change", { price: 1000, modified_duration: 7.2, convexity: 65, yield_change_bps: 75 });
  assert.ok(near(p.new_value_duration_only, 946) && near(p.new_value_including_convexity, 947.828125));
  assert.equal(runTool("taxable_equivalent_yield", { tax_exempt_yield_pct: 3, tax_rate_pct: 100 }).is_error, true);
});

test("bad tool calls come back as readable errors instead of throwing", () => {
  assert.equal(runTool("nope", {}).is_error, true);
  assert.equal(runTool("calc", null).is_error, true);
  assert.equal(runTool("interpolate", { x: "a" }).is_error, true);
  assert.deepEqual(TOOLS.map((t) => t.name), ["calc", "tbill_yields", "interpolate", "taxable_equivalent_yield", "bond_price", "bond_ytm", "bond_duration", "forward_rate", "weighted_average", "ips_check", "price_change"]);
});

test("portfolio duration and convexity: the dollar loss including convexity is smaller than duration alone", () => {
  const r = out("price_change", { price: 8000000, modified_duration: 6, convexity: 50, yield_change_bps: 100 });
  assert.equal(r.value_change_duration_only, -480000);
  assert.equal(r.value_change_convexity_adjustment, 20000);
  assert.equal(r.value_change_including_convexity, -460000);
  assert.equal(r.duration_effect_pct, -6);
  assert.equal(r.convexity_adjustment_pct, 0.25);
  assert.equal(out("price_change", { price: 8000000, modified_duration: 6, convexity: 50, yield_change_bps: -100 }).value_change_including_convexity, 500000);
});

test("bond price, YTM, duration, convexity and forward rate", () => {
  assert.ok(near(out("bond_price", { coupon_rate_pct: 9, ytm_pct: 9, years: 5 }).price, 100, 1e-9), "a par bond prices at par");
  const cheap = out("bond_price", { coupon_rate_pct: 6, ytm_pct: 8, years: 10 }).price;
  assert.ok(cheap < 100 && cheap > 85);
  assert.ok(near(out("bond_ytm", { price: cheap, coupon_rate_pct: 6, years: 10 }).ytm_pct, 8, 1e-6), "YTM undoes the price");
  assert.equal(runTool("bond_ytm", { price: 1e9, coupon_rate_pct: 6, years: 10 }).is_error, true);
  const d = out("bond_duration", { coupon_rate_pct: 9, ytm_pct: 9, years: 5 });
  assert.ok(near(d.macaulay_duration_years, 4.134, 6e-4) && near(d.modified_duration, 3.956, 6e-4));
  // convexity against a finite difference of the price
  const P = (y) => out("bond_price", { coupon_rate_pct: 9, ytm_pct: y, years: 5 }).price;
  const h = 0.01;
  const numeric = (P(9 + h) + P(9 - h) - 2 * P(9)) / (P(9) * (h / 100) ** 2);
  assert.ok(near(d.convexity, numeric, 0.05), d.convexity + " vs " + numeric);
  const f = out("forward_rate", { spot1_pct: 4, t1: 1, spot2_pct: 5, t2: 2 });
  assert.ok(near(f.forward_rate_pct, ((1.05 ** 2) / 1.04 - 1) * 100, 1e-9));
  assert.equal(runTool("forward_rate", { spot1_pct: 4, t1: 2, spot2_pct: 5, t2: 1 }).is_error, true);
  assert.equal(runTool("bond_price", { coupon_rate_pct: 6, ytm_pct: 5, years: 2.3 }).is_error, true);
});

test("weighted average duration of a portfolio, with percent or decimal weights", () => {
  const a = out("weighted_average", { weights: [52, 18, 18, 12], values: [5, 7, 4, 6] });
  assert.equal(a.weighted_average, 5.3);
  assert.deepEqual(a.contributions, [2.6, 1.26, 0.72, 0.72]);
  assert.equal(a.weights_add_to_whole, true);
  assert.equal(out("weighted_average", { weights: [0.52, 0.18, 0.18, 0.12], values: [5, 7, 4, 6] }).weighted_average, 5.3);
  assert.equal(out("weighted_average", { weights: [50, 30], values: [5, 7] }).weights_add_to_whole, false);
  assert.equal(runTool("weighted_average", { weights: [1, 2], values: [1] }).is_error, true);
  assert.equal(runTool("weighted_average", { weights: [0, 0], values: [1, 2] }).is_error, true);
  assert.equal(runTool("weighted_average", { weights: "x", values: [1] }).is_error, true);
});

test("IPS check: your question 2 is compliant with the manager target met, and the traps are handled", () => {
  const base = [
    { name: "duration", actual: 5.3, min: 4, max: 8, type: "hard" },
    { name: "manager duration target", actual: 5.3, min: 4.5, max: 5.5, type: "target" },
    { name: "investment grade share", actual: 82, min: 80, type: "hard" },
    { name: "foreign allocation", actual: 30, max: 30, type: "hard" },
    { name: "emerging markets", actual: 12, max: 15, type: "hard" },
  ];
  const ok = out("ips_check", { constraints: base });
  assert.equal(ok.classification, "Compliant, all targets met");
  assert.deepEqual(ok.hard_failures, []);
  assert.equal(ok.rows.find((r) => r.name === "foreign allocation").at_limit, true, "exactly at the limit passes");
  const missed = out("ips_check", { constraints: base.map((c) => (c.name === "manager duration target" ? { ...c, actual: 5.6 } : c)) });
  assert.equal(missed.classification, "Missed Target (compliant with policy)");
  const violation = out("ips_check", { constraints: base.map((c) => (c.name === "foreign allocation" ? { ...c, actual: 30.5 } : c.name === "manager duration target" ? { ...c, actual: 5.6 } : c)) });
  assert.equal(violation.classification, "Violation", "a hard failure outranks a missed target");
  assert.deepEqual(violation.hard_failures, ["foreign allocation"]);
  assert.equal(runTool("ips_check", { constraints: [] }).is_error, true);
  assert.equal(runTool("ips_check", { constraints: [{ name: "x", actual: 1 }] }).is_error, true);
});
