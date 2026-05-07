const fs = await import("node:fs/promises");
const path = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { Presentation, PresentationFile } = await import("@oai/artifact-tool");
const { Canvas, loadImage } = await import(
  pathToFileURL(
    "C:\\Users\\charl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\@oai\\artifact-tool\\node_modules\\skia-canvas\\lib\\index.mjs",
  )
);

const W = 1280;
const H = 720;
const ROOT = "E:\\CA001\\Infomat";
const HTML_PATH = path.join(ROOT, "docs", "Demo", "系统集成说明H5（完整版）.html");
const OUT_PATH = process.env.PPTX_OUT_PATH || path.join(ROOT, "output.pptx");
const SCRATCH_DIR = path.join(ROOT, "tmp", "slides", "system-integration-h5");
const PREVIEW_DIR = path.join(SCRATCH_DIR, "preview");
const INSPECT_PATH = path.join(SCRATCH_DIR, "inspect.ndjson");
const TOPO_PNG_PATH = path.join(SCRATCH_DIR, "topology-from-h5.png");

const COLORS = {
  blue: "#1a56db",
  blueLt: "#e8f0fe",
  navy: "#0f2a5e",
  teal: "#0891b2",
  amber: "#d97706",
  red: "#dc2626",
  green: "#16a34a",
  purple: "#7c3aed",
  orange: "#ea580c",
  pink: "#db2777",
  emerald: "#059669",
  gray: "#64748b",
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#1e293b",
  muted: "#475569",
  sky: "#7dd3fc",
  transparent: "#00000000",
};

const FONT = {
  title: "Microsoft YaHei",
  body: "Microsoft YaHei",
  mono: "Aptos Mono",
};

const inspect = [];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|tr|h[1-6]|div)>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function oneLine(value) {
  return stripTags(value).replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function limitText(value, max = 78) {
  const txt = oneLine(value);
  return txt.length > max ? `${txt.slice(0, max - 1)}…` : txt;
}

function matchAll(value, re) {
  return Array.from(String(value || "").matchAll(re));
}

function extractVars(html) {
  const root = html.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "";
  const vars = {};
  for (const item of matchAll(root, /--([\w-]+)\s*:\s*([^;]+);/g)) vars[item[1]] = item[2].trim();
  return vars;
}

function extractBlocks(html) {
  const starts = matchAll(html, /<div class="sec" id="([^"]+)">/g).map((m) => ({ id: m[1], index: m.index }));
  const sections = {};
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : html.indexOf("</div>\n\n<footer>");
    const block = html.slice(start.index, end > start.index ? end : undefined);
    const title = oneLine(block.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] || start.id);
    const subtitle = oneLine(block.match(/<div class="sd">([\s\S]*?)<\/div>/)?.[1] || "");
    sections[start.id] = {
      id: start.id,
      title,
      subtitle,
      block,
      text: stripTags(block),
      cards: parseCards(block),
      tables: parseTables(block),
      chains: parseChains(block),
      flows: parseFlows(block),
      qItems: parseQItems(block),
      interfaces: parseInterfaces(block),
    };
  }
  return sections;
}

function parseCover(html) {
  const block = html.match(/<div id="cover">([\s\S]*?)<div class="page">/)?.[1] || "";
  const metas = matchAll(block, /<div class="cv-box"><div class="cl">([\s\S]*?)<\/div><div class="cv">([\s\S]*?)<\/div><\/div>/g).map((m) => [
    oneLine(m[1]),
    oneLine(m[2]),
  ]);
  const participantBlock = block.match(/<div class="cpt">([\s\S]*?)<\/div>/)?.[1] || "";
  const participants = matchAll(participantBlock, /<span>([\s\S]*?)<\/span>/g).map((m) => oneLine(m[1]));
  return {
    tag: oneLine(block.match(/<div class="cv-tag">([\s\S]*?)<\/div>/)?.[1] || ""),
    title: stripTags(block.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] || "").replace(/\n+/g, "\n"),
    subtitle: stripTags(block.match(/<p class="cv-sub">([\s\S]*?)<\/p>/)?.[1] || ""),
    metas,
    participants,
  };
}

function parseCards(block) {
  return matchAll(block, /<div class="card"[^>]*>([\s\S]*?)<\/div>/g).map((m) => ({
    title: oneLine(m[1].match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || ""),
    body: stripTags(m[1].replace(/<h3>[\s\S]*?<\/h3>/, "")),
  }));
}

function parseTables(block) {
  return matchAll(block, /<table[^>]*>([\s\S]*?)<\/table>/g).map((m) => {
    const rows = matchAll(m[1], /<tr[^>]*>([\s\S]*?)<\/tr>/g).map((r) =>
      matchAll(r[1], /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g).map((c) => oneLine(c[1])),
    );
    return rows.filter((row) => row.length);
  });
}

function parseChains(block) {
  const title = oneLine(block.match(/<div class="chain-title">([\s\S]*?)<\/div>/)?.[1] || "");
  const steps = matchAll(block, /<div class="chain-step">([\s\S]*?)<\/div>\s*<\/div>/g).map((m) => oneLine(m[1]));
  return { title, steps };
}

function parseFlows(block) {
  return matchAll(block, /<div class="flow-item">([\s\S]*?)<\/div>\s*<\/div>/g).map((m) => ({
    title: oneLine(m[1].match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || ""),
    body: oneLine(m[1].match(/<p>([\s\S]*?)<\/p>/)?.[1] || ""),
  }));
}

function parseQItems(block) {
  return matchAll(block, /<div class="qi">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g).map((m) => ({
    no: oneLine(m[1].match(/<div class="qn">([\s\S]*?)<\/div>/)?.[1] || ""),
    title: oneLine(m[1].match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || ""),
    body: oneLine(m[1].match(/<p>([\s\S]*?)<\/p>/)?.[1] || ""),
    tags: matchAll(m[1], /<span class="qtag[^"]*">([\s\S]*?)<\/span>/g).map((x) => oneLine(x[1])),
  }));
}

function parseInterfaces(block) {
  const chunks = matchAll(block, /<div class="iface">([\s\S]*?)(?=<div class="iface">|<\/div>\s*<!--|$)/g);
  return chunks.map((m) => ({
    id: oneLine(m[1].match(/<span class="iface-id">([\s\S]*?)<\/span>/)?.[1] || ""),
    title: oneLine(m[1].match(/<span class="iface-title">([\s\S]*?)<\/span>/)?.[1] || ""),
    trigger: oneLine(m[1].match(/<span class="iface-trigger">([\s\S]*?)<\/span>/)?.[1] || ""),
    fields: matchAll(m[1], /<div class="iface-f"><label>([\s\S]*?)<\/label><span>([\s\S]*?)<\/span><\/div>/g).map((x) => [
      oneLine(x[1]),
      oneLine(x[2]),
    ]),
    tables: parseTables(m[1]),
    note: oneLine(m[1].match(/<div class="warn"[\s\S]*?<p>([\s\S]*?)<\/p><\/div>/)?.[1] || ""),
  }));
}

function line(fill = COLORS.transparent, width = 0) {
  return { style: "solid", fill, width };
}

function shape(slide, geometry, x, y, w, h, fill = COLORS.transparent, stroke = COLORS.transparent, strokeWidth = 0) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: line(stroke, strokeWidth),
  });
}

function text(slide, slideNo, value, x, y, w, h, opts = {}) {
  const box = shape(slide, "rect", x, y, w, h, opts.fill || COLORS.transparent, opts.stroke || COLORS.transparent, opts.strokeWidth || 0);
  box.text = String(value ?? "");
  box.text.fontSize = opts.size || 18;
  box.text.color = opts.color || COLORS.text;
  box.text.typeface = opts.face || FONT.body;
  box.text.bold = !!opts.bold;
  box.text.alignment = opts.align || "left";
  box.text.verticalAlignment = opts.valign || "top";
  box.text.insets = opts.insets || { left: 6, right: 6, top: 3, bottom: 3 };
  if (opts.autoFit !== false) box.text.autoFit = opts.autoFit || "shrinkText";
  inspect.push({ kind: "text", slide: slideNo, role: opts.role || "text", text: String(value ?? ""), bbox: [x, y, w, h] });
  return box;
}

