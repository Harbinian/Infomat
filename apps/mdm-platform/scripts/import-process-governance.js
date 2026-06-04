const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const sourceJsonPath = process.argv[2] || path.join(repoRoot, 'docs', 'company-sankey-data.json');
const normsDir = path.join(repoRoot, 'docs', 'norms');
const a1MarkdownPaths = fs.existsSync(normsDir)
  ? fs.readdirSync(normsDir)
    .filter(name => name.endsWith('部门-能力-流程-系统映射关系.md'))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(name => path.join(normsDir, name))
  : [];

try {
  const snapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths,
    note: 'Imported from PMO process governance snapshot'
  });
  console.log(JSON.stringify({ importedSnapshotId: snapshotId }));
} finally {
  db.close();
}
