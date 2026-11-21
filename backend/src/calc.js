// Exact, deterministic maths the model can call instead of doing arithmetic in its head.
// No eval: expressions go through a small parser that only knows numbers, + - * / ^, brackets and a few functions.

const FUNCTIONS = {
  sqrt: (x) => Math.sqrt(x),
  ln: (x) => Math.log(x),
  log10: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  abs: (x) => Math.abs(x),
  pow: (a, b) => Math.pow(a, b),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (x, n = 0) => {
    const k = 10 ** n;
    return Math.round((x + Number.EPSILON * Math.sign(x)) * k) / k;
  },
};
const CONSTANTS = { pi: Math.PI, e: Math.E };

export function evaluate(expression) {
  const src = String(expression ?? "").replace(/,(?=\d{3}(\D|$))/g, "").replace(/[$%]/g, "");
  if (src.length === 0 || src.length > 500) throw new Error("expression must be 1 to 500 characters");
  const tokens = [];
  const re = /\s*(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|\S)/gy;
  let m;
  let used = 0;
  while ((m = re.exec(src)) !== null) {
    used = re.lastIndex;
    tokens.push(m[1]);
  }
  if (src.slice(used).trim() !== "") throw new Error("unexpected character");
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const expect = (t) => {
    if (take() !== t) throw new Error("expected " + t);
  };
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + parseTerm() : v - parseTerm();
    return v;
  }
  function parseTerm() {
    let v = parseUnary();
    while (peek() === "*" || peek() === "/") {
      if (take() === "*") v *= parseUnary();
      else {
        const d = parseUnary();
        if (d === 0) throw new Error("division by zero");
        v /= d;
      }
    }
    return v;
  }
  function parseUnary() {
    if (peek() === "-") {
      take();
      return -parseUnary();
    }
    if (peek() === "+") {
      take();
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (peek() === "^") {
      take();
      return Math.pow(base, parseUnary()); // right associative
    }
    return base;
  }
  function parseAtom() {
    const t = take();
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const v = parseExpr();
      expect(")");
      return v;
    }
    if (/^[\d.]/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      const name = t.toLowerCase();
      if (peek() === "(") {
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error("unknown function " + t);
        take();
        const args = [];
        if (peek() !== ")") {
          args.push(parseExpr());
          while (peek() === ",") {
            take();
            args.push(parseExpr());
          }
        }
        expect(")");
        return fn(...args);
      }
      if (name in CONSTANTS) return CONSTANTS[name];
      throw new Error("unknown name " + t);
    }
    throw new Error("unexpected " + t);
  }
  const value = parseExpr();
  if (i !== tokens.length) throw new Error("unexpected " + tokens[i]);
  if (!Number.isFinite(value)) throw new Error("result is not a finite number");
  return value;
}

const fmt = (x) => Number(x.toPrecision(12));
const num = (v, name) => {
  const x = typeof v === "string" ? Number(v.replace(/[,$%\s]/g, "")) : v;
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(name + " must be a number");
  return x;
};


function bondInputs(a) {
  const face = a.face === undefined ? 100 : num(a.face, "face");
  const c = num(a.coupon_rate_pct, "coupon_rate_pct") / 100;
  const y = num(a.ytm_pct, "ytm_pct") / 100;
  const years = num(a.years, "years");
  const f = a.payments_per_year === undefined ? 2 : num(a.payments_per_year, "payments_per_year");
  if (face <= 0 || years <= 0 || ![1, 2, 4, 12].includes(f)) throw new Error("face and years must be positive and payments_per_year 1, 2, 4 or 12");
  const n = Math.round(years * f);
  if (Math.abs(n - years * f) > 1e-9 || n < 1) throw new Error("years times payments_per_year must be a whole number");
  return { face, c, y, f, n };
}

function priceAt(b, y) {
  let pv = 0;
  for (let k = 1; k <= b.n; k++) pv += (b.face * b.c / b.f + (k === b.n ? b.face : 0)) / (1 + y / b.f) ** k;
  return pv;
}

