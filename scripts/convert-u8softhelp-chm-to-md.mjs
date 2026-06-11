#!/usr/bin/env node
/**
 * Convert Simplified Chinese U8 CHM help files into Markdown.
 *
 * Input:
 *   docs/U8SoftHelp/*.chm
 *
 * Output:
 *   docs/U8SoftHelp/md/*.md
 *   docs/U8SoftHelp/md/README.md
 *
 * Notes:
 *   - CHM packages are decompiled into a temporary OS directory only.
 *   - Non-Simplified packages are ignored by filename locale markers.
 *   - Images are kept as source filename markers in Markdown; CHM originals
 *     remain the media source of record.
 */

import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const sourceDir = path.resolve(repoRoot, 'docs', 'U8SoftHelp');
const outputDir = path.join(sourceDir, 'md');
const windir = process.env.windir || process.env.WINDIR || 'C:\\Windows';
const hhExe = path.join(windir, 'hh.exe');
const scriptPath = fileURLToPath(import.meta.url);

const localeExcludePattern = /(?:^|[_-])(?:en-US|zh-TW|zh-US)(?:\.|_|-|$)/i;
const localeIncludePattern = /(?:^|[_-])zh-CN(?:\.|_|-|$)/i;
const markdownDate = new Date().toISOString().slice(0, 10);
const cliArgs = process.argv.slice(2);
const singleMode = cliArgs.includes('--single');
const requestedFiles = cliArgs
  .filter((arg) => !arg.startsWith('-'))
  .map((arg) => path.basename(arg).toLowerCase());

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Source directory not found: ${sourceDir}`);
}

if (!fs.existsSync(hhExe)) {
  throw new Error(`CHM decompiler not found: ${hhExe}`);
}

assertInside(sourceDir, outputDir);

if (!singleMode && requestedFiles.length === 0) {
  if (discoverSimplifiedChineseChmFiles().length === 0) {
    throw new Error('No source CHM files found. Put source CHM packages in docs/U8SoftHelp before regenerating Markdown.');
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  runFullConversion();
  process.exit(0);
}
fs.mkdirSync(outputDir, { recursive: true });

const chmFiles = discoverSimplifiedChineseChmFiles()
  .filter((file) => requestedFiles.length === 0 || requestedFiles.includes(path.basename(file).toLowerCase()));

if (requestedFiles.length > 0 && chmFiles.length === 0) {
  throw new Error(`Requested CHM file not found in ${sourceDir}: ${requestedFiles.join(', ')}`);
}

const indexRows = [];

for (const chmPath of chmFiles) {
  const baseName = path.basename(chmPath, path.extname(chmPath));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u8softhelp-${baseName}-`));

  try {
    const result = spawnSync(hhExe, ['-decompile', tmpRoot, chmPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (result.error) {
      throw result.error;
    }

    const htmlFiles = walkFiles(tmpRoot)
      .filter((file) => /\.(?:htm|html)$/i.test(file))
      .sort((a, b) => relativeKey(tmpRoot, a).localeCompare(relativeKey(tmpRoot, b), 'zh-Hans-CN'));

    const hhcFile = walkFiles(tmpRoot).find((file) => /\.hhc$/i.test(file));
    const orderedPages = orderPages(tmpRoot, htmlFiles, hhcFile);
    const { markdown, pageCount } = buildModuleMarkdown(chmPath, baseName, orderedPages);
    const outPath = path.join(outputDir, `${baseName}.md`);

    fs.writeFileSync(outPath, markdown, 'utf8');
    indexRows.push({
      source: path.basename(chmPath),
      markdown: `${baseName}.md`,
      pages: pageCount,
    });

    console.log(`converted ${path.basename(chmPath)} -> md/${baseName}.md (${pageCount} pages)`);
  } finally {
    assertInside(os.tmpdir(), tmpRoot);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (requestedFiles.length === 0) {
  writeIndex(indexRows);
} else if (!singleMode) {
  console.log(`converted ${indexRows.length} requested CHM file(s); full index is only refreshed during a full run`);
}

function runFullConversion() {
  const rows = [];

  for (const chmPath of discoverSimplifiedChineseChmFiles()) {
    const source = path.basename(chmPath);
    const child = spawnSync(process.execPath, [scriptPath, '--single', source], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (child.stdout) {
      process.stdout.write(child.stdout);
    }

    if (child.stderr) {
      process.stderr.write(child.stderr);
    }

    const line = child.stdout
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`converted ${source} ->`));
    const match = line?.match(/^converted (.+?) -> md\/(.+?) \((\d+) pages\)$/);
    const markdown = match?.[2] || `${path.basename(chmPath, path.extname(chmPath))}.md`;
    const markdownPath = path.join(outputDir, markdown);

    if (child.error || child.status !== 0) {
      if (!match || !fs.existsSync(markdownPath)) {
        const detail = child.error ? child.error.message : `exit code ${child.status}`;
        throw new Error(`Failed converting ${source}: ${detail}`);
      }

      console.warn(`warning: ${source} returned exit code ${child.status} after writing ${markdown}`);
    }

    rows.push({
      source,
      markdown,
      pages: match ? Number(match[3]) : countMarkdownPages(markdownPath),
    });
  }

  writeIndex(rows);
}

function discoverSimplifiedChineseChmFiles() {
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.chm$/i.test(entry.name))
    .filter((entry) => isSimplifiedChineseChm(entry.name))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-Hans-CN'));
}

function isSimplifiedChineseChm(fileName) {
  if (localeExcludePattern.test(fileName)) {
    return false;
  }

  if (localeIncludePattern.test(fileName)) {
    return true;
  }

  return true;
}

function assertInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside ${resolvedParent}: ${resolvedChild}`);
  }
}

function walkFiles(dir) {
  const files = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function relativeKey(root, file) {
  return normalizeLocalPath(path.relative(root, file));
}

function normalizeLocalPath(value) {
  return decodeEntities(String(value || ''))
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .toLowerCase();
}

function orderPages(tmpRoot, htmlFiles, hhcFile) {
  const htmlByRel = new Map();
  for (const file of htmlFiles) {
    htmlByRel.set(relativeKey(tmpRoot, file), file);
  }

  const seen = new Set();
  const pages = [];

  if (hhcFile) {
    for (const item of parseHhc(hhcFile)) {
      const key = normalizeLocalPath(item.local);
      const file = htmlByRel.get(key);
      if (!file || seen.has(file)) {
        continue;
      }

      pages.push({ file, tocTitle: item.name || '' });
      seen.add(file);
    }
  }

  for (const file of htmlFiles) {
    if (!seen.has(file)) {
      pages.push({ file, tocTitle: '' });
      seen.add(file);
    }
  }

  return pages;
}

function parseHhc(file) {
  const html = decodeFile(file);
  const items = [];
  const objectPattern = /<object\b[^>]*type\s*=\s*["']?text\/sitemap["']?[^>]*>([\s\S]*?)<\/object>/gi;
  let objectMatch;

  while ((objectMatch = objectPattern.exec(html))) {
    const params = {};
    const paramPattern = /<param\b[^>]*>/gi;
    let paramMatch;

    while ((paramMatch = paramPattern.exec(objectMatch[1]))) {
      const tag = paramMatch[0];
      const name = getAttr(tag, 'name');
      const value = getAttr(tag, 'value');
      if (name) {
        params[name.toLowerCase()] = value || '';
      }
    }

    if (params.local) {
      items.push({
        name: cleanInline(params.name || ''),
        local: params.local,
      });
    }
  }

  return items;
}

function getAttr(tag, attrName) {
  const pattern = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return match ? decodeEntities(match[1] || match[2] || match[3] || '') : '';
}

function buildModuleMarkdown(chmPath, baseName, pages) {
  const chunks = [
    `# ${baseName}`,
    '',
    `- Source CHM: ${path.basename(chmPath)}`,
    `- Language: Simplified Chinese`,
    `- Converted: ${markdownDate}`,
    '',
    '> This Markdown file is generated from the Simplified Chinese CHM package. Image references are preserved as source filenames; use the original CHM for exact screenshots and embedded media.',
    '',
  ];

  const pageSummaries = [];
  const pageChunks = [];
  let pageCount = 0;

  for (const page of pages) {
    const html = decodeFile(page.file);
    const title = page.tocTitle || htmlTitle(html) || path.basename(page.file, path.extname(page.file));
    const bodyMarkdown = htmlToMarkdown(html).trim();

    if (!bodyMarkdown || visibleTextLength(bodyMarkdown) < 4) {
      continue;
    }

    pageCount += 1;
    pageSummaries.push(`${pageCount}. ${title}`);
    pageChunks.push(`## ${title}`);
    pageChunks.push('');
    pageChunks.push(`Source page: \`${normalizeLocalPath(path.basename(page.file))}\``);
    pageChunks.push('');
    pageChunks.push(bodyMarkdown);
    pageChunks.push('');
  }

  chunks.push('## Page Index');
  chunks.push('');
  chunks.push(pageSummaries.length ? pageSummaries.join('\n') : '- No readable HTML pages found.');
  chunks.push('');
  chunks.push(...pageChunks);

  return {
    markdown: normalizeMarkdown(chunks.join('\n')),
    pageCount,
  };
}

