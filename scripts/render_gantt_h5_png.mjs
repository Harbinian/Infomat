import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

const input = path.resolve(root, argValue("--input", "digital_project_gantt_H5.html"));
const output = path.resolve(root, argValue("--output", path.join("output", "digital_project_gantt_8k.png")));
const profileDir = path.resolve(root, argValue("--profile-dir", path.join("tmp", "chrome-gantt-render-profile")));
const chrome = argValue("--chrome", process.env.CHROME_PATH || "chrome");
const port = Number(argValue("--port", process.env.GANTT_RENDER_PORT || "9333"));

const cssWidth = 5333;
const cssHeight = 3000;
const exportScale = 1.44;
const targetWidth = Math.round(cssWidth * exportScale);
const targetHeight = Math.round(cssHeight * exportScale);

if (targetWidth !== 7680 || targetHeight !== 4320) {
  throw new Error(`Export size mismatch: ${targetWidth}x${targetHeight}`);
}

await rm(profileDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });

const args = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `--window-size=${cssWidth},${cssHeight}`,
  pathToFileURL(input).href,
];

const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.on("data", () => {});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

let tab;
for (let i = 0; i < 80; i += 1) {
  try {
    const tabs = await getJson(`http://127.0.0.1:${port}/json/list`);
    tab = tabs.find(t => t.url.startsWith("file:///") && t.url.includes("digital_project_gantt_H5.html")) || tabs[0];
    if (tab?.webSocketDebuggerUrl) break;
  } catch {}
  await sleep(100);
}

if (!tab?.webSocketDebuggerUrl) {
  child.kill();
  throw new Error("Could not connect to Chrome DevTools.");
}

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", event => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: cssWidth,
  height: cssHeight,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: cssWidth,
  screenHeight: cssHeight,
});

await send("Page.navigate", { url: pathToFileURL(input).href });
await new Promise(resolve => {
  const handler = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Page.loadEventFired") {
      ws.removeEventListener("message", handler);
      resolve();
    }
  };
  ws.addEventListener("message", handler);
});

await send("Runtime.evaluate", {
  expression: `
    (() => {
      document.documentElement.style.setProperty('--month-w', '484px');
      document.documentElement.style.setProperty('--group-w', '460px');
      document.documentElement.style.setProperty('--task-w', '760px');
      document.body.style.margin = '0';
      const page = document.querySelector('.page');
      page.style.width = '5213px';
      page.style.minHeight = '3000px';
      page.style.paddingTop = '32px';
      page.style.paddingBottom = '42px';
      window.scrollTo(0, 0);
      return {
        bodyWidth: document.documentElement.scrollWidth,
        bodyHeight: document.documentElement.scrollHeight,
        rows: document.querySelectorAll('.task-cell').length,
        bars: document.querySelectorAll('.bar').length,
        milestones: document.querySelectorAll('.milestone-line').length
      };
    })()
  `,
  returnByValue: true,
});

await sleep(250);

const capture = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
  clip: {
    x: 0,
    y: 0,
    width: cssWidth,
    height: cssHeight,
    scale: exportScale,
  },
});

await writeFile(output, Buffer.from(capture.data, "base64"));
ws.close();
child.kill();

console.log(`Rendered ${output} at ${targetWidth}x${targetHeight}`);