function addBg(slide) {
  slide.background.fill = COLORS.bg;
  shape(slide, "rect", 0, 0, W, H, COLORS.bg);
  shape(slide, "rect", 0, 0, W, 64, COLORS.navy);
  shape(slide, "rect", 0, 64, W, 4, COLORS.blue);
}

function addHeader(slide, slideNo, kicker, title, subtitle) {
  addBg(slide);
  text(slide, slideNo, kicker, 52, 14, 500, 34, { size: 18, color: "#ffffff", bold: true, role: "kicker", valign: "middle" });
  text(slide, slideNo, "昌兴复材 · 系统集成方案预审会 V2.3", 878, 20, 350, 24, {
    size: 12,
    color: "#dbeafe",
    align: "right",
    role: "header",
  });
  text(slide, slideNo, title, 58, 92, 720, 44, { size: 30, color: COLORS.navy, bold: true, role: "title" });
  text(slide, slideNo, subtitle, 62, 135, 820, 30, { size: 14, color: COLORS.gray, role: "subtitle" });
}

function addFooter(slide, slideNo, total) {
  text(slide, slideNo, `${String(slideNo).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, 1110, 672, 110, 24, {
    size: 12,
    color: COLORS.gray,
    align: "right",
    role: "page number",
  });
}

function addCard(slide, slideNo, x, y, w, h, title, body, accent = COLORS.blue) {
  shape(slide, "roundRect", x, y, w, h, COLORS.card, COLORS.border, 1);
  shape(slide, "rect", x, y, 5, h, accent);
  text(slide, slideNo, title, x + 18, y + 14, w - 34, 30, { size: 17, color: COLORS.navy, bold: true, role: "card title" });
  text(slide, slideNo, body, x + 18, y + 50, w - 34, h - 62, { size: 13, color: COLORS.muted, role: "card body" });
}

function addAlert(slide, slideNo, x, y, w, h, title, body, color = COLORS.red, fill = "#fef2f2") {
  shape(slide, "roundRect", x, y, w, h, fill, COLORS.border, 1);
  shape(slide, "rect", x, y, 6, h, color);
  text(slide, slideNo, title, x + 18, y + 12, w - 36, 26, { size: 15, color, bold: true, role: "alert title" });
  text(slide, slideNo, body, x + 18, y + 40, w - 36, h - 48, { size: 12, color: COLORS.muted, role: "alert body" });
}

function drawTable(slide, slideNo, rows, x, y, w, h, opts = {}) {
  if (!rows?.length) return;
  const header = rows[0];
  const bodyRows = rows.slice(1, opts.maxRows ? opts.maxRows + 1 : undefined);
  const data = [header, ...bodyRows];
  const colCount = Math.max(...data.map((r) => r.length));
  const weights = opts.weights || Array.from({ length: colCount }, () => 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rowH = h / data.length;
  let cy = y;
  for (let r = 0; r < data.length; r += 1) {
    let cx = x;
    for (let c = 0; c < colCount; c += 1) {
      const cw = (w * (weights[c] || 1)) / weightSum;
      const isHead = r === 0;
      const fill = isHead ? COLORS.navy : r % 2 ? COLORS.card : "#f1f5f9";
      shape(slide, "rect", cx, cy, cw, rowH, fill, COLORS.border, 0.8);
      text(slide, slideNo, data[r][c] || "", cx + 4, cy + 3, cw - 8, rowH - 6, {
        size: opts.size || (data.length > 9 ? 8.5 : 10.5),
        color: isHead ? "#ffffff" : COLORS.muted,
        bold: isHead,
        valign: "middle",
        role: isHead ? "table header" : "table cell",
      });
      cx += cw;
    }
    cy += rowH;
  }
}

function drawFlow(slide, slideNo, items, x, y, w, palette) {
  const count = items.length;
  const gap = 14;
  const boxW = (w - gap * (count - 1)) / count;
  items.forEach((item, idx) => {
    const cx = x + idx * (boxW + gap);
    const accent = palette[idx % palette.length];
    shape(slide, "roundRect", cx, y, boxW, 92, COLORS.card, COLORS.border, 1);
    shape(slide, "ellipse", cx + 14, y + 14, 30, 30, accent);
    text(slide, slideNo, String(idx + 1), cx + 14, y + 18, 30, 22, { size: 12, color: "#ffffff", bold: true, align: "center" });
    text(slide, slideNo, item[0], cx + 52, y + 13, boxW - 62, 28, { size: 14, color: COLORS.navy, bold: true });
    text(slide, slideNo, item[1], cx + 18, y + 48, boxW - 30, 34, { size: 10.5, color: COLORS.muted });
    if (idx < count - 1) {
      shape(slide, "rect", cx + boxW + 2, y + 44, gap - 4, 3, COLORS.blue);
    }
  });
}

function notes(slide, section) {
  if (section?.text) slide.speakerNotes.setText(section.text.slice(0, 5000));
}

function narration(slide, body) {
  slide.speakerNotes.setText(String(body || "").trim());
}

function addTocRow(slide, slideNo, x, y, no, title, desc, color) {
  shape(slide, "roundRect", x, y, 500, 72, COLORS.card, COLORS.border, 1);
  shape(slide, "rect", x, y, 6, 72, color);
  text(slide, slideNo, no, x + 20, y + 14, 54, 30, { size: 21, color, bold: true, align: "center" });
  text(slide, slideNo, title, x + 92, y + 13, 360, 24, { size: 17, color: COLORS.navy, bold: true });
  text(slide, slideNo, desc, x + 92, y + 40, 366, 20, { size: 11, color: COLORS.gray });
}

function slideContents(p, total) {
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "目录", "汇报结构", "会议议程和最新状态已前置；后续按预审逻辑展开");
  const rows = [
    ["00", "会议议程与最新状态", "5月9日议程、5月7日PLM结论、待补事项", COLORS.red],
    ["01", "预审定位与系统清单", "会议边界、最小输入、核心应用系统状态", COLORS.blue],
    ["02", "总体拓扑与集成域", "系统拓扑、研发/采购/制造/质量四大集成域", COLORS.teal],
    ["03", "MDM、黄金源与数据中台", "主数据治理路径、字段台账、黄金源、Q7", COLORS.purple],
    ["04", "适航追溯与关键接口", "零件编号+质量编号追溯、接口卡、字段映射", COLORS.green],
    ["05", "会前行动与会议组织", "未决问题、A1-A8、组织分工、Q1-Q8", COLORS.amber],
  ];
  rows.forEach((r, i) => addTocRow(slide, slideNo, 92 + (i % 2) * 546, 190 + Math.floor(i / 2) * 112, ...r));
  addAlert(slide, slideNo, 128, 552, 952, 76, "阅读方式", "本材料按预审会节奏组织：先统一问题边界，再看系统关系和数据基石，最后锁定责任、输出物和会前补资料路径。", COLORS.blue, "#eff6ff");
  addFooter(slide, slideNo, total);
  narration(slide, "议程和最新状态已经放在最前面，这一页用于说明后续材料结构。今天不是逐条朗读所有材料，而是按五个部分推进：第一，确认本次会议是预审而非最终决策；第二，看系统拓扑和四大集成域；第三，确认 MDM、黄金源和数据中台这些底座问题；第四，进入适航追溯和接口卡；第五，把未决问题转成会前行动、组织分工和 Q1 到 Q8 的预审状态。");
}

function slideGuide(p, total, no, title, subtitle, bullets, color) {
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  slide.background.fill = COLORS.navy;
  shape(slide, "rect", 0, 0, W, H, COLORS.navy);
  shape(slide, "rect", 0, 0, W, H, { type: "linear", angle: 135, stops: [{ offset: 0, color: "#081e4a" }, { offset: 68000, color: COLORS.navy }, { offset: 100000, color }] });
  shape(slide, "ellipse", 840, -180, 580, 580, "#ffffff12");
  shape(slide, "rect", 90, 150, 8, 390, color);
  text(slide, slideNo, no, 124, 150, 160, 38, { size: 24, color: COLORS.sky, bold: true });
  text(slide, slideNo, title, 124, 208, 690, 76, { size: 42, color: "#ffffff", bold: true });
  text(slide, slideNo, subtitle, 126, 300, 720, 38, { size: 18, color: "#dbeafe" });
  bullets.forEach((b, i) => {
    shape(slide, "ellipse", 132, 382 + i * 46, 10, 10, COLORS.sky);
    text(slide, slideNo, b, 158, 371 + i * 46, 720, 28, { size: 17, color: "#eef6ff" });
  });
  text(slide, slideNo, `${slideNo} / ${total}`, 1100, 652, 90, 22, { size: 12, color: "#bfdbfe", align: "right" });
  narration(slide, `下面进入${title}。这一部分重点不是给出所有最终答案，而是把预审需要统一的判断框架先搭起来：${bullets.join("；")}。`);
}

function buildSourceModel(html) {
  return { vars: extractVars(html), cover: parseCover(html), sections: extractBlocks(html) };
}

async function readImageBlob(imagePath) {
  const bytes = await fs.readFile(imagePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function ensureTopologyImage(html) {
  await fs.mkdir(SCRATCH_DIR, { recursive: true });
  try {
    await fs.access(TOPO_PNG_PATH);
    return TOPO_PNG_PATH;
  } catch {}
  try {
    const { chromium } = await import(
      pathToFileURL("C:\\Users\\charl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright\\index.mjs")
    );
    const browser = await chromium.launch({
      headless: true,
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 820, deviceScaleFactor: 2 } });
    await page.goto(`${pathToFileURL(HTML_PATH).toString()}#s2`);
    await page.locator(".topo").first().screenshot({ path: TOPO_PNG_PATH });
    await browser.close();
    return TOPO_PNG_PATH;
  } catch {
    const svg = html.match(/<div class="topo">[\s\S]*?(<svg[\s\S]*?<\/svg>)/)?.[1];
    if (!svg) throw new Error("Cannot find topology SVG in source H5.");
    const img = await loadImage(Buffer.from(svg, "utf8"));
    const canvas = new Canvas(1320, 780);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 20, 20, 1280, 740);
    await fs.writeFile(TOPO_PNG_PATH, await canvas.toBuffer("png"));
  }
  return TOPO_PNG_PATH;
}

