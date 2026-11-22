import {
  HttpError,
  LIMITS,
  VERSION,
  buildAnthropicBody,
  contradictsItself,
  buildGeminiBody,
  d1Limiter,
  memoryLimiter,
  needsCare,
  normalizeResult,
  readAnthropicJson,
  readGeminiText,
  safeEqual,
  shortHash,
  signToken,
  validatePayload,
  verifyToken,
} from "./core.js";
import { TOOLS, runTool } from "./calc.js";
import { renderManifest } from "./manifest.js";

const PROVIDER_TIMEOUT_MS = 65_000;
const fallbackLimiter = memoryLimiter();

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });

const hasKey = (v) => typeof v === "string" && v.length >= 20;
const providerOf = (env) => (hasKey(env.ANTHROPIC_API_KEY) ? "anthropic" : hasKey(env.GEMINI_API_KEY) ? "gemini" : null);
const guestCodeSet = (env) => typeof env.APP_PASSWORD === "string" && env.APP_PASSWORD.length >= 8;
// The owner code is the only pass that may spend the Worker's own key. It must be long and must differ from the guest code.
const ownerCodeSet = (env) => typeof env.OWNER_CODE === "string" && env.OWNER_CODE.length >= 12 && env.OWNER_CODE !== env.APP_PASSWORD;
// Guests always bring their own key, so a Worker with no key of its own still serves them.
const isConfigured = (env) => guestCodeSet(env);

const PROVIDERS = new Set(["anthropic", "gemini"]);
const KEY_SHAPE = /^[\x21-\x7e]{20,400}$/;

// The user's own key travels in a header on each request. It is used for that one call and never logged, stored or echoed.
function userCredentials(request) {
  const key = (request.headers.get("x-formulr-key") ?? "").trim();
  if (!key) return null;
  if (!KEY_SHAPE.test(key)) throw new HttpError(400, "bad_key", "That AI key does not look right. Paste it again in the Formulr pane.");
  let provider = (request.headers.get("x-formulr-provider") ?? "").trim().toLowerCase();
  if (!provider) provider = key.startsWith("sk-ant-") ? "anthropic" : key.startsWith("AIza") ? "gemini" : "";
  if (!PROVIDERS.has(provider)) throw new HttpError(400, "bad_provider", "Pick Anthropic or Gemini as your AI provider in the Formulr pane.");
  return { provider, key };
}

function serverCredentials(env) {
  const provider = providerOf(env);
  if (!provider) return null;
  return { provider, key: provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY };
}

async function roleOf(env, token) {
  if (ownerCodeSet(env) && (await verifyToken(env.OWNER_CODE, token))) return "owner";
  if (guestCodeSet(env) && (await verifyToken(env.APP_PASSWORD, token))) return "guest";
  return null;
}

const numVar = (env, name, fallback) => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function limiterFor(env) {
  return env.QUOTAS_DB ? d1Limiter(env.QUOTAS_DB) : fallbackLimiter;
}

function requireJsonPost(request, url) {
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST");
  if (request.headers.get("origin") !== url.origin) throw new HttpError(403, "forbidden_origin", "Requests must come from the add-in itself");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "bad_content_type", "Send application/json");
  }
}

async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "too_large", "Request is too large");
  if (!request.body) throw new HttpError(400, "bad_request", "Empty body");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "too_large", "Request is too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new HttpError(400, "bad_json", "Body is not valid JSON");
  }
}

async function handleSession(request, env, url) {
  requireJsonPost(request, url);
  if (!isConfigured(env)) throw new HttpError(503, "not_configured", "The service is not configured yet");
  const limiter = limiterFor(env);
  const ip = await shortHash(request.headers.get("cf-connecting-ip") ?? "unknown");
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60000);
  const day = now.toISOString().slice(0, 10);
  const perMin = await limiter.consume(`login:m:${ip}:${minute}`, numVar(env, "LOGIN_PER_MINUTE", 6));
  const perDay = await limiter.consume(`login:d:${ip}:${day}`, numVar(env, "LOGIN_PER_DAY", 40));
  if (!perMin.ok || !perDay.ok) throw new HttpError(429, "too_many_attempts", "Too many attempts. Wait a minute and try again.");
  const body = await readJsonLimited(request, 2048);
  if (typeof body?.code !== "string") throw new HttpError(401, "bad_code", "That access code is not right");
  const isOwner = ownerCodeSet(env) && (await safeEqual(body.code, env.OWNER_CODE));
  if (!isOwner && !(await safeEqual(body.code, env.APP_PASSWORD))) {
    throw new HttpError(401, "bad_code", "That access code is not right");
  }
  const ttl = body.remember === true ? LIMITS.rememberTtlSeconds : LIMITS.tokenTtlSeconds;
  const secret = isOwner ? env.OWNER_CODE : env.APP_PASSWORD;
  return json(200, { token: await signToken(secret, Date.now(), ttl), expiresInSeconds: ttl, role: isOwner ? "owner" : "guest" });
}

