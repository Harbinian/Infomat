// Read-only maintenance guard for native formats and active entry names.
// No app startup, database, private configuration, file writes or notifications.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const failures = [];
const legacyWrappers = new Set(['processV7PreviewReview.js', 'processV7PreviewReviewRepository.js']);
const frozenV4 = new Map([
  ['server/rules/v7-content-v4/structure-score.js', 'c9f17290bc07a2c3b58bc00645571b33549f2b8c38d2ace562c01eab69640b1a'],
  ['server/rules/v7-content-v4/processContentChecks.js', 'e435e89c52dd024c8686914f9fb7002fb4198377ea519c2fdfb8bc98ce0c2b72']
]);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
function reject(file, lines, pattern, reason) {
  lines.forEach((line, index) => { if (pattern.test(line)) failures.push(`${path.relative(root, file)}:${index + 1}: ${reason}`); });
}
for (const relative of frozenV4.keys()) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`${relative}: frozen v4 evaluator is missing`);
}
for (const file of walk(path.join(root, 'server')).filter(f => f.endsWith('.js'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (frozenV4.has(relative)) {
    // A historical evaluator must retain its old format semantics, not inherit
    // current gates. The exception is bound to immutable bytes, not a directory.
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash !== frozenV4.get(relative)) failures.push(`${relative}: frozen v4 evaluator bytes changed`);
    continue;
  }
  const basename = path.basename(file);
  if (legacyWrappers.has(basename) || /Migration|Schema/.test(basename) || basename === 'v7AnalysisRules.js') continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  reject(file, lines, /schema_version\s*(?:===?|!==?)\s*['"]process-governance-v7['"]/, 'active format gate must use the shared native format policy');
  reject(file, lines, /\[\s*['"]process-governance-v[78]['"]\s*,\s*['"]process-governance-v[78]['"]\s*\]\.includes/, 'duplicated native format gate');
  reject(file, lines, /require\(['"]\.{1,2}\/processV7PreviewReview(?:Repository)?['"]\)/, 'active consumer must use the canonical preview module');
}
const misleading = /(?:V7预览核对|V7文件内容|正式V7|固定V7证据全部|V7 预览修订|V7 来源映射|V7 映射固定版本|['">]V7 固定来源|受支持\s+流程固定来源)/;
for (const file of [...walk(path.join(root, 'frontend/src')).filter(f => /\.(js|jsx)$/.test(f)), ...['server/processPreviewReview.js', 'server/processPreviewReviewRepository.js', 'server/routes/processPreviewReview.js', 'server/processDesignApplication.js', 'server/processDesignValidation.js'].map(f => path.join(root, f))]) {
  reject(file, fs.readFileSync(file, 'utf8').split(/\r?\n/), misleading, 'current user-facing text must describe native V8/V7 or the generic workflow');
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('NATIVE_PROCESS_CONSISTENCY_PASSED: active format gates, canonical preview consumers and user-facing labels');