function systemCardsFromS1(s1) {
  return matchAll(s1.block, /<div class="sc ([^"]+)">([\s\S]*?)<\/div><\/div>/g).map((m) => ({
    cls: m[1],
    name: oneLine(m[2].match(/<div class="sn">([\s\S]*?)<\/div>/)?.[1] || ""),
    vendor: oneLine(m[2].match(/<div class="sv">([\s\S]*?)<\/div>/)?.[1] || ""),
    role: stripTags(m[2].match(/<div class="sr">([\s\S]*?)<\/div>/)?.[1] || "").replace(/\n/g, " · "),
  }));
}

function slideCover(p, data, total) {
  const slideNo = 1;
  const slide = p.slides.add();
  slide.background.fill = COLORS.navy;
  shape(slide, "rect", 0, 0, W, H, COLORS.navy);
  shape(slide, "rect", 0, 0, W, H, { type: "linear", angle: 135, stops: [{ offset: 0, color: "#081e4a" }, { offset: 55000, color: COLORS.blue }, { offset: 100000, color: COLORS.teal }] });
  shape(slide, "ellipse", 760, -190, 600, 600, "#ffffff14");
  shape(slide, "ellipse", -120, 520, 360, 360, "#ffffff0d");
  text(slide, slideNo, data.cover.tag, 92, 96, 640, 30, { size: 13, color: "#a5c8ff", fill: "#ffffff1c", stroke: "#ffffff33", strokeWidth: 1, valign: "middle" });
  text(slide, slideNo, data.cover.title, 92, 154, 620, 120, { size: 44, color: "#ffffff", bold: true, role: "cover title" });
  text(slide, slideNo, data.cover.subtitle, 94, 294, 690, 74, { size: 17, color: "#dbeafe", role: "cover subtitle" });
  const metaY = 414;
  const displayMetas = data.cover.metas.map(([key, value]) => {
    if (key.includes("文件版本")) return [key, "V2.3"];
    if (key.includes("更新日期")) return [key, "2026-05-07"];
    if (key.includes("关键事项")) return [key, "A1/A3已完成"];
    return [key, value];
  });
  displayMetas.forEach((m, i) => {
    const x = 92 + (i % 3) * 192;
    const y = metaY + Math.floor(i / 3) * 78;
    shape(slide, "roundRect", x, y, 170, 58, "#ffffff19", "#ffffff33", 1);
    text(slide, slideNo, m[0], x + 12, y + 9, 140, 16, { size: 10, color: "#bfdbfe" });
    text(slide, slideNo, m[1], x + 12, y + 28, 142, 20, { size: 15, color: "#ffffff", bold: true });
  });
  shape(slide, "roundRect", 760, 384, 420, 148, "#ffffff14", "#ffffff30", 1);
  text(slide, slideNo, "参与方", 780, 404, 120, 20, { size: 12, color: "#bfdbfe", bold: true });
  text(slide, slideNo, data.cover.participants.join("  ·  "), 780, 434, 370, 78, { size: 13, color: "#e0f2fe" });
  text(slide, slideNo, "沈阳昌兴复材航空科技有限责任公司", 92, 652, 440, 22, { size: 12, color: "#bfdbfe" });
  text(slide, slideNo, `${slideNo} / ${total}`, 1110, 652, 90, 22, { size: 12, color: "#bfdbfe", align: "right" });
  narration(slide, "各位好，今天这份材料围绕昌兴复材系统集成方案预审展开。版本已更新到 2026 年 5 月 7 日状态：PLM 供应商已确认为翎瑞鸿翔，一期范围聚焦 MBOM、ECO 和工程项目管理；A1 和 A3 已完成。先强调会议定位：这不是最终拍板会，而是把 MDM 主数据底座、组织职责、未决问题和接口前置条件梳理清楚，为 5 月 9 日会议形成可讨论、可追责、可补资料的输入。");
}

function slidePositioning(p, d, total) {
  const s = d.sections.s1;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "01.1 预审定位", s.title, s.subtitle);
  const bg = s.cards.find((c) => c.title.includes("项目背景")) || s.cards[0];
  addCard(slide, slideNo, 58, 186, 520, 150, bg.title.replace("🎯 ", ""), bg.body, COLORS.blue);
  const alertBody = stripTags(s.block.match(/<div class="alert">([\s\S]*?)<\/div>\s*<div class="g3">/)?.[1] || "");
  addAlert(slide, slideNo, 612, 186, 560, 150, "会议定位调整", alertBody, COLORS.red, "#fef2f2");
  const cards = s.cards.filter((c) => !c.title.includes("项目背景")).slice(0, 3);
  cards.forEach((card, i) => addCard(slide, slideNo, 58 + i * 374, 378, 342, 160, card.title, card.body, [COLORS.blue, COLORS.amber, COLORS.green][i]));
  addFooter(slide, slideNo, total);
  narration(slide, "这一页先统一会议边界。当前材料已经能说明总体方向，5 月 7 日又补齐了 PLM 供应商和 ECO 闭环两项关键输入：翎瑞鸿翔已确认为一期 PLM 供应商，ECO 流程已验证。仍未补齐的是 SCIM 定位、数据中台路线、主数据编码技术确认、非 PLM 接口卡和 Q1 到 Q8 一页纸。因此 5 月 9 日仍建议定位为系统集成方案预审会：会上确认进入详细设计所需的条件、责任人和补资料路径，不把未知内容写成最终决议。");
}