// Our own wording for provider failures. The provider's own message is only passed on for 400s about the input, never anything that could echo a key.
function providerStatusError(res, bodyText) {
  if (res.status === 429 || res.status === 529) return new HttpError(429, "provider_busy", "The AI provider is rate limiting requests. Try again shortly.");
  if (res.status >= 500) return new HttpError(502, "provider_error", "The AI provider had an error. Try again.");
  if (res.status === 401 || res.status === 403) return new HttpError(502, "provider_rejected", "The AI provider rejected the request. Check the key and model.");
  let detail = "";
  try {
    const m = JSON.parse(bodyText)?.error?.message;
    if (typeof m === "string") detail = m.replace(/\s+/g, " ").slice(0, 200);
  } catch {
    /* no detail */
  }
  if (/api key|credit|billing|authentication|permission/i.test(detail)) return new HttpError(502, "provider_rejected", "The AI provider rejected the request. Check the key, billing and model.");
  return new HttpError(502, "provider_rejected", "The AI provider could not process this request" + (detail ? ": " + detail : ". Try shorter or simpler text."));
}

const MODEL_NAME = /^[a-z0-9.\-]{3,60}$/;

// One call to the Messages API. All calls in one answer share the same deadline.
async function postMessages(creds, body, ctrl) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": creds.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new HttpError(504, "provider_timeout", "The AI provider took too long");
    throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider");
  }
  if (!res.ok) throw providerStatusError(res, await res.text().catch(() => ""));
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, "bad_provider_output", "Provider returned invalid JSON");
  }
}

const CALC_NOTE =
  "You have exact calculator tools: calc, tbill_yields, interpolate, taxable_equivalent_yield, price_change, bond_price, bond_ytm, bond_duration, forward_rate, weighted_average and ips_check. " +
  "For every number you need to compute, call a tool with the values from the question instead of working it out yourself, then match the tool's result to the options by value. " +
  "Never state a figure that a tool could have computed without calling it. Call several tools in one turn when you can.";
// Each tool round costs a model round trip, so at most two rounds: one to compute everything, one spare for a fix.
const MAX_TOOL_TURNS = 2;

// Questions with options, and pictures, run with the calculator tools. If the provider rejects the tool request for any reason, the same question is asked again without tools.
async function callAnthropic(env, payload, creds) {
  const model = payload.careful
    ? MODEL_NAME.test(env.ANTHROPIC_MODEL_CAREFUL ?? "") ? env.ANTHROPIC_MODEL_CAREFUL : "claude-sonnet-5-5"
    : MODEL_NAME.test(env.ANTHROPIC_MODEL ?? "") ? env.ANTHROPIC_MODEL : "claude-sonnet-5-5";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const base = buildAnthropicBody(payload, model);
    if (env.CALC_TOOLS !== "off" && needsCare(payload)) {
      try {
        const data = await runWithTools(creds, base, ctrl);
        const result = normalizeResult(payload, readAnthropicJson(data));
        Object.defineProperty(result, "_rounds", { value: data._rounds ?? 0, enumerable: false });
        return result;
      } catch (err) {
        if (err?.code !== "provider_rejected" && err?.code !== "bad_provider_output") throw err;
      }
    }
    return normalizeResult(payload, readAnthropicJson(await postMessages(creds, base, ctrl)));
  } finally {
    clearTimeout(timer);
  }
}

async function runWithTools(creds, base, ctrl) {
  const withTools = { ...base, tools: TOOLS, system: [...base.system, { type: "text", text: CALC_NOTE }] };
  let messages = base.messages;
  for (let turn = 0; ; turn++) {
    const last = turn >= MAX_TOOL_TURNS;
    const data = await postMessages(creds, { ...withTools, messages, ...(last ? { tool_choice: { type: "none" } } : {}) }, ctrl);
    if (data.stop_reason !== "tool_use" || last) return Object.assign(data, { _rounds: turn });
    const uses = (data.content ?? []).filter((b) => b?.type === "tool_use");
    if (uses.length === 0) return Object.assign(data, { _rounds: turn });
    messages = [
      ...messages,
      { role: "assistant", content: data.content },
      { role: "user", content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, ...runTool(u.name, u.input) })) },
    ];
  }
}

async function callGemini(env, payload, creds) {
  const model = /^[a-z0-9.\-]{3,60}$/.test(env.GEMINI_MODEL ?? "") ? env.GEMINI_MODEL : "gemini-2.5-flash";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": creds.key },
      body: JSON.stringify(buildGeminiBody(payload)),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new HttpError(504, "provider_timeout", "The AI provider took too long");
    throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw providerStatusError(res, await res.text().catch(() => ""));
  let data;
  try {
    data = await res.json();
  } catch {
    throw new HttpError(502, "bad_provider_output", "Provider returned invalid JSON");
  }
  return normalizeResult(payload, readGeminiText(data));
}

