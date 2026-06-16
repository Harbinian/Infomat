const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parseArgs(argv) {
  const args = {
    snapshot: path.join(repoRoot, 'docs', 'company-sankey-data.json'),
    a1Sources: [],
    qualityFindings: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') {
      args.snapshot = path.resolve(repoRoot, argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--snapshot=')) {
      args.snapshot = path.resolve(repoRoot, arg.slice('--snapshot='.length));
    } else if (arg === '--a1-source') {
      args.a1Sources.push(path.resolve(repoRoot, argv[index + 1] || ''));
      index += 1;
    } else if (arg.startsWith('--a1-source=')) {
      args.a1Sources.push(path.resolve(repoRoot, arg.slice('--a1-source='.length)));
    } else if (arg === '--quality-findings') {
      args.qualityFindings = path.resolve(repoRoot, argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--quality-findings=')) {
      args.qualityFindings = path.resolve(repoRoot, arg.slice('--quality-findings='.length));
    } else if (!arg.startsWith('--') && index === 0) {
      args.snapshot = path.resolve(repoRoot, arg);
    }
  }

  return args;
}

function loadQualityFindings(filePath) {
  if (!filePath) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed.findings) ? parsed.findings : [];
}

const args = parseArgs(process.argv.slice(2));

try {
  const snapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath: args.snapshot,
    a1MarkdownPaths: args.a1Sources,
    qualityFindings: loadQualityFindings(args.qualityFindings),
    note: 'Imported from PMO process governance snapshot'
  });
  console.log(JSON.stringify({ importedSnapshotId: snapshotId }));
} finally {
  db.close();
}