function slideSystems(p, d, total) {
  const s = d.sections.s1;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "01.2 系统清单", "核心应用系统与当前确认状态", "ERP、MES、OA 已确定；PLM已定翎瑞鸿翔一期，PDM、CAPP、WMS、SCIM仍需边界细化");
  const colors = { erp: COLORS.blue, mes: COLORS.green, oa: COLORS.amber, plm: COLORS.purple, pdm: COLORS.teal, capp: COLORS.orange, wms: COLORS.pink, scim: COLORS.emerald };
  systemCardsFromS1(s).forEach((sys, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 58 + col * 292;
    const y = 190 + row * 172;
    addCard(slide, slideNo, x, y, 260, 138, sys.name, `${sys.vendor}\n${sys.role}`, colors[sys.cls] || COLORS.blue);
  });
  addFooter(slide, slideNo, total);
  narration(slide, "这里是核心系统清单。ERP、MES、OA 的供应商已基本明确，分别承担企业资源计划、制造执行和流程协同。PLM 已确认为翎瑞鸿翔，一期范围聚焦 MBOM、ECO 和工程项目管理。PDM、CAPP、WMS、SCIM 的实施边界还需要继续细化，尤其 SCIM 是自研还是采购、CAPP 后续如何承接 MBOM 展开，都不能在资料不足时直接写成最终结论。");
}

