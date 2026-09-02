import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  LIMITS,
  instructionChainFor,
  isValidUtf8Prefix,
  runChecks,
} from './check-codex-context.mjs';

const ROUTING_MARKER = '<!-- codex-context-routing:authoritative -->';

function writeFixtureFile(root, relativePath, content) {
  const absolutePath = resolve(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function ownership(registry) {
  return [
    '# Directory ownership',
    '',
    '<!-- codex-context-registry:start -->',
    '```text',
    ...registry,
    '```',
    '<!-- codex-context-registry:end -->',
    '',
  ].join('\n');
}

function makeFixture(files, registry) {
  const root = mkdtempSync(join(tmpdir(), 'infomat-codex-context-'));
  writeFixtureFile(root, 'AGENTS.md', `# Root\n\n${ROUTING_MARKER}\n`);
  writeFixtureFile(root, 'DIRECTORY_OWNERSHIP.md', ownership(registry));
  for (const [relativePath, content] of Object.entries(files)) {
    writeFixtureFile(root, relativePath, content);
  }
  return root;
}

function errorCodes(report) {
  return new Set(report.errors.map(error => error.code));
}

function expectError(files, registry, expectedCode, mutateRoot) {
  const root = makeFixture(files, registry);
  try {
    if (mutateRoot) mutateRoot(root);
    const report = runChecks(root, { similarity: false });
    assert.equal(report.ok, false, `expected failure ${expectedCode}`);
    assert.ok(errorCodes(report).has(expectedCode), `missing ${expectedCode}: ${JSON.stringify(report.errors)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

expectError(
  {
    'pmo/AGENTS.md': 'p'.repeat(5600),
    'pmo/gantt-react/AGENTS.md': 'g'.repeat(5600),
  },
  ['pmo/AGENTS.md', 'pmo/gantt-react/AGENTS.md'],
  'CHAIN_BUDGET_EXCEEDED',
  root => writeFixtureFile(root, 'AGENTS.md', `${ROUTING_MARKER}\n${'r'.repeat(5600)}`),
);

expectError(
  { 'scripts/AGENTS.md': '# scripts' },
  ['scripts/AGENTS.md'],
  'ROOT_BUDGET_EXCEEDED',
  root => writeFixtureFile(root, 'AGENTS.md', `${ROUTING_MARKER}\n${'r'.repeat(LIMITS.rootBytes + 1)}`),
);

expectError(
  { 'apps/structured-output-service/AGENTS.md': 's'.repeat(LIMITS.structuredOutputBytes + 1) },
  ['apps/structured-output-service/AGENTS.md'],
  'STRUCTURED_OUTPUT_BUDGET_EXCEEDED',
);

expectError(
  { 'apps/unregistered/AGENTS.md': '# local' },
  [],
  'UNREGISTERED_AGENT',
);

expectError(
  {},
  ['apps/missing/AGENTS.md'],
  'REGISTERED_AGENT_MISSING',
);

expectError(
  { 'scripts/AGENTS.md': '# scripts' },
  ['scripts/AGENTS.md'],
  'ROOT_APPLICATION_DETAIL_LEAK',
  root => writeFixtureFile(root, 'AGENTS.md', `# Root\n\n${ROUTING_MARKER}\n\n## MDM 角色工作台约定\n`),
);

const utf8 = Buffer.from('A中B', 'utf8');
assert.equal(isValidUtf8Prefix(utf8, 2), false, 'a UTF-8 prefix ending inside 中 must fail');
assert.equal(isValidUtf8Prefix(utf8, 4), true, 'a UTF-8 prefix ending after 中 must pass');

const validRoot = makeFixture(
  {
    'pmo/AGENTS.md': '# PMO local interface',
    'pmo/gantt-react/AGENTS.md': '# Gantt local interface',
  },
  ['pmo/AGENTS.md', 'pmo/gantt-react/AGENTS.md'],
);
try {
  const report = runChecks(validRoot, { similarity: false });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(
    instructionChainFor(validRoot, 'pmo/gantt-react/AGENTS.md'),
    ['AGENTS.md', 'pmo/AGENTS.md', 'pmo/gantt-react/AGENTS.md'],
  );
  const ganttChain = report.chains.find(chain => chain.leaf === 'pmo/gantt-react/AGENTS.md');
  assert.deepEqual(
    ganttChain.files.map(file => file.path),
    ['AGENTS.md', 'pmo/AGENTS.md', 'pmo/gantt-react/AGENTS.md'],
  );
} finally {
  rmSync(validRoot, { recursive: true, force: true });
}

console.log('Codex context fixture checks passed');
