const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const bannedTerms = [
  '候' + '选',
  '流程真' + '源',
  '正式映' + '射'
];

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

function findBannedTerms(line) {
  return bannedTerms.filter(term => line.includes(term));
}

// API、事件和结构字段属于稳定机器约定，不按用户可见中文术语处理。
[
  'candidate',
  'Candidate',
  'CANDIDATE',
  handoffCandidateCreatedIdentifier,
  'detail.candidate',
  'candidate_rule_code',
  'generate_candidates',
  `${handoffCandidateCreatedIdentifier}_extra`,
  `foo_${handoffCandidateCreatedIdentifier}`
].forEach(sample => {
  assert.deepStrictEqual(findBannedTerms(sample), [], `stable machine term must remain allowed: ${sample}`);
});
assert.ok(findBannedTerms('候' + '选').length > 0, 'user-facing Chinese banned term must be rejected');

const violations = [];
const filesToCheck = new Set([
  ...userFacingProcessGovernanceFiles,
  ...processIssueCardGuidanceFiles
]);

for (const repoPath of filesToCheck) {
  const absoluteFile = path.join(repoRoot, repoPath);
  assert.ok(fs.existsSync(absoluteFile), `controlled terminology file must exist: ${repoPath}`);
  const content = fs.readFileSync(absoluteFile, 'utf8');
  const lines = content.split(/\r?\n/);

  if (userFacingProcessGovernanceFiles.has(repoPath)) {
    for (const term of bannedTerms) {
      if (repoPath.includes(term)) {
        violations.push(`${repoPath}:path: ${term}`);
      }
    }

    if (repoPath === 'apps/mdm-platform/public/index.html') {
      const machineIdentifierOccurrences = content.split(handoffCandidateCreatedIdentifier).length - 1;
      assert.strictEqual(machineIdentifierOccurrences, 1, 'the stable machine event identifier must appear exactly once');
      const eventMappingPattern = new RegExp(
        handoffCandidateCreatedIdentifier + "\\s*:\\s*['\"]生成承接待核对项['\"]"
      );
      assert.ok(eventMappingPattern.test(content), 'the stable machine event identifier must only map to the approved user label');
    }
  }

  lines.forEach((line, index) => {
    if (userFacingProcessGovernanceFiles.has(repoPath)) {
      for (const term of findBannedTerms(line)) {
        violations.push(`${repoPath}:${index + 1}: ${term}`);
      }
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