async function slideTopology(p, d, total) {
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.1 总体拓扑", "核心系统关系与横向基础设施", d.sections.s2.subtitle);
  const image = slide.images.add({
    blob: await readImageBlob(TOPO_PNG_PATH),
    fit: "contain",
    alt: "H5原始总体集成拓扑图",
  });
  image.position = { left: 64, top: 184, width: 820, height: 486 };
  const info = oneLine(d.sections.s2.block.match(/<div class="info"[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || "");
  addAlert(slide, slideNo, 916, 194, 270, 346, "口径约束", info, COLORS.blue, "#eff6ff");
  addAlert(slide, slideNo, 916, 562, 270, 84, "读图口径", "主图只表达当前已确认主链关系；边界和主写方未明确的关系暂不直连。", COLORS.teal, "#ecfeff");
  addFooter(slide, slideNo, total);
  narration(slide, "这一页恢复采用 H5 中的原始总体拓扑图。读图时重点看三件事：第一，ERP 是计划、采购、财务成本的核心；第二，PLM、PDM、CAPP、MES 构成研发到制造的主链；第三，数据中台或集成总线仍是 Q7 待决项，它是横向基础设施，不属于某个业务域。主图只画已经确认的主链关系，未明确主写方和边界的关系不直接连线。");
}

function slideDomains(p, d, total) {
  const s = d.sections.s3;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.2 四大集成域", s.title, s.subtitle);
  const domains = [
    ["研发域", "PLM → PDM → CAPP / ERP-PP", "EBOM、MBD、ECO、受控发布驱动工艺与计划。", COLORS.purple],
    ["采购域", "ERP-MM → SCIM → 合同 → WMS → MES", "采购需求、供应商协同、合同、库存和领料串联。", COLORS.emerald],
    ["制造域", "ERP-PP ⇄ MES ⇄ ERP-CO/FI", "订单下达、排产执行、完工反馈、工时成本闭环。", COLORS.green],
    ["质量域", "研发 → 采购 → 制造 → 交付", "质量文件、FAI、NDT、适航符合性贯穿全域。", COLORS.amber],
  ];
  domains.forEach((item, i) => addCard(slide, slideNo, 58 + (i % 2) * 572, 188 + Math.floor(i / 2) * 174, 520, 132, item[0], `${item[1]}\n${item[2]}`, item[3]));
  drawTable(slide, slideNo, s.tables[2], 58, 550, 1084, 104, { maxRows: 4, size: 8.2, weights: [1, 1.2, 1.7] });
  text(slide, slideNo, "差异表用于提示后续 EBOM→MBOM 与追溯规则的预审重点。", 58, 660, 520, 18, { size: 10, color: COLORS.gray });
  addFooter(slide, slideNo, total);
  narration(slide, "四大集成域是后续讨论的主结构：研发域解决 PLM、PDM、CAPP、ERP-PP 的受控发布和工艺计划衔接；采购域解决 ERP-MM、SCIM、合同、WMS、MES 的协同；制造域解决 ERP-PP、MES、成本和财务闭环；质量域贯穿研发、采购、制造和交付。这一页是总览，后面几页会把网页里原本通过点击切换的内容展开。");
}

function drawVerticalFlow(slide, slideNo, items, x, y, w, h, palette) {
  const gap = 12;
  const stepH = (h - gap * (items.length - 1)) / items.length;
  items.forEach((item, idx) => {
    const cy = y + idx * (stepH + gap);
    const accent = palette[idx % palette.length];
    shape(slide, "roundRect", x, cy, w, stepH, COLORS.card, COLORS.border, 1);
    shape(slide, "ellipse", x + 16, cy + 15, 30, 30, accent);
    text(slide, slideNo, item.no || String(idx + 1), x + 16, cy + 19, 30, 22, { size: 11, color: "#ffffff", bold: true, align: "center" });
    text(slide, slideNo, item.title, x + 58, cy + 12, w - 74, 24, { size: 14, color: COLORS.navy, bold: true });
    text(slide, slideNo, item.body, x + 58, cy + 38, w - 74, stepH - 44, { size: 10.5, color: COLORS.muted });
    if (idx < items.length - 1) shape(slide, "rect", x + 30, cy + stepH + 1, 3, gap - 2, accent);
  });
}

function slideResearchDomain(p, d, total) {
  const s = d.sections.s3;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.3 研发域", "PLM → PDM → CAPP / ERP-PP", "EBOM、MBD、ECO、受控发布驱动工艺与计划");
  drawVerticalFlow(
    slide,
    slideNo,
    [
      { no: "1", title: "PLM — 工程发布", body: "输出 EBOM 结构、铺层顺序、材料规范号、固化工艺规范、NDT 检测规范、三维 MBD 模型和虚拟件标记。" },
      { no: "2", title: "PDM — 受控 BOM 管理", body: "过滤虚拟件、版本锁定、受控发布；同时推送 CAPP 和 ERP-PP，质量文件归档受控。" },
      { no: "3a", title: "CAPP — 工艺路线设计", body: "接收 EBOM + MBD，展开铺层、固化、脱模、修边、NDT、表面处理、检验，输出 MBOM、工时定额和工装编号。" },
      { no: "3b", title: "ERP-PP — 生产计划", body: "接收 MBOM + 工艺路线，进行 MRP 运算，生成生产订单和采购需求。" },
    ],
    62,
    186,
    510,
    402,
    [COLORS.purple, COLORS.teal, COLORS.orange, COLORS.blue],
  );
  drawTable(slide, slideNo, s.tables[0], 610, 190, 548, 180, { size: 9.2, weights: [1.2, 1.2, 1.7] });
  addAlert(slide, slideNo, 610, 398, 548, 98, "MBD 关键作用", "三维模型、PMI 标注、材料/公差定义和更改管理信息进入 CAPP 与 PDM，降低二维图纸依赖，确保制造端使用唯一受控版本。", COLORS.purple, "#f5f3ff");
  addCard(slide, slideNo, 610, 526, 250, 86, "受控发布", "发布版本与接收版本一一对应，不覆盖旧版本。", COLORS.teal);
  addCard(slide, slideNo, 888, 526, 250, 86, "最新结论", "翎瑞鸿翔一期覆盖 MBOM、ECO、工程项目管理；接口资料仍待补齐。", COLORS.green);
  addFooter(slide, slideNo, total);
  narration(slide, "研发域的主链是 PLM 到 PDM，再到 CAPP 和 ERP-PP。5 月 7 日后，PLM 已确认为翎瑞鸿翔，一期范围覆盖 MBOM、ECO 和工程项目管理。PLM 发起工程发布，PDM 负责受控发布、版本锁定和虚拟件过滤，CAPP 后续承接工艺路线和 MBOM 展开，ERP-PP 承接计划和 MRP。现在的风险不再是 PLM 供应商未定，而是 BOM头结构映射、字段对齐、接口资料和 CAPP 后续规划需要继续补齐。");
}

function slideBomDomain(p, d, total) {
  const s = d.sections.s3;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.4 BOM体系", "四态 BOM 与航空复材差异", "EBOM、MBOM、PBOM、SBOM 与航空复材差异表单独展开");
  const boms = [
    ["EBOM 工程BOM", "PLM 主导\n铺层顺序、纤维方向、材料规范号、固化工艺规范，含虚拟件。", COLORS.purple],
    ["MBOM 制造BOM", "CAPP / MES 主导\n工序分工、工装编号、工时定额、损耗率、工艺规范号。", COLORS.green],
    ["PBOM 采购BOM", "ERP-MM 主导\n预浸料规格、批次要求、有效期、供应商资质、ASL。", COLORS.amber],
    ["SBOM 构型BOM", "PDM / 适航 主导\n件号、序列号、适用性、构型偏离、SoC、FAI。", COLORS.teal],
  ];
  boms.forEach((b, i) => addCard(slide, slideNo, 58 + i * 288, 180, 260, 128, b[0], b[1], b[2]));
  drawTable(slide, slideNo, s.tables[1], 58, 340, 1110, 292, { size: 8.7, weights: [1, 1.25, 2.1] });
  addFooter(slide, slideNo, total);
  narration(slide, "这一页把四态 BOM 单独展开。EBOM 是工程视角，MBOM 是制造视角，PBOM 是采购视角，SBOM 是构型和适航视角。航空复材和普通制造最大的差异在于：最小单元可能是铺层，材料有效期和存储条件很关键，固化曲线、热压罐编号、NDT 报告、构型状态和偏离记录都要追溯到件。因此 EBOM 到 MBOM 不能只看普通物料结构转换。");
}

function slideProcureManufactureDomain(p, d, total) {
  const s = d.sections.s3;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.5 采购与制造", "采购协同链 + 制造执行闭环", "ERP、SCIM、WMS、MES 与财务成本闭环展开");
  drawVerticalFlow(
    slide,
    slideNo,
    [
      { title: "ERP-PP / ERP-MM", body: "MRP 运算生成物料需求，触发采购申请与采购订单。" },
      { title: "SCIM 供应商协同", body: "供应商商务管理、技术协同、海关/下料、首件检验、不合格品控制和供应商质量。" },
      { title: "合同管理 / OA", body: "合同准备、签订、执行由流程协同驱动。" },
      { title: "WMS → MES", body: "到货入库、库位、预浸料有效期、出入库、领料与工单绑定。" },
    ],
    58,
    184,
    510,
    390,
    [COLORS.blue, COLORS.emerald, COLORS.amber, COLORS.pink],
  );
  drawVerticalFlow(
    slide,
    slideNo,
    [
      { title: "ERP-PP 下达生产订单", body: "生产订单、工艺路线、MBOM 推送 MES。" },
      { title: "MES 排产与执行", body: "工装/工具/夹具资源、工艺、生产执行、工时、IoT、现场质量检验。" },
      { title: "MES 完工反馈", body: "完工报工、工时报工回传 ERP-PP，更新进度。" },
      { title: "ERP-CO / FI", body: "工时、物料、工装进入成本归集，生成凭证并完成财务结账。" },
    ],
    642,
    184,
    510,
    390,
    [COLORS.blue, COLORS.green, COLORS.green, COLORS.blue],
  );
  text(slide, slideNo, "采购域", 62, 586, 160, 24, { size: 18, color: COLORS.emerald, bold: true });
  text(slide, slideNo, "制造域", 646, 586, 160, 24, { size: 18, color: COLORS.green, bold: true });
  addFooter(slide, slideNo, total);
  narration(slide, "左侧是采购协同链：ERP 根据 MRP 形成需求，SCIM 承担供应商协同，OA 或合同系统驱动合同流程，WMS 管理入库、库位、批次和有效期，最后 MES 绑定工单和领料。右侧是制造执行闭环：ERP-PP 下达订单，MES 完成排产和现场执行，再把完工和工时回传，进入 ERP-CO 和 FI 做成本与财务核算。");
}

function slideQualityDomain(p, d, total) {
  const s = d.sections.s3;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "02.6 质量域", "研发 → 采购 → 制造 → 交付", "质量管理横向贯穿全域，质量文件与质量数据统一受控");
  const stages = [
    ["研发阶段", "LCA 品质策划\n文件审批（OA）\nPDM 质量文件受控", COLORS.purple],
    ["采购阶段", "供应商质量管理\n首件检验（FAI）\n不合格品控制\n交付文件管理", COLORS.emerald],
    ["制造阶段", "现场质量检验\nNDT（超声C扫/X射线）\n产品检验、数据发放\n工装制造质量", COLORS.green],
    ["交付阶段", "智能质量监控\n质量审核、质量改进\n适航符合性证明", COLORS.amber],
  ];
  stages.forEach((stage, i) => addCard(slide, slideNo, 58 + i * 288, 190, 260, 162, stage[0], stage[1], stage[2]));
  shape(slide, "roundRect", 96, 420, 1010, 104, COLORS.navy, COLORS.navy, 1);
  text(slide, slideNo, "统一质量数据", 132, 440, 200, 28, { size: 22, color: COLORS.sky, bold: true });
  text(slide, slideNo, "PDM 负责质量文件受控，ERP 承接业务与财务侧质量数据；质量链需要贯穿研发、采购、制造、交付全过程。", 354, 444, 690, 28, { size: 14, color: "#dbeafe" });
  addAlert(slide, slideNo, 136, 560, 930, 70, "预审关注", "质量记录、NDT、偏离/超差、构型和适航追溯数据的存储归属需在 Q8 中补齐。", COLORS.red, "#fef2f2");
  addFooter(slide, slideNo, total);
  narration(slide, "质量域不是一个孤立系统，而是横向贯穿研发、采购、制造和交付。研发阶段关注质量策划和受控文件，采购阶段关注供应商质量、首件检验和交付文件，制造阶段关注现场检验和 NDT，交付阶段关注适航符合性证明。这里要引出 Q8：质量记录、构型、偏离超差和追溯数据到底由谁存、谁查、谁负责。");
}

function slideMdmPath(p, d, total) {
  const s = d.sections.s4;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "03.1 MDM路径", s.title, s.subtitle);
  drawFlow(
    slide,
    slideNo,
    [
      ["组织先行", "统一公司、部门、岗位、人员、工号、权限入口"],
      ["流程牵引", "先梳理跨系统流程，再落字段和接口"],
      ["术语统一", "建立术语词典，消除部门口径差异"],
      ["字段落账", "形成字段台账、责任人、黄金源与同步规则"],
      ["主数据沉淀", "建设可持续维护的 MDM 底座"],
    ],
    58,
    192,
    1088,
    [COLORS.blue, COLORS.teal, COLORS.green, COLORS.amber, COLORS.purple],
  );
  const layer1 = s.cards.find((c) => c.title.includes("第一层"));
  const layer2 = s.cards.find((c) => c.title.includes("第二层"));
  addCard(slide, slideNo, 80, 350, 500, 154, layer1?.title || "组织与身份 MDM", layer1?.body || "", COLORS.blue);
  addCard(slide, slideNo, 620, 350, 500, 154, layer2?.title || "业务主数据 MDM", layer2?.body || "", COLORS.green);
  drawTable(slide, slideNo, s.tables[0], 80, 538, 1040, 98, { maxRows: 3, size: 8.5 });
  addFooter(slide, slideNo, total);
  narration(slide, "MDM 是这套集成能否稳定落地的前置基石。建议路径是组织先行、流程牵引、术语统一、字段落账、主数据沉淀。先统一组织、人员、岗位、工号和权限入口，再按流程盘点字段，建立术语词典和字段台账，最后形成可维护的主数据底座。没有这个基础，接口容易变成点对点临时连接。");
}

