const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const bannedTerms = [
  '候' + '选',
  '流程真' + '源',
  '正式映' + '射',
  'candi' + 'date',
  'Candi' + 'date'
];

const textExtensions = new Set([
  '.js', '.mjs', '.json', '.jsonl', '.md', '.html', '.css', '.txt', '.cmd', '.ps1', '.py', '.yml', '.yaml'
]);

const ignoredPathParts = [
  'artifacts/',
  'output/',
  'snapshots/',
  '.git/',
  'node_modules/'
];

const ignoredFiles = new Set([
  'echarts.min.js',
  'apps/mdm-platform/public/echarts.min.js',
  'docs/Demo/echarts.min.js',
  'docs/norms/echarts.min.js',
  'pmo/echarts.min.js'
]);

function toRepoPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8'
}).split(/\r?\n/).filter(Boolean);
const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
  cwd: repoRoot,
  encoding: 'utf8'
}).split(/\r?\n/).filter(Boolean);

const violations = [];

for (const relativeFile of [...new Set([...trackedFiles, ...untrackedFiles])]) {
  const repoPath = toRepoPath(relativeFile);
  const absoluteFile = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(absoluteFile)) continue;
  if (ignoredPathParts.some(part => repoPath.startsWith(part))) continue;
  if (ignoredFiles.has(repoPath)) continue;

  for (const term of bannedTerms) {
    if (repoPath.includes(term)) {
      violations.push(`${repoPath}:path: ${term}`);
    }
  }

  if (!textExtensions.has(path.extname(repoPath))) continue;

  const content = fs.readFileSync(absoluteFile, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const term of bannedTerms) {
      if (line.includes(term)) {
        violations.push(`${repoPath}:${index + 1}: ${term}`);
      }
    }
  });
}

assert.deepStrictEqual(violations, [], `Banned terminology found:\n${violations.slice(0, 200).join('\n')}`);
console.log('test-no-banned-terminology passed');