const TOOL_IMPLS = {
  calc: (a) => {
    const v = evaluate(a.expression);
    return { result: fmt(v), rounded_2dp: Number(v.toFixed(2)), rounded_4dp: Number(v.toFixed(4)) };
  },
  tbill_yields: (a) => {
    const F = num(a.face, "face");
    const t = num(a.days, "days");
    let P;
    if (a.price !== undefined && a.price !== null) P = num(a.price, "price");
    else if (a.discount_yield_pct !== undefined && a.discount_yield_pct !== null) P = F * (1 - (num(a.discount_yield_pct, "discount_yield_pct") / 100) * (t / 360));
    else throw new Error("give either price or discount_yield_pct");
    if (F <= 0 || P <= 0 || t <= 0) throw new Error("face, price and days must be positive");
    return {
      price: fmt(P),
      bank_discount_yield_pct: fmt(((F - P) / F) * (360 / t) * 100),
      bond_equivalent_yield_pct: fmt(((F - P) / P) * (365 / t) * 100),
      note: "discount yield uses face value and 360 days; bond equivalent yield uses price and 365 days. Give discount_yield_pct instead of price to price the bill from its discount yield.",
    };
  },
  interpolate: (a) => {
    const x = num(a.x, "x");
    const x1 = num(a.x1, "x1");
    const y1 = num(a.y1, "y1");
    const x2 = num(a.x2, "x2");
    const y2 = num(a.y2, "y2");
    if (x1 === x2) throw new Error("x1 and x2 must differ");
    const w = (x - x1) / (x2 - x1);
    return { weight: fmt(w), value: fmt(y1 + w * (y2 - y1)), between_points: w >= 0 && w <= 1 };
  },
  taxable_equivalent_yield: (a) => {
    const y = num(a.tax_exempt_yield_pct, "tax_exempt_yield_pct");
    const t = num(a.tax_rate_pct, "tax_rate_pct");
    if (t < 0 || t >= 100) throw new Error("tax rate must be from 0 to under 100");
    return { taxable_equivalent_yield_pct: fmt(y / (1 - t / 100)), after_tax_yield_of_taxable_bond_pct_formula: "taxable yield x (1 - tax rate)" };
  },
  bond_price: (a) => {
    const b = bondInputs(a);
    return { price: fmt(priceAt(b, b.y)), note: "price per face value given; periodic coupon and yield are annual rate divided by payments per year" };
  },
  bond_ytm: (a) => {
    const b = bondInputs({ ...a, ytm_pct: 0 });
    const P = num(a.price, "price");
    if (P <= 0) throw new Error("price must be positive");
    let lo = -0.99;
    let hi = 5;
    if (priceAt(b, lo) < P || priceAt(b, hi) > P) throw new Error("no yield found for that price");
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (priceAt(b, mid) > P) lo = mid;
      else hi = mid;
    }
    return { ytm_pct: fmt(((lo + hi) / 2) * 100), note: "annual yield quoted as a nominal rate with the same payments per year as the coupon" };
  },
  bond_duration: (a) => {
    const b = bondInputs(a);
    const periods = b.n;
    let pv = 0;
    let w = 0;
    let c2 = 0;
    for (let k = 1; k <= periods; k++) {
      const cf = b.face * b.c / b.f + (k === periods ? b.face : 0);
      const v = cf / (1 + b.y / b.f) ** k;
      pv += v;
      w += k * v;
      c2 += k * (k + 1) * v;
    }
    const mac = w / pv / b.f;
    return {
      price: fmt(pv),
      macaulay_duration_years: fmt(mac),
      modified_duration: fmt(mac / (1 + b.y / b.f)),
      convexity: fmt(c2 / (pv * (1 + b.y / b.f) ** 2 * b.f * b.f)),
      note: "durations in years, convexity in the usual annualized units used with dP/P = -D x dy + 0.5 x C x dy^2",
    };
  },
  forward_rate: (a) => {
    const s1 = num(a.spot1_pct, "spot1_pct") / 100;
    const t1 = num(a.t1, "t1");
    const s2 = num(a.spot2_pct, "spot2_pct") / 100;
    const t2 = num(a.t2, "t2");
    if (t2 <= t1 || t1 < 0) throw new Error("t2 must be later than t1");
    const f = t1 === 0 ? s2 : ((1 + s2) ** t2 / (1 + s1) ** t1) ** (1 / (t2 - t1)) - 1;
    return { forward_rate_pct: fmt(f * 100), note: "annual compounding: (1+s2)^t2 = (1+s1)^t1 x (1+f)^(t2-t1)" };
  },
  weighted_average: (a) => {
    const w = Array.isArray(a.weights) ? a.weights.map((x) => num(x, "weight")) : null;
    const v = Array.isArray(a.values) ? a.values.map((x) => num(x, "value")) : null;
    if (!w || !v || w.length === 0 || w.length !== v.length || w.length > 200) throw new Error("weights and values must be lists of the same length");
    const total = w.reduce((x, y) => x + y, 0);
    if (total <= 0) throw new Error("weights must add to a positive number");
    const asPercent = total > 1.5;
    const sumProduct = w.reduce((acc, x, i) => acc + x * v[i], 0);
    return {
      weighted_average: fmt(sumProduct / total),
      weights_sum: fmt(total),
      weights_look_like: asPercent ? "percent (add to about 100)" : "decimals (add to about 1)",
      weights_add_to_whole: Math.abs(total - (asPercent ? 100 : 1)) < 1e-6,
      contributions: w.map((x, i) => fmt((x / total) * v[i])),
      note: "weights are converted by dividing by their sum, so 52 and 0.52 give the same result; if weights_add_to_whole is false, tell the question's author nothing but still use this result",
    };
  },
  ips_check: (a) => {
    const list = Array.isArray(a.constraints) ? a.constraints : null;
    if (!list || list.length === 0 || list.length > 50) throw new Error("constraints must be a list of 1 to 50 items");
    const eps = 1e-9;
    const rows = list.map((c, i) => {
      const name = String(c?.name ?? "constraint " + (i + 1)).slice(0, 80);
      const actual = num(c?.actual, name + " actual");
      const hasMin = c?.min !== undefined && c?.min !== null;
      const hasMax = c?.max !== undefined && c?.max !== null;
      if (!hasMin && !hasMax) throw new Error(name + " needs a min, a max or both");
      const min = hasMin ? num(c.min, name + " min") : -Infinity;
      const max = hasMax ? num(c.max, name + " max") : Infinity;
      const kind = c?.type === "target" ? "target" : "hard";
      const pass = actual >= min - eps && actual <= max + eps;
      return { name, kind, actual, allowed: (hasMin ? min : "no minimum") + " to " + (hasMax ? max : "no maximum"), pass, at_limit: pass && (Math.abs(actual - min) < eps || Math.abs(actual - max) < eps) };
    });
    const hardFail = rows.filter((r) => r.kind === "hard" && !r.pass);
    const targetFail = rows.filter((r) => r.kind === "target" && !r.pass);
    const classification = hardFail.length > 0 ? "Violation" : targetFail.length > 0 ? "Missed Target (compliant with policy)" : "Compliant, all targets met";
    return {
      classification,
      hard_failures: hardFail.map((r) => r.name),
      target_failures: targetFail.map((r) => r.name),
      rows,
      note: "A limit that is exactly met passes. A target written as 5.0 +/- 0.5 means min 4.5 and max 5.5. A hard policy failure outranks a missed manager target.",
    };
  },
  price_change: (a) => {
    const P = num(a.price, "price");
    const D = num(a.modified_duration, "modified_duration");
    const C = a.convexity === undefined ? 0 : num(a.convexity, "convexity");
    const dy = num(a.yield_change_bps, "yield_change_bps") / 10000;
    const dur = -D * dy;
    const both = dur + 0.5 * C * dy * dy;
    return {
      duration_effect_pct: fmt(dur * 100),
      convexity_adjustment_pct: fmt(0.5 * C * dy * dy * 100),
      pct_change_with_convexity: fmt(both * 100),
      value_change_duration_only: fmt(P * dur),
      value_change_convexity_adjustment: fmt(P * 0.5 * C * dy * dy),
      value_change_including_convexity: fmt(P * both),
      new_value_duration_only: fmt(P * (1 + dur)),
      new_value_including_convexity: fmt(P * (1 + both)),
      note: "dP/P = -D x dy + 0.5 x C x dy^2 with dy as a decimal (75 bps = 0.0075). The convexity term is always positive, so a yield rise loses LESS than duration alone. When a question says including convexity, use value_change_including_convexity, never the duration only figure. Price or portfolio value can be passed as price.",
    };
  },
};