function slideCodingGovernance(p, d, total) {
  const s = d.sections.s4;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "03.2 编码与字段", "物料编码、字段台账和术语治理", "13位含连字符方案需各系统技术确认，REV 作为独立字段管理");
  shape(slide, "roundRect", 78, 188, 1042, 90, COLORS.navy, COLORS.navy, 1);
  const segments = [["MAT", "物料类型"], ["-", ""], ["A01", "分类码"], ["-", ""], ["00001", "流水号"], ["REV", "独立字段"]];
  let x = 130;
  segments.forEach(([v, l], i) => {
    text(slide, slideNo, v, x, 212, i % 2 ? 26 : 108, 26, { size: i % 2 ? 20 : 23, color: COLORS.sky, bold: true, face: FONT.mono, align: "center" });
    if (l) text(slide, slideNo, l, x, 244, 108, 18, { size: 10, color: "#bfdbfe", align: "center" });
    x += i % 2 ? 34 : 132;
  });
  const principle = s.cards.find((c) => c.title.includes("五原则"));
  addCard(slide, slideNo, 78, 310, 326, 150, principle?.title || "物料编码设计五原则", principle?.body || "", COLORS.blue);
  drawTable(slide, slideNo, s.tables[2], 430, 310, 690, 150, { maxRows: 5, size: 8.2, weights: [0.8, 1.4, 2.6] });
  drawTable(slide, slideNo, s.tables[3], 78, 492, 500, 130, { maxRows: 4, size: 8.2 });
  drawTable(slide, slideNo, s.tables[4], 610, 492, 510, 130, { maxRows: 4, size: 8.2 });
  addFooter(slide, slideNo, total);
  narration(slide, "这一页讲编码和字段治理。13 位含连字符的物料编码方案需要各系统确认字段长度、字符集、唯一性校验和导入导出限制。REV 建议作为独立字段，而不是塞进编码本体。同时，字段台账和术语治理必须同步推进，否则同一个字段在 PLM、ERP、MES、WMS 中可能含义不同，后续接口会反复返工。");
}

function slideGoldenSource(p, d, total) {
  const s = d.sections.s5;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "03.3 黄金源矩阵", s.title, s.subtitle);
  drawTable(slide, slideNo, s.tables[0], 58, 184, 1110, 386, { size: 8.3, weights: [1.1, 1.4, 1.2, 1.2, 2.2] });
  addAlert(
    slide,
    slideNo,
    76,
    592,
    1040,
    78,
    "预审口径",
    "字段唯一权威来源必须与组织职责、流程确认人、主数据责任人同步确认；PLM已定事项进入一期边界，接口字段和未补资料项继续标注待确认。",
    COLORS.blue,
    "#eff6ff",
  );
  addFooter(slide, slideNo, total);
  narration(slide, "黄金源矩阵要解决的是：同一个数据项到底哪个系统是唯一权威来源。比如组织和人员可能来自 OA 或 MDM，设计件物料倾向 PLM，采购件可能由 ERP-MM 创建维护，MBOM 一期结合翎瑞鸿翔 PLM 范围和临时承接方案处理，后续再与 CAPP 规划衔接。预审口径是：黄金源不能单独拍脑袋确定，必须和组织职责、流程确认人、主数据责任人同步确认。PLM 已定事项进入一期边界，接口字段和未补资料项继续标注待确认。");
}

function slideDataPlatform(p, d, total) {
  const s = d.sections.s6;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "03.4 数据中台", s.title, s.subtitle);
  drawTable(slide, slideNo, s.tables[0], 58, 190, 680, 270, { size: 9, weights: [1, 2.2, 2, 1.5] });
  shape(slide, "roundRect", 790, 190, 336, 270, COLORS.card, COLORS.border, 1);
  text(slide, slideNo, "Q7 是否建设数据中台/集成总线？", 812, 214, 292, 34, { size: 18, color: COLORS.navy, bold: true });
  const q = s.qItems[0];
  text(slide, slideNo, q?.body || "", 812, 270, 292, 96, { size: 13, color: COLORS.muted });
  text(slide, slideNo, (q?.tags || []).join("\n"), 812, 386, 260, 54, { size: 11, color: COLORS.blue, bold: true });
  const chain = oneLine(s.chains.title);
  addAlert(slide, slideNo, 88, 504, 1008, 78, chain, "不直接拍最终架构；先确认关键接口不再裸奔，并补齐主数据依赖、异常处理和人工兜底。", COLORS.amber, "#fffbeb");
  addFooter(slide, slideNo, total);
  narration(slide, "数据中台或集成总线是 Q7 的核心。当前不建议直接拍最终架构，而是先把路线比较清楚：点对点成本低但治理弱，ESB 或消息中间件可以统一接口和异常处理，完整数据中台还能承接 MDM 与追溯查询。会上至少要确认一个底线：关键接口不能裸奔，必须有字段、触发、异常处理和人工兜底。");
}

function slideTraceability(p, d, total) {
  const s = d.sections.s7;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "04.1 适航追溯", s.title, s.subtitle);
  s.cards.slice(0, 3).forEach((card, i) => addCard(slide, slideNo, 58 + i * 370, 188, 334, 116, card.title, card.body, [COLORS.blue, COLORS.green, COLORS.amber][i]));
  drawFlow(
    slide,
    slideNo,
    [
      ["原材料批次", "批号、有效期、存储条件"],
      ["制造工艺", "工序、设备、人员、热压罐参数"],
      ["质量记录", "NDT、偏离/超差、检验结果"],
      ["交付构型", "件号、质量编号、符合性证明"],
    ],
    80,
    360,
    1040,
    [COLORS.emerald, COLORS.orange, COLORS.red, COLORS.purple],
  );
  const q = s.qItems[0];
  addAlert(slide, slideNo, 108, 530, 980, 78, q?.title || "Q8", `${q?.body || ""}\n${(q?.tags || []).join(" · ")}`, COLORS.red, "#fef2f2");
  addFooter(slide, slideNo, total);
  narration(slide, "适航追溯强调零件编号加质量编号，而不是只做批次追溯。追溯链至少要覆盖原材料批次、制造工艺、质量记录和交付构型。航空复材还要关注预浸料有效期、热压罐参数、NDT 报告、偏离超差和构型状态。这一页的落点是 Q8：追溯数据分散存储还是统一查询，需要在预审会上明确下一步补资料责任。");
}

function slideInterfaces(p, d, total) {
  const s = d.sections.s8;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "04.2 关键接口", s.title, s.subtitle);
  const rows = [["接口", "触发时机", "集成目的", "数据格式 / 核心字段"]];
  s.interfaces.forEach((it) => rows.push([`${it.id} ${it.title}`, it.trigger, it.fields[0]?.[1] || "", `${it.fields[1]?.[1] || ""}\n${it.fields[2]?.[1] || ""}`]));
  drawTable(slide, slideNo, rows, 58, 188, 1110, 304, { size: 8.8, weights: [1.8, 1.1, 2.1, 2.5] });
  const standards = [
    ["方向", "系统起点/终点与主写方"],
    ["触发", "事件、频率、批量/实时"],
    ["字段", "字段名、编码、版次、质量编号"],
    ["异常", "失败重试、告警、人工兜底"],
  ];
  standards.forEach((c, i) => addCard(slide, slideNo, 80 + i * 260, 530, 220, 86, c[0], c[1], [COLORS.blue, COLORS.teal, COLORS.green, COLORS.red][i]));
  addFooter(slide, slideNo, total);
  narration(slide, "关键接口设计不能只写系统 A 把数据传给系统 B。每张接口卡至少要明确方向、触发时机、协议或格式、核心字段、主数据依赖、术语风险、失败重试和人工兜底。这里列出的 PLM 到 PDM、PDM 到 CAPP、CAPP 到 MES、ERP-PP 到 MES 是最需要先补齐的主链接口。");
}

