#!/usr/bin/env node
// One command setup and update: login, usage database, deploy, secrets, smoke test.
//   node scripts/setup.mjs                 first run, or re-deploy after changes
//   node scripts/setup.mjs --rotate-code   issue a new access code (signs out every device)
//   node scripts/setup.mjs --reset-key     enter a new AI key (Anthropic or Gemini)
// Unattended: set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, AIH_GEMINI_API_KEY (or an Anthropic key in the same variable) and AIH_APP_PASSWORD (12+ chars) as environment variables.
// Secrets are typed or generated here and sent straight to Cloudflare over stdin. They are never written to disk
// or passed on a command line. The generated access code is shown once, on your screen only.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { buildKnowledge } from "./build-knowledge.mjs";
import {
  DB_NAME,
  findDatabase,
  generateAccessCode,
  isLoggedOut,
  parseDbId,
  parseWorkersUrl,
  patchD1Block,
  readD1Id,
  secretNames,
} from "./setup-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function runSetup(deps, flags = {}) {
  const { exec, ask, log, readConfig, writeConfig, newCode, codeFromEnv } = deps;
  const step = (n, text) => log(`\n[${n}/6] ${text}`);
  const fail = (msg) => {
    throw new Error(msg);
  };

  step(1, "Checking your Cloudflare login (the first time this downloads Cloudflare's tool and can take a minute)");
  let who = await exec(["whoami"]);
  if (isLoggedOut(who.out, who.code)) {
    log("A browser window will open. Sign in to the Cloudflare account that should host this, then come back here.");
    const login = await exec(["login"], { inherit: true });
    if (login.code !== 0) fail("Cloudflare login did not finish. Run this again when you are ready.");
    who = await exec(["whoami"]);
    if (isLoggedOut(who.out, who.code)) fail("Still not logged in. Run this again.");
  }
  log("Logged in.");

  step(2, "Usage limit database");
  let config = readConfig();
  const configured = readD1Id(config);
  const list = await exec(["d1", "list", "--json"]);
  let dbId = findDatabase(list.out);
  if (dbId) {
    log(`Found ${DB_NAME}.`);
  } else {
    log(`Creating ${DB_NAME}...`);
    const created = await exec(["d1", "create", DB_NAME]);
    dbId = parseDbId(created.out);
    if (created.code !== 0 || !dbId) fail("Could not create the usage database:\n" + created.out.slice(-400));
  }
  if (configured !== dbId) {
    writeConfig(patchD1Block(config, dbId));
    log("Linked the database in wrangler.jsonc.");
  }

  step(3, "Deploying");
  const deploy = await exec(["deploy"]);
  if (deploy.code !== 0) fail("Deploy failed:\n" + deploy.out.slice(-600));
  const url = parseWorkersUrl(deploy.out);
  if (!url) fail("Deployed, but could not read the address from the output:\n" + deploy.out.slice(-400));
  log(`Live at ${url}`);

  step(4, "Secrets (checking what is already saved, this can take 30 seconds)");
  const existing = secretNames((await exec(["secret", "list", "--format", "json"])).out);
  let shownCode = null;
  if ((!existing.has("ANTHROPIC_API_KEY") && !existing.has("GEMINI_API_KEY")) || flags.resetKey) {
    const key = (await ask("Paste your Anthropic API key (hidden, from https://console.anthropic.com/settings/keys). A Gemini key also works: ")).trim();
    if (key.length < 20 || /\s/.test(key)) fail("That does not look like an API key. Nothing was saved. Run this again.");
    const name = key.startsWith("sk-ant-") ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
    const put = await exec(["secret", "put", name], { input: key + "\n" });
    if (put.code !== 0) fail("Could not save the API key:\n" + put.out.slice(-300));
    log(name === "ANTHROPIC_API_KEY" ? "Saved the Anthropic key. It is used instead of any older Gemini key." : "Saved the Gemini key.");
  } else {
    log("AI key already set (use --reset-key to change it).");
  }
  if (!existing.has("APP_PASSWORD") || flags.rotateCode) {
    shownCode = newCode();
    if (shownCode.length < 12) fail("The access code must be at least 12 characters. It was not saved.");
    const put = await exec(["secret", "put", "APP_PASSWORD"], { input: shownCode + "\n" });
    if (put.code !== 0) fail("Could not save the access code:\n" + put.out.slice(-300));
    log("Created a new access code.");
  } else {
    log("Access code already set (use --rotate-code for a new one).");
  }

  step(5, "Checking the live service");
  let smoke = { code: 1, out: "" };
  for (let attempt = 1; attempt <= 4 && smoke.code !== 0; attempt++) {
    if (attempt > 1) await deps.sleep(4000);
    smoke = await deps.smoke(url);
  }
  log(smoke.out.trim());
  if (smoke.code !== 0) log("\nSome checks failed. Copy everything above and send it to whoever is helping you.");

  step(6, "Next");
  log(`Manifest: ${url}/manifest.xml`);
  if (shownCode && !codeFromEnv) {
    log("\n  ACCESS CODE (shown once, write it down):");
    log(`  ${shownCode}\n`);
  }
  log("In Excel: Insert, Add-ins, More Add-ins, My Add-ins, Upload My Add-in, choose the downloaded manifest.");
  log("Then click Formulr on the Home tab, paste your own AI key under Your AI key, and press Run checks.");
  return { url, ok: smoke.code === 0, accessCode: shownCode };
}

