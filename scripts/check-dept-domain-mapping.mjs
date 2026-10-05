/**
 * Validate a historical display map, optionally comparing a preserved snapshot.
 * No Markdown organization copy is interpreted as current business authority.
 * Usage: node scripts/check-dept-domain-mapping.mjs [--domain-map <json>] [--snapshot <json>]
 * With no arguments, compare the preserved technical contract and legacy snapshot.
 * Read-only: no files, database connections or services are created.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readLegacyDepartmentDomains } from './legacy-department-domains.mjs';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const options = {};
for (let index = 0; index < argv.length; index += 1) {
  if (!['--domain-map', '--snapshot'].includes(argv[index])) throw new Error(`Unknown argument: ${argv[index]}`);
  const value = argv[++index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argv[index - 1]}`);
  options[argv[index - 1]] = resolve(value);
}
const domainMapPath = options['--domain-map'] || resolve(root, 'docs/contracts/dcm-bbm-contract.json');
const departments = readLegacyDepartmentDomains(domainMapPath);
const snapshotPath = options['--snapshot'] || (!argv.length && resolve(root, 'docs/company-sankey-data.json'));
if (snapshotPath) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert.ok(Array.isArray(snapshot.links), 'historical display snapshot must contain links');
  for (const [department, domain] of Object.entries(departments)) {
    assert.ok(snapshot.links.some(link => link.source === domain && link.target === department),
      `historical display snapshot has no explicit ${domain} -> ${department} link`);
  }
  const domains = new Set(Object.values(departments));
  const actualDepartments = snapshot.links.filter(link => domains.has(link.source)).map(link => link.target).sort();
  assert.deepEqual(actualDepartments, Object.keys(departments).sort(), 'historical snapshot and domain input department lists differ');
}
console.log(`Historical department/domain compatibility check passed: ${Object.keys(departments).length} departments; current organization unverified`);
