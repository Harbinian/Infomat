/**
 * Isolated behavior checks for historical input gates and owned output cleanup.
 * Writes new fixtures under ignored artifacts/repo-audit and a unique retention
 * sentinel/audit test batch under artifacts/customer-file-acceptance. No real database,
 * notification, existing service or preserved snapshot is changed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readLegacyDepartmentDomains, validateLegacyDepartmentDomains } from './legacy-department-domains.mjs';
import { injectLegacyDashboard } from './parse-sankey-data.mjs';
import { createRenderProfile, parseRenderArguments, removeRenderProfile } from './render_gantt_h5_png.mjs';

const root = resolve(import.meta.dirname, '..');
const runDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const parent = join(root, 'artifacts', 'repo-audit', runDate);
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(join(parent, 'root-script-safety-'));
const preservedPaths = ['docs/company-sankey-data.json', 'docs/work-role-data.json', 'pmo/procedure-management/dashboard.html'];
const preservedHashes = preservedPaths.map(file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex'));
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
const run = (script, args = [], env = {}) => spawnSync(process.execPath, [join(root, script), ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000, windowsHide: true,
});
const denied = (result, pattern) => {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
};
const passed = result => assert.equal(result.status, 0, result.stderr || result.stdout);

const customerAuditParent = join(root, 'artifacts', 'customer-file-acceptance');
mkdirSync(customerAuditParent, { recursive: true });
const retainedAuditSentinel = join(customerAuditParent, `${basename(fixture)}-retained.txt`);
writeFileSync(retainedAuditSentinel, 'shared audit output must be preserved', { flag: 'wx' });
passed(run('scripts/test-customer-file-acceptance-audit.mjs'));
assert.equal(readFileSync(retainedAuditSentinel, 'utf8'), 'shared audit output must be preserved', 'audit regression must not delete its shared parent');

const domainInput = join(fixture, 'domains.json');
writeJson(domainInput, { departments: { '质量管理部': 'fixture-domain' } });
assert.deepEqual(readLegacyDepartmentDomains(domainInput), { '质量管理部': 'fixture-domain' });
for (const malformed of [{}, { departments: {} }, { departments: [] }, { departments: { '质量管理部': '' } }, { departments: { '质量管理部': null } }, { departments: { ' 部门': '域' } }]) {
  assert.throws(() => validateLegacyDepartmentDomains(malformed));
}
passed(run('scripts/check-dept-domain-mapping.mjs', ['--domain-map', domainInput]));
const badSnapshot = join(fixture, 'bad-map-snapshot.json');
writeJson(badSnapshot, { links: [{ source: 'other-domain', target: '质量管理部' }] });
denied(run('scripts/check-dept-domain-mapping.mjs', ['--domain-map', domainInput, '--snapshot', badSnapshot]), /no explicit/);

const parserOut = join(fixture, 'parsed.json');
denied(run('scripts/parse-sankey-data.mjs', ['--out', parserOut]), /--legacy-display/);
assert.equal(existsSync(parserOut), false);
denied(run('scripts/build-work-role-data.mjs'), /--legacy-display.*--source.*--roster.*--out/);
denied(run('scripts/build-project-governance-report.mjs'), /--legacy-display.*--out.*--json-out/);
denied(run('scripts/process-governance-templates/build-template-data.mjs', ['--out', join(fixture, 'template-data.json')]), /--legacy-display/);
denied(run('scripts/process-governance-templates/build-template-data.mjs', ['--legacy-display', '--out', join(fixture, 'template-data.json'), '--package-date', '2026-02-30']), /Invalid package date/);

const norms = join(fixture, 'norms');
mkdirSync(norms);
writeFileSync(join(norms, '质量管理部部门-能力-流程-系统映射关系.md'), readFileSync(join(root, 'scripts/fixtures/parse-sankey-structure-block/structured-dept.md')));
const cross = join(fixture, 'cross.md');
const chains = join(fixture, 'chains.md');
writeFileSync(cross, '# Synthetic legacy report\n');
writeFileSync(chains, '# Synthetic legacy chain report\n');
const roles = join(fixture, 'roles.json');
writeJson(roles, { schemaVersion: 'work-role-data-v1', workRoles: [], workRolePositionMappings: [] });
const parserArgs = ['--legacy-display', '--domain-map', domainInput, '--out', parserOut, '--norms', norms, '--cross-report', cross, '--chain-report', chains, '--work-roles', roles];
const html = '<script type="application/json" id="sankey-data">{}</script><script type="application/json" id="cross-dept-data">{}</script>';
const dashboard = join(fixture, 'dashboard.html');
writeFileSync(dashboard, html);
passed(run('scripts/parse-sankey-data.mjs', [...parserArgs, '--dashboard', dashboard]));
const parsed = JSON.parse(readFileSync(parserOut, 'utf8'));
assert.equal(parsed.meta.historicalDisplayOnly, true);
assert.equal(parsed.stats.mappings, 2);
assert.ok(parsed.links.some(link => link.source === 'fixture-domain' && link.target === '质量管理部'));
assert.ok(parsed.sourceManifest.files.some(file => file.assetType === 'legacy_department_domains' && file.path.endsWith('domains.json')));
const incompleteDomain = join(fixture, 'incomplete-domains.json');
writeJson(incompleteDomain, { departments: { 'Other fixture department': 'fixture-domain' } });
denied(run('scripts/parse-sankey-data.mjs', parserArgs.map(value => value === domainInput ? incompleteDomain : value)), /no department/);
const beforeBadHtml = readFileSync(parserOut, 'utf8');
writeFileSync(dashboard, '<p>missing tags</p>');
denied(run('scripts/parse-sankey-data.mjs', [...parserArgs, '--dashboard', dashboard]), /Expected exactly one sankey-data/);
assert.equal(readFileSync(parserOut, 'utf8'), beforeBadHtml, 'bad HTML must not partially replace the snapshot');
const injected = injectLegacyDashboard(html, { preserved: '$&</script><p>fixture</p>', crossDept: { marker: '<' } });
assert.ok(!injected.includes('<p>fixture</p>'), 'embedded JSON must not break out of its script tag');
const embedded = injected.match(/id="sankey-data">([\s\S]*?)<\/script>/)[1];
assert.equal(JSON.parse(embedded).preserved, '$&</script><p>fixture</p>');
assert.throws(() => injectLegacyDashboard(html + html, parsed), /Expected exactly one/);
denied(run('scripts/parse-sankey-data.mjs', parserArgs.map(value => value === parserOut ? domainInput : value)), /Output cannot overwrite/);

const fakeNpm = join(fixture, 'fake-npm.cjs');
const importLog = join(fixture, 'import-call.json');
writeFileSync(fakeNpm, "require('node:fs').writeFileSync(process.env.ROOT_SAFETY_IMPORT_LOG,JSON.stringify(process.argv.slice(2)));\n");
const env = { npm_execpath: fakeNpm, ROOT_SAFETY_IMPORT_LOG: importLog, MYSQL_HOST: 'fixture-host', MYSQL_PORT: '3307', MYSQL_USER: 'fixture-user', MYSQL_PASSWORD: 'root-safety-secret-sentinel', MYSQL_DATABASE: 'fixture-db' };
denied(run('scripts/sync-process-governance-mainline.mjs', [], env), /--legacy-display.*--snapshot/);
assert.equal(existsSync(importLog), false);
const plan = run('scripts/sync-process-governance-mainline.mjs', ['--legacy-display', '--snapshot', parserOut], env);
passed(plan);
assert.equal(JSON.parse(plan.stdout).databaseWrites, false);
assert.equal(existsSync(importLog), false, 'planning must not spawn a database importer');
const checkEnv = run('scripts/sync-process-governance-mainline.mjs', ['--check-env'], env);
passed(checkEnv);
assert.ok(!checkEnv.stdout.includes(env.MYSQL_PASSWORD));
const missingEnv = { ...env, MYSQL_PASSWORD: '' };
denied(run('scripts/sync-process-governance-mainline.mjs', ['--legacy-display', '--snapshot', parserOut, '--apply'], missingEnv), /MYSQL_PASSWORD/);
assert.equal(existsSync(importLog), false);
passed(run('scripts/sync-process-governance-mainline.mjs', ['--legacy-display', '--snapshot', parserOut, '--apply'], env));
assert.deepEqual(JSON.parse(readFileSync(importLog, 'utf8')), ['run', 'import:process-governance-mysql', '--', '--snapshot', parserOut]);

const profileParent = join(fixture, 'profile-parent');
mkdirSync(profileParent);
const sentinel = join(profileParent, 'existing-profile-data.txt');
writeFileSync(sentinel, 'preserve');
await assert.rejects(parseRenderArguments(['--profile-dir', profileParent]), /--input/);
await assert.rejects(parseRenderArguments(['--input', join(fixture, 'missing.html'), '--profile-dir', profileParent]), /not found/);
const selected = await parseRenderArguments(['--input', dashboard, '--profile-dir', profileParent]);
assert.equal(selected.profileParent, profileParent);
assert.match(selected.output, /artifacts[\\/]pmo[\\/]gantt8k/);
const owned = await createRenderProfile(profileParent);
assert.ok(existsSync(owned.profilePath));
await assert.rejects(removeRenderProfile({ parentPath: profileParent, profilePath: profileParent }), /outside/);
await removeRenderProfile(owned);
assert.equal(existsSync(owned.profilePath), false);
assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
symlinkSync(profileParent, owned.profilePath, 'junction');
await assert.rejects(removeRenderProfile(owned), /replaced or redirected/);
unlinkSync(owned.profilePath);
denied(run('scripts/render_gantt_h5_png.mjs', ['--input', dashboard, '--profile-dir', profileParent, '--chrome', join(fixture, 'missing-browser.exe'), '--port', '33993']), /ENOENT/);
assert.deepEqual(readdirSync(profileParent), ['existing-profile-data.txt'], 'failed browser must clean only its new profile');

const pythonMissing = spawnSync('python', [join(root, 'scripts/generate_digital_project_gantt_8k.py')], { cwd: root, encoding: 'utf8' });
denied(pythonMissing, /--source/);
const pythonBad = spawnSync('python', [join(root, 'scripts/generate_digital_project_gantt_8k.py'), '--source', join(fixture, 'missing.md')], { cwd: root, encoding: 'utf8' });
denied(pythonBad, /Historical Gantt source file not found/);

const packageData = join(fixture, 'package.json');
const packageOut = join(fixture, 'package-out');
mkdirSync(packageOut);
const pkg = { packageDate: '2026-10-05', generatedAt: '2026-07-17T00:00:00Z', snapshotDate: '2026-06-09', departments: [{ name: '合成部门', counts: {} }], totals: {} };
writeJson(packageData, pkg);
writeFileSync(join(packageOut, '合成部门_流程与数据梳理模板_2026-10-05.xlsx'), 'synthetic file existence fixture');
writeFileSync(join(packageOut, '流程与数据梳理填写及评审标准_2026-10-05.docx'), 'synthetic file existence fixture');
passed(run('scripts/process-governance-templates/build-manifest.mjs', ['--data', packageData, '--output', packageOut]));
assert.match(readFileSync(join(packageOut, '交付清单.md'), 'utf8'), /编制日期：2026-10-05/);
delete pkg.packageDate;
writeJson(packageData, pkg);
writeFileSync(join(packageOut, '合成部门_流程与数据梳理模板_2026-07-17.xlsx'), 'legacy synthetic file');
writeFileSync(join(packageOut, '流程与数据梳理填写及评审标准_2026-07-17.docx'), 'legacy synthetic file');
passed(run('scripts/process-governance-templates/build-manifest.mjs', ['--data', packageData, '--output', packageOut]));
assert.match(readFileSync(join(packageOut, '交付清单.md'), 'utf8'), /编制日期：2026-07-17/);

for (const [index, file] of preservedPaths.entries()) {
  assert.equal(createHash('sha256').update(readFileSync(join(root, file))).digest('hex'), preservedHashes[index], `preserved asset changed: ${file}`);
}
writeJson(join(fixture, 'verification.json'), { ok: true, scope: 'isolated_root_script_behavior', realDatabaseConnections: 0, existingServicesChanged: 0, preservedSnapshotsUnchanged: true });
console.log(`Root script safety behavior checks passed: ${fixture}`);
