#!/usr/bin/env node
// Glossary lookup — grep docs/glossary.md by keyword, domain, or abbreviation
// Usage: node scripts/glossary.mjs <keyword>            full-text search
//        node scripts/glossary.mjs --domain <1-5>       list domain
//        node scripts/glossary.mjs --abbr <ABBR>        lookup abbreviation
//        node scripts/glossary.mjs --list               list all terms

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const glossaryPath = join(__dirname, '..', 'docs', 'glossary.md');

const text = readFileSync(glossaryPath, 'utf-8');

const domainHeaders = {
  1: '## 1. 业务域',
  2: '## 2. 主数据域',
  3: '## 3. 体系文件域',
  4: '## 4. 技术域',
  5: '## 5. 供应链协同域',
};

function extractSection(startMarker, nextMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = nextMarker ? text.indexOf(nextMarker, start) : text.length;
  if (end === -1) return text.slice(start);
  return text.slice(start, end);
}

function parseRows(section) {
  const rows = [];
  const lines = section.split('\n');
  for (const line of lines) {
    if (line.startsWith('| ') && !line.startsWith('| 术语') && !line.startsWith('|---') && !line.startsWith('| 缩写')) {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) rows.push({ term: parts[0], abbr: parts[1], def: parts[2] });
    }
  }
  return rows;
}

function parseAbbrRows(section) {
  const rows = [];
  const lines = section.split('\n');
  for (const line of lines) {
    if (line.startsWith('| ') && !line.startsWith('| 缩写') && !line.startsWith('|---')) {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) rows.push({ abbr: parts[0], full: parts[1], domain: parts[2] });
    }
  }
  return rows;
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  node scripts/glossary.mjs <keyword>        Full-text search
  node scripts/glossary.mjs --domain <1-5>   List all terms in a domain
  node scripts/glossary.mjs --domains         List domain names
  node scripts/glossary.mjs --abbr <ABBR>    Lookup abbreviation
  node scripts/glossary.mjs --list            List all terms`);
  process.exit(0);
}

if (args[0] === '--domains') {
  for (const [k, v] of Object.entries(domainHeaders)) {
    console.log(`${k}: ${v.replace('## ', '')}`);
  }
  process.exit(0);
}

if (args[0] === '--domain') {
  const domain = args[1];
  const header = domainHeaders[domain];
  if (!header) { console.error(`Unknown domain: ${domain}. Use --domains to list.`); process.exit(1); }
  const nextHeader = domain < 5 ? domainHeaders[Number(domain) + 1] : '## 附录';
  const section = extractSection(header, nextHeader);
  const rows = parseRows(section);
  for (const r of rows) {
    console.log(`${r.term}  [${r.abbr}]  ${r.def}`);
  }
  process.exit(0);
}

if (args[0] === '--abbr') {
  const abbr = args[1].toUpperCase();
  const appendix = extractSection('## 附录：缩写速查表', null);
  const rows = parseAbbrRows(appendix);
  const match = rows.find(r => r.abbr.toUpperCase() === abbr);
  if (match) {
    console.log(`${match.abbr}: ${match.full}  (${match.domain})`);
  } else {
    console.log(`Abbreviation "${abbr}" not found.`);
  }
  process.exit(0);
}

if (args[0] === '--list') {
  for (let d = 1; d <= 5; d++) {
    const header = domainHeaders[d];
    const nextHeader = d < 5 ? domainHeaders[d + 1] : '## 附录';
    const section = extractSection(header, nextHeader);
    const rows = parseRows(section);
    console.log(`\n${'='.repeat(60)}`);
    console.log(header.replace('## ', ''));
    console.log('='.repeat(60));
    for (const r of rows) {
      console.log(`  ${r.term}  [${r.abbr}]`);
    }
  }
  process.exit(0);
}

// Full-text search
const keyword = args[0].toLowerCase();
const lines = text.split('\n');
const results = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].toLowerCase().includes(keyword) && lines[i].startsWith('|')) {
    results.push(lines[i].trim());
  }
}
if (results.length === 0) {
  console.log(`No results for "${args[0]}".`);
} else {
  for (const r of results) {
    console.log(r);
  }
}
