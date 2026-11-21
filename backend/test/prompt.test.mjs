import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The hidden key prompt must keep its question on screen and never echo what is typed. It is exercised in a real
// pseudo terminal, so it is skipped where one is not available (Windows, or no python3).
const setupUrl = new URL("../scripts/setup.mjs", import.meta.url).href;
const python = process.platform === "win32" ? null : spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;

const HARNESS = String.raw`
import os, pty, select, time, json, sys
SECRET = "AIzaSyTEST_SECRET_VALUE_1234567890"
pid, fd = pty.fork()
if pid == 0:
    os.execvp("node", ["node", sys.argv[1]])
out = b""
def drain(t):
    global out
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: out += os.read(fd, 4096)
            except OSError: return
drain(2.0); start = out.decode(errors="ignore"); n = len(out)
os.write(fd, SECRET.encode()); drain(0.8); typed = out[n:].decode(errors="ignore"); n = len(out)
os.write(fd, b"\r"); drain(1.5); enter = out[n:].decode(errors="ignore")
print(json.dumps({"start": start, "typed": typed, "enter": enter, "secret": SECRET}))
`;

test("the key prompt keeps its question visible, hides what is pasted, and returns it", { skip: !python }, () => {
  const dir = mkdtempSync(join(tmpdir(), "prompt-"));
  const demo = join(dir, "demo.mjs");
  writeFileSync(demo, `import { hiddenPrompt } from ${JSON.stringify(setupUrl)};\nconst k = await hiddenPrompt("Paste your Gemini API key (hidden): ");\nconsole.log("GOT_LENGTH=" + k.length);\n`);
  const res = spawnSync(python, ["-I", "-c", HARNESS, demo], { encoding: "utf8", timeout: 30000 });
  assert.equal(res.status, 0, res.stderr);
  const { start, typed, enter, secret } = JSON.parse(res.stdout);
  const q = start.indexOf("Paste your Gemini API key");
  assert.ok(q >= 0, "the question is printed");
  const afterQuestion = start.slice(q).replace(/\x1b\[(\d+)G/g, (m, n) => (Number(n) > 1 ? "" : m));
  assert.ok(!/\x1b\[(0J|1G|2K|K)/.test(afterQuestion), "nothing erases the question after it is drawn");
  assert.equal(typed.includes(secret), false, "pasted text is not echoed");
  assert.equal(enter.includes(secret), false);
  assert.ok(enter.includes(`GOT_LENGTH=${secret.length}`), "the full value reaches the script");
});