async function handleAi(request, env, url) {
  requireJsonPost(request, url);
  if (!isConfigured(env)) throw new HttpError(503, "not_configured", "The service is not configured yet");
  const auth = request.headers.get("authorization") ?? "";
  const hasPass = auth.startsWith("Bearer ");
  const passRole = hasPass ? await roleOf(env, auth.slice(7)) : null;
  const own = userCredentials(request);
  // A user with their own key needs no access code. A pass that no longer works, with no key, means sign in again.
  if (hasPass && !passRole && !own) throw new HttpError(401, "unauthorized", "Unlock Formulr with your access code");
  const role = passRole === "owner" ? "owner" : "guest";
  // Only the owner pass may fall back to the Worker's own key. Everyone else must send their own, or nothing is called.
  const creds = own ?? (role === "owner" ? serverCredentials(env) : null);
  if (!creds) throw new HttpError(403, "needs_key", "Add your own AI key in the Formulr pane to get answers.");
  const t0 = Date.now();
  const payload = validatePayload(await readJsonLimited(request, LIMITS.maxBodyBytes));
  const limiter = limiterFor(env);
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60000);
  const day = now.toISOString().slice(0, 10);
  // Guests count in their own bucket, so they can never use up the owner's limit.
  const bucket = role === "owner" ? "ai" : "ai:guest";
  const checks = [
    limiter.consume(`${bucket}:m:${minute}`, numVar(env, "AI_PER_MINUTE", 120)),
    limiter.consume(`${bucket}:d:${day}`, numVar(env, "AI_PER_DAY", 5000)),
  ];
  if (role === "guest") {
    // Each guest key and each address also has its own small limit, so one person cannot crowd out the rest.
    // The key is tagged with a salted, one way hash: the database never sees the key itself.
    const [keyTag, ipTag] = await Promise.all([
      shortHash("formulr-key:" + env.APP_PASSWORD + ":" + creds.key),
      shortHash("formulr-ip:" + (request.headers.get("cf-connecting-ip") ?? "unknown")),
    ]);
    const perMinute = numVar(env, "GUEST_PER_MINUTE", 30);
    const perDay = numVar(env, "GUEST_PER_DAY", 1500);
    checks.push(
      limiter.consume(`gk:m:${keyTag}:${minute}`, perMinute),
      limiter.consume(`gk:d:${keyTag}:${day}`, perDay),
      limiter.consume(`gi:m:${ipTag}:${minute}`, perMinute),
      limiter.consume(`gi:d:${ipTag}:${day}`, perDay),
    );
  }
  if ((await Promise.all(checks)).some((r) => !r.ok)) throw new HttpError(429, "quota", "Usage limit reached. Try again later.");
  const t1 = Date.now();
  const call = creds.provider === "anthropic" ? callAnthropic : callGemini;
  let result = await call(env, payload, creds);
  // A wrong answer corrected inside its own explanation must never reach the sheet. Ask once more, with more care, and use that.
  if ((payload.mode === "answer" || payload.mode === "image_answer") && contradictsItself(result)) {
    try {
      result = await call(env, { ...payload, careful: true, retry: true }, creds);
    } catch {
      /* keep the first result if the second attempt fails */
    }
  }
  // Where the time went, so a slow answer can be blamed on the right step.
  return json(200, result, { "server-timing": `worker;dur=${t1 - t0}, ai;dur=${Date.now() - t1}, tools;desc="${result._rounds ?? 0} rounds"`, "access-control-expose-headers": "server-timing" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json(200, { status: "ok", configured: isConfigured(env), provider: providerOf(env), version: VERSION });
      }
      if (url.pathname === "/download" && request.method === "GET") {
        // Same manifest, but the browser saves it as a file instead of showing it. Bookmark this address for a one click download.
        return new Response(renderManifest(url.origin, env.ADDIN_ID), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "content-disposition": 'attachment; filename="formulr-manifest.xml"',
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (url.pathname === "/manifest.xml" && request.method === "GET") {
        return new Response(renderManifest(url.origin, env.ADDIN_ID), {
          headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
        });
      }
      // The home page. Assets use html_handling "none", so "/" is mapped to index.html here.
      if (url.pathname === "/" && request.method === "GET" && env.ASSETS) {
        return env.ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
      }
      if ((url.pathname === "/install" || url.pathname === "/install/") && request.method === "GET" && env.ASSETS) {
        return env.ASSETS.fetch(new Request(new URL("/install.html", url.origin), request));
      }
      if (url.pathname === "/api/session") return await handleSession(request, env, url);
      if (url.pathname === "/api/ai") return await handleAi(request, env, url);
      if (env.ASSETS && request.method === "GET") return env.ASSETS.fetch(request);
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
      return json(500, { error: "internal", message: "Something went wrong" });
    }
  },
};
