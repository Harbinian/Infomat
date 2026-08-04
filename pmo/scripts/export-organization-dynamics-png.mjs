import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..", "..");
const defaultInput = path.join(
  repositoryRoot,
  "pmo",
  "organization-dynamics",
  "组织数字化参与度十六维分型模型.svg",
);
const defaultOutput = path.join(
  repositoryRoot,
  "artifacts",
  "pmo",
  "organization-dynamics",
  "组织数字化参与度十六维分型模型.png",
);
const expectedWidth = 1600;
const expectedHeight = 2400;

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}.`);
    }
    return value;
  }

  const prefix = `${name}=`;
  const inline = process.argv.find(argument => argument.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function resolveFromRepository(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repositoryRoot, value);
}

async function isFile(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

async function selectBrowser(explicitBrowser) {
  const configured = [
    explicitBrowser,
    process.env.BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
  ].filter(Boolean);

  const commonWindowsPaths = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidate of [...configured, ...commonWindowsPaths]) {
    const normalized = path.normalize(candidate);
    if (await isFile(normalized)) {
      return normalized;
    }
  }

  for (const command of ["msedge", "chrome", "chromium"]) {
    if (commandExists(command)) {
      return command;
    }
  }

  throw new Error(
    "No supported browser was found. Use --browser or set BROWSER_PATH, CHROME_PATH, or EDGE_PATH.",
  );
}

function readSvgDimension(svg, name) {
  const match = svg.match(new RegExp(`\\b${name}="([0-9]+(?:\\.[0-9]+)?)"`));
  if (!match) {
    throw new Error(`SVG is missing a numeric ${name} attribute.`);
  }
  return Number(match[1]);
}

function validateSvg(svg, width, height) {
  const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1];
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `SVG size must remain ${expectedWidth}x${expectedHeight}; received ${width}x${height}.`,
    );
  }
  if (viewBox !== `0 0 ${expectedWidth} ${expectedHeight}`) {
    throw new Error(`SVG viewBox must be "0 0 ${expectedWidth} ${expectedHeight}".`);
  }
  if (/<(?:image|foreignObject|textPath)\b/i.test(svg)) {
    throw new Error("SVG contains a prohibited image, foreignObject, or textPath element.");
  }
}

function readPngDimensions(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
    throw new Error("Browser output is not a valid PNG file.");
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

async function runBrowser(browser, argumentsList) {
  await new Promise((resolve, reject) => {
    const child = spawn(browser, argumentsList, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Browser render timed out after 30 seconds."));
    }, 30_000);

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", code => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Browser exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`));
      }
    });
  });
}

const input = resolveFromRepository(readArgument("--input", defaultInput));
const output = resolveFromRepository(readArgument("--output", defaultOutput));
const explicitBrowser = readArgument("--browser", "");

if (!(await isFile(input))) {
  throw new Error(`SVG input does not exist: ${input}`);
}

const svg = await readFile(input, "utf8");
const width = readSvgDimension(svg, "width");
const height = readSvgDimension(svg, "height");
validateSvg(svg, width, height);

const browser = await selectBrowser(explicitBrowser);
await mkdir(path.dirname(output), { recursive: true });

const temporaryRoot = path.resolve(os.tmpdir());
const profileDirectory = await mkdtemp(path.join(temporaryRoot, "infomat-org-dynamics-"));
if (!path.resolve(profileDirectory).startsWith(`${temporaryRoot}${path.sep}`)) {
  throw new Error(`Refusing to use an unsafe temporary profile path: ${profileDirectory}`);
}

try {
  const browserArguments = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    "--run-all-compositor-stages-before-draw",
    `--user-data-dir=${profileDirectory}`,
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    pathToFileURL(input).href,
  ];

  await runBrowser(browser, browserArguments);

  const png = await readFile(output);
  const rendered = readPngDimensions(png);
  if (rendered.width !== expectedWidth || rendered.height !== expectedHeight) {
    throw new Error(
      `Rendered PNG must be ${expectedWidth}x${expectedHeight}; received ${rendered.width}x${rendered.height}.`,
    );
  }

  console.log(`Rendered ${output} at ${rendered.width}x${rendered.height}`);
} finally {
  await rm(profileDirectory, { recursive: true, force: true });
}

