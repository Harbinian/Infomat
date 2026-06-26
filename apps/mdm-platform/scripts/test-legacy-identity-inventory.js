const assert = require('assert');
const fs = require('fs');
const path = require('path');

const serverDir = path.join(__dirname, '..', 'server');

const targetFiles = [
  'processGovernanceMysqlRepository.js',
  'processGovernanceIssuePoolRepository.js',
  'dataMapMysqlRepository.js',
  'mappingMysqlRepository.js',
  'conflictMysqlRepository.js',
  'todoMysqlRepository.js',
  'terminologyMysqlRepository.js'
];

const oldToPersonFields = [
  ['owner_user_id', 'owner_person_id'],
  ['actor_user_id', 'actor_person_id'],
  ['assignee_user_id', 'assignee_person_id'],
  ['operator_user_id', 'operator_person_id'],
  ['steward_user_id', 'steward_person_id'],
  ['submitted_by', 'submitted_by_person_id'],
  ['reviewed_by', 'reviewed_by_person_id'],
  ['created_by', 'created_by_person_id'],
  ['updated_by', 'updated_by_person_id'],
  ['assigned_by', 'assigned_by_person_id'],
  ['operated_by', 'operated_by_person_id']
];

const writeMarkers = /\b(INSERT INTO|UPDATE|SET|VALUES|WHERE|JOIN)\b/i;

function lineWindow(lines, index) {
  const start = Math.max(0, index - 3);
  const end = Math.min(lines.length, index + 4);
  return lines.slice(start, end).join('\n');
}

const findings = [];

for (const file of targetFiles) {
  const filePath = path.join(serverDir, file);
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!writeMarkers.test(line)) return;
    for (const [oldField, personField] of oldToPersonFields) {
      if (!line.includes(oldField)) continue;
      const block = lineWindow(lines, index);
      if (block.includes(personField)) continue;
      findings.push({
        file,
        line: index + 1,
        oldField,
        personField,
        source: line.trim()
      });
    }
  });
}

if (findings.length > 0) {
  console.error('Legacy identity target writes still need person-field pairs:');
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} ${finding.oldField} -> ${finding.personField} :: ${finding.source}`
    );
  }
}

assert.strictEqual(findings.length, 0, 'legacy identity target write inventory is not clean');

console.log('Legacy identity inventory guard passed');