// ---------- real world wiring ----------

function realExec(args, opts = {}) {
  const cmd = process.env.WRANGLER_CMD ? process.env.WRANGLER_CMD.split(" ") : [process.platform === "win32" ? "npx.cmd" : "npx", "--yes", "wrangler@4"];
  const common = { cwd: ROOT, input: opts.input, encoding: "utf8", stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"] };
  // On Windows .cmd files need a shell. Every argument here is a fixed, space free word, so one command string is safe.
  const res = process.platform === "win32" ? spawnSync([...cmd, ...args].join(" "), { ...common, shell: true }) : spawnSync(cmd[0], [...cmd.slice(1), ...args], common);
  return Promise.resolve({ code: res.status ?? 1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` });
}

export function hiddenPrompt(question, io = {}) {
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    const write = rl._writeToOutput;
    let muted = false;
    // Let readline draw the question itself, then hide everything typed or pasted after it.
    rl._writeToOutput = function (text) {
      if (!muted || text.includes("\n") || text.includes("\r")) write.call(rl, text);
    };
    rl.question(question, (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    console.error(`Node.js ${process.versions.node} is too old. Install the current LTS from https://nodejs.org and run this again.`);
    process.exit(1);
  }
  const flags = { rotateCode: process.argv.includes("--rotate-code"), resetKey: process.argv.includes("--reset-key") };
  const configPath = join(ROOT, "wrangler.jsonc");
  try {
    console.log("Knowledge packs:", buildKnowledge().join(", ") || "none (add files to knowledge/ to teach the model your material)");
    const result = await runSetup(
      {
        exec: realExec,
        // Unattended runs (for example a cloud session) can supply the secrets as environment variables instead of typing them.
        ask: process.env.AIH_API_KEY || process.env.AIH_GEMINI_API_KEY ? async () => process.env.AIH_API_KEY || process.env.AIH_GEMINI_API_KEY : hiddenPrompt,
        codeFromEnv: Boolean(process.env.AIH_APP_PASSWORD),
        log: (m) => console.log(m),
        readConfig: () => readFileSync(configPath, "utf8"),
        writeConfig: (t) => writeFileSync(configPath, t),
        newCode: () => process.env.AIH_APP_PASSWORD || generateAccessCode((n) => randomBytes(n)),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        smoke: (url) => {
          const r = spawnSync(process.execPath, [join(ROOT, "scripts", "smoke.mjs"), url], { encoding: "utf8" });
          return Promise.resolve({ code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` });
        },
      },
      flags,
    );
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error("\nStopped: " + err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