function slideInterfaceFields(p, d, total) {
  const s = d.sections.s8;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "04.3 字段映射", "PLM → PDM 工程 BOM 发布", "虚拟件不过渡到 PDM BOM 结构；发布版本与接收版本严格一一对应");
  const iface = s.interfaces[0];
  addCard(slide, slideNo, 58, 188, 420, 146, iface.title, iface.fields.map((f) => `${f[0]}：${f[1]}`).join("\n"), COLORS.purple);
  drawTable(slide, slideNo, iface.tables[0], 516, 188, 620, 330, { size: 9, weights: [1.2, 1.2, 1.7] });
  addAlert(slide, slideNo, 86, 552, 1010, 76, "异常处理", iface.note, COLORS.amber, "#fffbeb");
  addFooter(slide, slideNo, total);
  narration(slide, "这一页用 PLM 到 PDM 的工程 BOM 发布作为字段示例。需要注意物料编码、件号、版次、铺层顺序、材料规范、固化工艺规范、NDT 规范和虚拟件标记这些字段。虚拟件不过渡到 PDM BOM 结构，发布版本和接收版本必须一一对应，接口失败时要有告警和人工介入流程。");
}

function slideOpenIssues(p, d, total) {
  const s = d.sections.s9;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "05.1 未决问题", s.title, s.subtitle);
  const judge = oneLine(s.block.match(/<div class="alert"><div class="at">会议判断<\/div><p>([\s\S]*?)<\/p><\/div>/)?.[1] || "");
  addAlert(slide, slideNo, 58, 180, 1110, 78, "会议判断", judge, COLORS.red, "#fef2f2");
  drawTable(slide, slideNo, s.tables[0], 58, 286, 1110, 250, { size: 9, weights: [1, 2, 2.2, 0.8] });
  addCard(slide, slideNo, 92, 562, 480, 78, "5月7日 PLM 洽谈已完成", "翎瑞鸿翔一期范围：MBOM、ECO、工程项目管理；A1/A3完成。", COLORS.green);
  addCard(slide, slideNo, 620, 562, 480, 78, "5月8日 部门预沟通", "补齐SCIM、数据中台、编码确认、非PLM接口卡和Q1-Q8一页纸。", COLORS.amber);
  addFooter(slide, slideNo, total);
  narration(slide, "这一页把当前未决问题集中展示。5 月 7 日 PLM 洽谈已经完成，翎瑞鸿翔一期范围明确，ECO 闭环也已验证。现在风险较高的点集中在接口协议和触发时机缺失、MDM 主数据没有形成体系、异常处理和版本管理不足、中间件路线未定，以及 SCIM 定位未定。会议判断是：5 月 9 日如果没有 5 月 8 日的部门预沟通输入，就仍然会变成现场补资料。因此接下来要把 SCIM、数据中台、编码确认、非 PLM 接口卡和 Q1 到 Q8 一页纸补齐。");
}

function slideActions(p, d, total) {
  const s = d.sections.s9;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "05.2 会前行动", "行动项、牵头部门与会前输出", "优先把问题诊断转化为责任人、参与方、输出物和截止时间");
  drawTable(slide, slideNo, s.tables[2], 42, 176, 1180, 472, { size: 7.6, weights: [1.15, 1.3, 1.1, 1.55, 2.5, 0.95] });
  addFooter(slide, slideNo, total);
  narration(slide, "A1 到 A8 是把问题转成行动的清单。现在状态已经发生变化：A1 的 PLM 供应商能力确认已经完成，A3 的 ECO 闭环也已完成；A2 的 BOM头风险已识别，一期由人工或临时方案承接。仍需要重点推进的是 A4 的 SCIM 定位、A5 的数据中台路线、A6 的主数据编码技术确认、A7 的非 PLM 接口卡补全，以及 A8 的 5 月 9 日决策包整理。每个行动项都要有牵头部门、参与方、会前输出和截止时间。");
}

function slideOrg(p, d, total) {
  const s = d.sections.s10;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "05.3 组织分工", s.title, s.subtitle);
  addAlert(slide, slideNo, 58, 178, 1110, 94, "预审组织机制", s.chains.steps.join("\n"), COLORS.blue, "#eff6ff");
  const orgs = matchAll(s.block, /<div class="org-card">([\s\S]*?)<\/ul><\/div>/g).map((m) => ({
    title: oneLine(m[1].match(/<div class="org-dept">([\s\S]*?)<\/div>/)?.[1] || ""),
    body: matchAll(m[1], /<li>([\s\S]*?)<\/li>/g).map((x) => oneLine(x[1])).join("\n"),
  }));
  orgs.slice(0, 7).forEach((o, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    addCard(slide, slideNo, 50 + col * 292, 304 + row * 142, 260, 112, o.title, o.body, [COLORS.amber, COLORS.purple, COLORS.red, COLORS.emerald, COLORS.blue, COLORS.green, COLORS.teal][i]);
  });
  addFooter(slide, slideNo, total);
  narration(slide, "组织分工页要确认预审工作组的运行机制。决策层处理跨部门冲突、系统路线和重大投入；项目管理部统一收口 Q1 到 Q8 决策包、A1 到 A8 行动项、接口卡和会议纪要；各部门至少指定业务确认人和数据确认人，分别确认流程真实性和字段、编码、主数据完整性。");
}

function slideAgenda(p, d, total) {
  const s = d.sections.s11;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "00 会议议程", "2026-05-09 会议议程", s.subtitle);
  const rows = [["时间", "议题", "时长"], ...matchAll(s.block, /<div class="sched-time">([\s\S]*?)<\/div><div class="sched-topic">([\s\S]*?)<\/div><div class="sched-dur">([\s\S]*?)<\/div>/g).map((m) => [
    oneLine(m[1]),
    oneLine(m[2]),
    oneLine(m[3]),
  ])];
  drawTable(slide, slideNo, rows, 82, 182, 1038, 412, { size: 9.2, weights: [0.75, 4.6, 0.8] });
  const success = oneLine(s.block.match(/<div class="success"><p>([\s\S]*?)<\/p><\/div>/)?.[1] || "");
  addAlert(slide, slideNo, 102, 608, 1000, 62, "会议纪要建议口径", success, COLORS.green, "#f0fdf4");
  addFooter(slide, slideNo, total);
  narration(slide, "先看 5 月 9 日预审会的建议议程。前半段确认会议定位、组织职责和 MDM 建设路径；中段预审黄金源矩阵、接口和数据中台路线；后半段进入适航追溯、质量数据和行动项锁定。建议会议纪要明确：资料不足的事项列为会后补资料项，不作为最终决议。");
}

