// Pure helpers for scripts/setup.mjs, kept separate so they can be unit tested without Cloudflare.

export const DB_NAME = "excel-ai-helper-quotas";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid misreading

// 20 characters from a 32 symbol alphabet is 100 bits, shown as five groups of four.
export function generateAccessCode(randomBytes) {
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

const D1_BLOCK = /(\/\/ BEGIN D1[^\n]*\n)([\s\S]*?)(\n\s*\/\/ END D1)/;

export function readD1Id(config) {
  const m = config.match(D1_BLOCK);
  const id = m && m[2].match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i);
  return id ? id[1].toLowerCase() : null;
}

export function patchD1Block(config, id) {
  if (!D1_BLOCK.test(config)) throw new Error("wrangler.jsonc is missing the BEGIN D1 / END D1 markers");
  const nl = config.includes("\r\n") ? "\r\n" : "\n"; // keep the file's own line endings (Windows checkouts use CRLF)
  const block = `  "d1_databases": [${nl}    { "binding": "QUOTAS_DB", "database_name": "${DB_NAME}", "database_id": "${id}" }${nl}  ]`;
  return config.replace(D1_BLOCK, (_, begin, _old, end) => `${begin}${block}${end}`);
}

export function parseWorkersUrl(output) {
  const m = String(output).match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i);
  return m ? m[0].toLowerCase() : null;
}

export function parseDbId(output) {
  const m = String(output).match(/database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i) || String(output).match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return m ? m[1].toLowerCase() : null;
}

export function findDatabase(listJson, name = DB_NAME) {
  try {
    const rows = JSON.parse(listJson);
    const hit = (Array.isArray(rows) ? rows : []).find((r) => r && r.name === name);
    return hit ? String(hit.uuid || hit.id || "").toLowerCase() || null : null;
  } catch {
    return null;
  }
}

export function secretNames(listJson) {
  try {
    const rows = JSON.parse(listJson);
    return new Set((Array.isArray(rows) ? rows : []).map((r) => r && r.name).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function isLoggedOut(whoamiOutput, exitCode) {
  return exitCode !== 0 || /not authenticated|not logged in|You are not authenticated/i.test(whoamiOutput);
}