export const TOOLS = [
  {
    name: "calc",
    description: "Exact arithmetic. Use it for every sum, product, ratio, power or root instead of working in your head. Supports + - * / ^, brackets, sqrt, ln, exp, abs, pow, min, max, round(x, n).",
    input_schema: { type: "object", properties: { expression: { type: "string", description: "For example 1.2*0.12 + 1.4*0.22 + 3.3*0.14 + 0.6*0.8 + 1.05" } }, required: ["expression"] },
  },
  {
    name: "tbill_yields",
    description: "Treasury bill price, bank discount yield and bond equivalent yield from face value, days to maturity and either the price or the discount yield.",
    input_schema: { type: "object", properties: { face: { type: "number" }, price: { type: "number" }, discount_yield_pct: { type: "number" }, days: { type: "number" } }, required: ["face", "days"] },
  },
  {
    name: "interpolate",
    description: "Linear interpolation, for example a Treasury yield at a maturity between two listed maturities.",
    input_schema: { type: "object", properties: { x: { type: "number" }, x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } }, required: ["x", "x1", "y1", "x2", "y2"] },
  },
  {
    name: "taxable_equivalent_yield",
    description: "Taxable equivalent yield of a tax exempt bond: yield divided by (1 minus the tax rate). Percent inputs.",
    input_schema: { type: "object", properties: { tax_exempt_yield_pct: { type: "number" }, tax_rate_pct: { type: "number" } }, required: ["tax_exempt_yield_pct", "tax_rate_pct"] },
  },
  {
    name: "bond_price",
    description: "Price of a fixed coupon bond from face value (default 100), annual coupon rate, yield to maturity and years. Payments per year default to 2 (semiannual).",
    input_schema: { type: "object", properties: { face: { type: "number" }, coupon_rate_pct: { type: "number" }, ytm_pct: { type: "number" }, years: { type: "number" }, payments_per_year: { type: "number" } }, required: ["coupon_rate_pct", "ytm_pct", "years"] },
  },
  {
    name: "bond_ytm",
    description: "Yield to maturity from a bond's price. Payments per year default to 2 (semiannual).",
    input_schema: { type: "object", properties: { price: { type: "number" }, face: { type: "number" }, coupon_rate_pct: { type: "number" }, years: { type: "number" }, payments_per_year: { type: "number" } }, required: ["price", "coupon_rate_pct", "years"] },
  },
  {
    name: "bond_duration",
    description: "Macaulay duration, modified duration, convexity and price of a fixed coupon bond. Payments per year default to 2.",
    input_schema: { type: "object", properties: { face: { type: "number" }, coupon_rate_pct: { type: "number" }, ytm_pct: { type: "number" }, years: { type: "number" }, payments_per_year: { type: "number" } }, required: ["coupon_rate_pct", "ytm_pct", "years"] },
  },
  {
    name: "forward_rate",
    description: "Implied forward rate between two maturities from two spot rates, annual compounding.",
    input_schema: { type: "object", properties: { spot1_pct: { type: "number" }, t1: { type: "number" }, spot2_pct: { type: "number" }, t2: { type: "number" } }, required: ["spot1_pct", "t1", "spot2_pct", "t2"] },
  },
  {
    name: "weighted_average",
    description: "Weighted average of values, for example portfolio duration, yield, credit quality or beta from weights and values. Weights can be percents (52) or decimals (0.52). Returns each contribution too.",
    input_schema: { type: "object", properties: { weights: { type: "array", items: { type: "number" } }, values: { type: "array", items: { type: "number" } } }, required: ["weights", "values"] },
  },
  {
    name: "ips_check",
    description: "Checks a portfolio against investment policy statement rules. Each constraint has a name, the actual value, a min and/or max, and a type: hard for binding policy limits, target for a manager's target range. A range written as 5.0 +/- 0.5 is min 4.5 and max 5.5. Exactly meeting a limit passes. Returns pass or fail for each and the overall classification (Violation, Missed Target, or compliant). Compute category totals first, for example foreign = developed + emerging, investment grade = every investment grade holding.",
    input_schema: { type: "object", properties: { constraints: { type: "array", items: { type: "object", properties: { name: { type: "string" }, actual: { type: "number" }, min: { type: "number" }, max: { type: "number" }, type: { type: "string", enum: ["hard", "target"] } }, required: ["name", "actual"] } } }, required: ["constraints"] },
  },
  {
    name: "price_change",
    description: "Approximate bond or portfolio value change from modified duration and optional convexity for a yield change in basis points. Returns the duration effect and the convexity adjustment separately, then the combined change in percent and in value.",
    input_schema: { type: "object", properties: { price: { type: "number", description: "Bond price or total portfolio market value" }, modified_duration: { type: "number" }, convexity: { type: "number" }, yield_change_bps: { type: "number", description: "Positive when yields rise" } }, required: ["price", "modified_duration", "yield_change_bps"] },
  },
];

// Always returns a string for the tool_result; errors come back as text so the model can correct its call.
export function runTool(name, input) {
  const impl = TOOL_IMPLS[name];
  if (!impl) return { is_error: true, content: "Unknown tool " + String(name).slice(0, 40) };
  try {
    return { is_error: false, content: JSON.stringify(impl(input && typeof input === "object" ? input : {})) };
  } catch (err) {
    return { is_error: true, content: "Error: " + String(err.message || err).slice(0, 200) };
  }
}
