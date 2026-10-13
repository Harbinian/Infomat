#!/usr/bin/env node
// R06 static guard. Scans the server tree for the two habits the security log replaced:
// printing driver errors directly, and letting free text (a message or a stack) into a record.
// Exits non-zero on any finding. Reads files only; starts nothing.
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../server');
// analysisWorker.js already logs through an injected allow-list logger and is the pattern this
// change generalises; securityLog.js is the implementation.
const CONSOLE_ALLOWED = new Set(['analysisWorker.js', 'securityLog.js']);
const FREE_TEXT = /(error|err|e)\s*\.\s*(message|stack|sql|sqlMessage|parameters)\b/;

const findings = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const relative = path.relative(SERVER, full).split(path.sep).join('/');
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const where = `${relative}:${index + 1}`;
      if (/console\.error\s*\(/.test(line) && !CONSOLE_ALLOWED.has(entry.name)) {
        findings.push({ at: where, rule: 'console.error', text: line.trim() });
      }
      if (/console\.(log|warn|error|info)\s*\(/.test(line) && FREE_TEXT.test(line)) {
        findings.push({ at: where, rule: 'free-text-log', text: line.trim() });
      }
      if (/(securityLog|logRequestFailure)\s*\(/.test(line) && FREE_TEXT.test(line)) {
        findings.push({ at: where, rule: 'free-text-record', text: line.trim() });
      }
    });
  }
}
walk(SERVER);

for (const finding of findings) console.log(`${finding.rule}\t${finding.at}\t${finding.text}`);
console.log(`security log hygiene: ${findings.length} finding(s) across ${SERVER}`);
if (findings.length) process.exitCode = 1;
