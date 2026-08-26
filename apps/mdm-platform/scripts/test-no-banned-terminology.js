const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const bannedTerms = [
  '候' + '选',
  '流程真' + '源',
  '正式映' + '射'
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

const userFacingProcessGovernanceFiles = new Set([
  'apps/mdm-platform/public/index.html'
]);

const processIssueCardGuidanceFiles = new Set([
  'AGENTS.md',
  '.agents/skills/process-evidence-mapping/SKILL.md',
  'apps/mdm-platform/docs/role-based-usage-guide.md'
]);

const processIssueCardBannedTerms = [
  '回' + '源',
  '固定' + '原因',
  '原输出' + '目标部门',
  '需要补充' + '依据',
  '建议' + '修订',
  '请再' + '确认',
  '存在不同' + '意见',
  '术语' + '真源'
];

const handoffCandidateCreatedIdentifier = ['handoff', 'candidate', 'created'].join('_');
const allowedMachineIdentifierPattern = new RegExp(
  '(^|[^A-Za-z0-9_])' + handoffCandidateCreatedIdentifier + '(?=[^A-Za-z0-9_]|$)',
  'g'
);

function maskAllowedMachineIdentifier(line) {
  return line.replace(allowedMachineIdentifierPattern, '$1');
}

function findBannedTerms(line) {
  const maskedLine = maskAllowedMachineIdentifier(line);
  const hits = bannedTerms.filter(term => maskedLine.includes(term));
  if (/candidate/i.test(maskedLine)) hits.push('candidate');
  return hits;
}

assert.deepStrictEqual(findBannedTerms(handoffCandidateCreatedIdentifier), [], 'the exact machine event identifier must remain allowed');
[
  'candidate',
  'Candidate',
  'CANDIDATE',
  '候' + '选',
  `${handoffCandidateCreatedIdentifier} candidate`,
  `${handoffCandidateCreatedIdentifier}候` + '选',
  `${handoffCandidateCreatedIdentifier}_extra`,
  `foo_${handoffCandidateCreatedIdentifier}`
].forEach(sample => {
  assert.ok(findBannedTerms(sample).length > 0, `user-facing sample must be rejected: ${sample}`);
});

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

  if (!userFacingProcessGovernanceFiles.has(repoPath)) continue;

  for (const term of bannedTerms) {
    if (repoPath.includes(term)) {
      violations.push(`${repoPath}:path: ${term}`);
    }
  }

  if (!textExtensions.has(path.extname(repoPath))) continue;

  const content = fs.readFileSync(absoluteFile, 'utf8');
  const lines = content.split(/\r?\n/);

  if (repoPath === 'apps/mdm-platform/public/index.html') {
    const machineIdentifierOccurrences = content.split(handoffCandidateCreatedIdentifier).length - 1;
    assert.strictEqual(machineIdentifierOccurrences, 1, 'the stable machine event identifier must appear exactly once');
    const eventMappingPattern = new RegExp(
      handoffCandidateCreatedIdentifier + "\\s*:\\s*['\"]生成承接待核对项['\"]"
    );
    assert.ok(eventMappingPattern.test(content), 'the stable machine event identifier must only map to the approved user label');
  }

  lines.forEach((line, index) => {
    for (const term of findBannedTerms(line)) {
      violations.push(`${repoPath}:${index + 1}: ${term}`);
    }

    if (processIssueCardGuidanceFiles.has(repoPath)) {
      for (const term of processIssueCardBannedTerms) {
        if (line.includes(term)) {
          violations.push(`${repoPath}:${index + 1}: process issue card wording: ${term}`);
        }
      }
    }
  });
}

assert.deepStrictEqual(violations, [], `Banned terminology found:\n${violations.slice(0, 200).join('\n')}`);
console.log('test-no-banned-terminology passed');
