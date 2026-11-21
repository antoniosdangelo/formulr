// Post deploy check: node scripts/smoke.mjs https://excel-ai-helper.<your-subdomain>.workers.dev
// Reads only public routes. It never sends your access code or any AI request.
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/smoke.mjs <base url>");
  process.exit(2);
}
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};
const get = (p, init) => fetch(base + p, { redirect: "manual", ...init });

const health = await (await get("/health")).json();
check(health.status === "ok", "health responds");
check(health.configured === true, "secrets are set (an AI key and APP_PASSWORD)", "configured=" + health.configured);
check(health.provider === "anthropic" || health.provider === "gemini", "AI provider in use: " + (health.provider === "anthropic" ? "Anthropic (Claude)" : health.provider === "gemini" ? "Google Gemini" : "none"), "provider=" + health.provider);

const manifest = await get("/manifest.xml");
const xml = await manifest.text();
check(manifest.status === 200 && /xml/.test(manifest.headers.get("content-type") ?? ""), "manifest.xml served as XML");
check(xml.includes(base + "/taskpane.html"), "manifest points at this deployment");

for (const p of ["/taskpane.html", "/functions.js", "/functions.json", "/app.js", "/styles.css", "/icon-16.png", "/icon-32.png", "/icon-80.png"]) {
  const r = await get(p);
  check(r.status === 200, `${p} returns 200 with no redirect`, "status=" + r.status);
}

const pane = await get("/taskpane.html");
const csp = pane.headers.get("content-security-policy") ?? "";
check(/frame-ancestors[^;]*\*\.cloud\.microsoft/.test(csp), "CSP lets Excel (cloud.microsoft) frame the pane");
check(/frame-ancestors[^;]*\*\.officeapps\.live\.com/.test(csp), "CSP lets Office on the web frame the pane");
check(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), "CSP does not allow inline or eval scripts");

const noAuth = await get("/api/ai", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: "{}" });
check(noAuth.status === 401, "AI endpoint refuses requests without a token", "status=" + noAuth.status);
const evil = await get("/api/ai", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check(evil.status === 403, "AI endpoint refuses foreign origins", "status=" + evil.status);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
