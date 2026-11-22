// Steps the video page frame by frame in headless Chrome and saves PNG frames for ffmpeg.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2];
const fps = Number(process.argv[3] || 30);
const only = process.argv[4]; // optional: one time in ms, for a still
fs.mkdirSync(outDir, { recursive: true });
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9334", "--user-data-dir=" + path.join(outDir, "..", "prof"), "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const p = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) pend.get(m.id)(m), pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: "http://localhost:4173/video.html?manual" });
await sleep(1500);
const total = (await send("Runtime.evaluate", { expression: "window.__total", returnByValue: true })).result.result.value;
const times = only ? [Number(only)] : Array.from({ length: Math.ceil((total / 1000) * fps) }, (_, i) => (i * 1000) / fps);
for (let i = 0; i < times.length; i++) {
  await send("Runtime.evaluate", { expression: `window.__render(${times[i]})` });
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
  fs.writeFileSync(path.join(outDir, (only ? "still-" + only : "f" + String(i).padStart(5, "0")) + ".png"), Buffer.from(shot.result.data, "base64"));
}
console.log("frames", times.length);
ws.close(); proc.kill();