function slideLatestStatus(p, total) {
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "00.1 最新状态", "2026-05-07 项目状态刷新", "PLM已定，A1/A3已完成；5月8日仍需补齐预审输入");
  addCard(
    slide,
    slideNo,
    58,
    184,
    348,
    154,
    "PLM 已定",
    "翎瑞鸿翔\n一期范围：MBOM(PDM)、ECO(ECN)、工程项目管理\n供应商资料待 5月9日前提交",
    COLORS.green,
  );
  addCard(
    slide,
    slideNo,
    436,
    184,
    348,
    154,
    "A1/A3 已完成",
    "A1：PLM供应商能力确认完成\nA3：ECO流程已验证，无风险敞口\n结论并入PLM洽谈结论",
    COLORS.blue,
  );
  addCard(
    slide,
    slideNo,
    814,
    184,
    348,
    154,
    "BOM头风险已识别",
    "EBOM→MBOM 的结构映射和字段对齐是一期风险点\n一期由人工或临时方案承接，CAPP 后续规划",
    COLORS.amber,
  );
  addAlert(
    slide,
    slideNo,
    82,
    386,
    1018,
    82,
    "5月9日会议定位",
    "仍建议定位为“集成方案预审会”：已确认事项进入条件性结论，未补齐资料项不写成最终决议。",
    COLORS.red,
    "#fef2f2",
  );
  const rows = [
    ["待补事项", "牵头/参与", "预审输出"],
    ["SCIM定位", "物资保障部 + 质量/财务/项目管理部", "供应商协同范围；自研/采购倾向"],
    ["数据中台路线", "信息化项目组 + 各系统供应商", "点对点、ESB、数据中台三案对比"],
    ["主数据编码技术确认", "工程技术部 + 信息化项目组 + U8/MES/翎瑞鸿翔", "字符集、长度、唯一性、导入导出限制确认"],
    ["接口卡与Q1-Q8一页纸", "信息化项目组 + 各行动项牵头部门", "非PLM接口卡优先；Q1-Q8列明结论、风险和需补资料"],
  ];
  drawTable(slide, slideNo, rows, 82, 500, 1018, 136, { size: 8.4, weights: [1.2, 2.1, 2.35] });
  addFooter(slide, slideNo, total);
  narration(slide, "这一页把材料更新到 5 月 7 日状态。第一，PLM 供应商已经确定为翎瑞鸿翔，一期范围是 MBOM、ECO 和工程项目管理，但供应商资料仍要在 5 月 9 日前提交。第二，A1 和 A3 已完成，ECO 流程已验证没有风险敞口。第三，EBOM 到 MBOM 的 BOM头风险已经识别，主要是结构映射和字段对齐，一期先由人工或临时方案承接，CAPP 放到后续规划。第四，5 月 8 日仍要补齐 SCIM 定位、数据中台路线、主数据编码技术确认、非 PLM 接口卡和 Q1 到 Q8 一页纸。");
}

function slideQuestions(p, d, total) {
  const s = d.sections.s11;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "05.4 Q1-Q8预审", "预审问题、推荐倾向与状态", "每题形成一页纸：当前结论、待决问题、方案、倾向、影响范围、需补资料");
  drawTable(slide, slideNo, s.tables[0], 40, 176, 1190, 470, { size: 7.6, weights: [0.55, 2.25, 2.6, 1.2, 0.95, 0.9] });
  addFooter(slide, slideNo, total);
  narration(slide, "最后用 Q1 到 Q8 收束预审问题。每一题都应形成一页纸：当前结论、待决问题、可选方案、推荐倾向、影响范围和需供应商补充资料。5 月 7 日后，PLM 供应商确认和 ECO 闭环可以从待确认调整为已解决或条件性结论；仍需预沟通的是 SCIM 定位，仍需技术确认的是主数据编码，仍需方案对比的是数据中台路线，仍需补资料的是接口卡和字段细节。");
}

function slideAppendix(p, d, total) {
  const s = d.sections.appendix;
  const slideNo = p.slides.count + 1;
  const slide = p.slides.add();
  addHeader(slide, slideNo, "附录 文档版本", s.title, s.subtitle);
  drawTable(slide, slideNo, s.tables[0], 124, 190, 940, 366, { size: 10, weights: [2.6, 0.8, 1, 1.5] });
  addAlert(slide, slideNo, 160, 582, 866, 82, "来源", "本 PPT 以 docs\\Demo\\系统集成说明H5（完整版）.html 为基础，沿用其背景色、标题色、字体与 section 内容。", COLORS.blue, "#eff6ff");
  addFooter(slide, slideNo, total);
  narration(slide, "附录列出本材料融合和引用的文档版本。后续如果要形成正式会议包，建议以这张表作为资料状态索引：哪些是正式版，哪些是草案，哪些已经融合进预审口径，哪些仍只是参考文档。这样可以避免把草案内容误当成已经确认的最终结论。");
}

async function createDeck() {
  const html = await fs.readFile(HTML_PATH, "utf8");
  await ensureTopologyImage(html);
  const data = buildSourceModel(html);
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });
  const total = 29;
  slideCover(presentation, data, total);
  slideAgenda(presentation, data, total);
  slideLatestStatus(presentation, total);
  slideContents(presentation, total);
  slideGuide(presentation, total, "01", "预审定位与系统清单", "先统一会议边界，再确认系统状态和待补输入", ["会议定位：预审 + 条件性决策", "核心系统：已定、一期边界、待细化分开表达", "资料不足：降级为待补资料项"], COLORS.blue);
  slidePositioning(presentation, data, total);
  slideSystems(presentation, data, total);
  slideGuide(presentation, total, "02", "总体拓扑与四大集成域", "从系统关系进入研发、采购、制造、质量四条业务链", ["总体拓扑只表达已确认主链关系", "四大集成域展开原 H5 的点击内容", "BOM 差异决定后续转换和追溯复杂度"], COLORS.teal);
  await slideTopology(presentation, data, total);
  slideDomains(presentation, data, total);
  slideResearchDomain(presentation, data, total);
  slideBomDomain(presentation, data, total);
  slideProcureManufactureDomain(presentation, data, total);
  slideQualityDomain(presentation, data, total);
  slideGuide(presentation, total, "03", "MDM、黄金源与数据中台", "把接口问题前移到主数据、字段和权威来源治理", ["MDM 路径：组织先行、流程牵引", "黄金源：字段唯一权威来源", "Q7：数据中台/集成总线条件性决策"], COLORS.purple);
  slideMdmPath(presentation, data, total);
  slideCodingGovernance(presentation, data, total);
  slideGoldenSource(presentation, data, total);
  slideDataPlatform(presentation, data, total);
  slideGuide(presentation, total, "04", "适航追溯与关键接口", "用追溯要求倒逼接口卡、字段映射和异常处理补齐", ["Q8：零件编号 + 质量编号追溯", "接口卡：方向、触发、字段、异常", "字段映射：以 PLM→PDM 为样例"], COLORS.green);
  slideTraceability(presentation, data, total);
  slideInterfaces(presentation, data, total);
  slideInterfaceFields(presentation, data, total);
  slideGuide(presentation, total, "05", "会前行动与会议组织", "把未决问题变成责任、输出物和截止时间", ["A1/A3：已完成并进入最新状态", "A4-A8：5月8日补齐预审输入", "Q1-Q8：成熟度预审和会后补资料"], COLORS.amber);
  slideOpenIssues(presentation, data, total);
  slideActions(presentation, data, total);
  slideOrg(presentation, data, total);
  slideQuestions(presentation, data, total);
  slideAppendix(presentation, data, total);
  inspect.unshift({ kind: "deck", slideCount: presentation.slides.count, source: HTML_PATH, cssVars: data.vars });
  return presentation;
}

async function saveBlob(blob, filePath) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}

async function exportDeck(presentation) {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.writeFile(INSPECT_PATH, inspect.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  for (let idx = 0; idx < presentation.slides.items.length; idx += 1) {
    const slide = presentation.slides.items[idx];
    const png = await presentation.export({ slide, format: "png", scale: 1 });
    await saveBlob(png, path.join(PREVIEW_DIR, `slide-${String(idx + 1).padStart(2, "0")}.png`));
  }
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(OUT_PATH);
  return OUT_PATH;
}

const presentation = await createDeck();
const output = await exportDeck(presentation);
console.log(output);