function decodeFile(file) {
  const buffer = fs.readFileSync(file);
  const header = new TextDecoder('latin1').decode(buffer.subarray(0, Math.min(buffer.length, 4096)));
  const charsetMatch = header.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i);
  const charset = (charsetMatch?.[1] || '').toLowerCase();
  const encoding = charset.includes('utf') ? 'utf-8' : 'gb18030';

  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder('gb18030').decode(buffer);
  }
}

function htmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? cleanInline(match[1]) : '';
}

function htmlToMarkdown(inputHtml) {
  let html = inputHtml
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '');

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    html = bodyMatch[1];
  }

  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    const text = cleanPre(body);
    return text ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : '\n\n';
  });

  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = cleanInline(getAttr(tag, 'alt') || getAttr(tag, 'title'));
    const src = cleanInline(getAttr(tag, 'src'));
    const label = alt || src;
    return label ? `\n\n[Image: ${label}]\n\n` : '\n\n';
  });

  html = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, body) => {
    const label = cleanInline(body);
    const href = getAttr(tag, 'href');

    if (!label) {
      return '';
    }

    if (/^(?:https?:|mailto:)/i.test(href)) {
      return `[${label}](${href})`;
    }

    return label;
  });

  for (let level = 6; level >= 1; level -= 1) {
    const pattern = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    html = html.replace(pattern, (_, body) => {
      const text = cleanInline(body);
      return text ? `\n\n${'#'.repeat(Math.min(level + 2, 6))} ${text}\n\n` : '\n\n';
    });
  }

  html = html
    .replace(/<tr\b[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<(?:td|th)\b[^>]*>/gi, ' | ')
    .replace(/<\/(?:td|th)>/gi, ' | ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '\n\n')
    .replace(/<\/(?:div|section|article|blockquote|ul|ol|dl)>/gi, '\n\n')
    .replace(/<(?:div|section|article|blockquote|ul|ol|dl)\b[^>]*>/gi, '\n\n')
    .replace(/<dt\b[^>]*>/gi, '\n- ')
    .replace(/<\/dt>/gi, '\n')
    .replace(/<dd\b[^>]*>/gi, '\n  ')
    .replace(/<\/dd>/gi, '\n')
    .replace(/<\/(?:span|font|strong|b|em|i|u)>/gi, '')
    .replace(/<(?:span|font|strong|b|em|i|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');

  html = decodeEntities(html)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\|[ \t]*/g, ' | ')
    .replace(/\n{3,}/g, '\n\n');

  return normalizeMarkdown(html);
}

function cleanInline(html) {
  return decodeEntities(String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPre(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    const lower = entity.toLowerCase();

    if (lower.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }

    if (lower.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }

    return Object.prototype.hasOwnProperty.call(namedEntities, lower) ? namedEntities[lower] : `&${entity};`;
  });
}

function visibleTextLength(markdown) {
  return markdown
    .replace(/`[^`]*`/g, '')
    .replace(/\[[^\]]*?\]\([^)]*?\)/g, '')
    .replace(/[#*\-_|>\s]/g, '')
    .length;
}

function countMarkdownPages(file) {
  if (!fs.existsSync(file)) {
    return 0;
  }

  const markdown = fs.readFileSync(file, 'utf8');
  return (markdown.match(/^Source page:/gm) || []).length;
}

function normalizeMarkdown(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function writeIndex(rows) {
  const lines = [
    '# U8SoftHelp Markdown Index',
    '',
    `Converted: ${markdownDate}`,
    '',
    'This directory contains Markdown generated from Simplified Chinese U8 CHM help packages.',
    '',
    '| Source CHM | Markdown | Pages |',
    '|---|---:|---:|',
  ];

  for (const row of rows) {
    lines.push(`| ${row.source} | [${row.markdown}](./${encodeURI(row.markdown)}) | ${row.pages} |`);
  }

  fs.writeFileSync(path.join(outputDir, 'README.md'), `${lines.join('\n')}\n`, 'utf8');
}
