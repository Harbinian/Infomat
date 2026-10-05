import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Historical H5 image export. An existing --input is mandatory. --profile-dir
 * selects a parent for a NEW owned profile; existing directories are preserved.
 * Only that newly created child profile is cleaned after the owned browser exits.
 * Default PNG output is under ignored artifacts/pmo/gantt8k, never a PMO data builder.
 */
export async function parseRenderArguments(argv, env = process.env) {
  const options = {};
  const allowed = new Set(['--input', '--output', '--profile-dir', '--chrome', '--port']);
  for (let index = 0; index < argv.length; index += 1) {
    const separator = argv[index].indexOf('=');
    const key = separator < 0 ? argv[index] : argv[index].slice(0, separator);
    if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
    const value = separator < 0 ? argv[++index] : argv[index].slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key] = value;
  }
  if (!options['--input']) throw new Error('Historical H5 export requires --input <existing HTML>');
  const input = path.resolve(root, options['--input']);
  const inputStat = await stat(input).catch(() => null);
  if (!inputStat?.isFile()) throw new Error(`Historical H5 input file not found: ${input}`);
  const output = path.resolve(root, options['--output'] || 'artifacts/pmo/gantt8k/digital_project_gantt_8k.png');
  if (input === output) throw new Error('Input and output must be different files');
  const profileParent = path.resolve(root, options['--profile-dir'] || tmpdir());
  if (!(await stat(profileParent).catch(() => null))?.isDirectory()) throw new Error(`Profile parent directory not found: ${profileParent}`);
  const port = Number(options['--port'] || env.GANTT_RENDER_PORT || '9333');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  return { input, output, profileParent, chrome: options['--chrome'] || env.CHROME_PATH || 'chrome', port };
}

export async function createRenderProfile(parent) {
  const parentPath = await realpath(parent);
  const profilePath = await mkdtemp(path.join(parentPath, 'infomat-gantt-render-'));
  const owned = Object.freeze({ parentPath, profilePath });
  ownedProfiles.add(owned);
  return owned;
}

const ownedProfiles = new WeakSet();

export async function removeRenderProfile(owned) {
  if (!ownedProfiles.has(owned)) throw new Error('Refusing cleanup outside a profile created by this process');
  const { parentPath, profilePath } = owned;
  if (path.dirname(profilePath) !== parentPath || !path.basename(profilePath).startsWith('infomat-gantt-render-')) {
    throw new Error('Refusing cleanup outside the owned render profile');
  }
  const currentStat = await lstat(profilePath).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!currentStat) return;
  if (currentStat.isSymbolicLink() || !currentStat.isDirectory() || await realpath(parentPath) !== parentPath || await realpath(profilePath) !== profilePath) {
    throw new Error('Refusing cleanup of a replaced or redirected render profile');
  }
  await rm(profilePath, { recursive: true, force: true });
}

async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function main() {
const { input, output, profileParent, chrome, port } = await parseRenderArguments(process.argv.slice(2));
await assertPortAvailable(port);
const ownedProfile = await createRenderProfile(profileParent);
const profileDir = ownedProfile.profilePath;
let child;
let ws;
try {
const cssWidth = 5333;
const cssHeight = 3000;
const exportScale = 1.44;
const targetWidth = Math.round(cssWidth * exportScale);
const targetHeight = Math.round(cssHeight * exportScale);

if (targetWidth !== 7680 || targetHeight !== 4320) {
  throw new Error(`Export size mismatch: ${targetWidth}x${targetHeight}`);
}


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

child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
child.stderr.on("data", () => {});
await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

let tab;
for (let i = 0; i < 80; i += 1) {
  try {
    const tabs = await getJson(`http://127.0.0.1:${port}/json/list`);
    tab = tabs.find(t => t.url === pathToFileURL(input).href);
    if (tab?.webSocketDebuggerUrl) break;
  } catch {}
  if (child.exitCode !== null) throw new Error(`Browser exited before DevTools became ready: ${child.exitCode}`);
  await sleep(100);
}

if (!tab?.webSocketDebuggerUrl) {
  child.kill();
  throw new Error("Could not connect to Chrome DevTools.");
}

ws = new WebSocket(tab.webSocketDebuggerUrl);
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

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.from(capture.data, "base64"));

console.log(`Rendered ${output} at ${targetWidth}x${targetHeight}`);

} finally {
  ws?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill();
    await closed;
  }
  await removeRenderProfile(ownedProfile);
}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
