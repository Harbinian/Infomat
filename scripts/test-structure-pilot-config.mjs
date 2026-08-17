import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const configPath = path.join(repoRoot, 'apps', 'structure-assistant', 'config', 'pilot.config.json');
const packagePath = path.join(repoRoot, 'package.json');
const assistantPackagePath = path.join(repoRoot, 'apps', 'structure-assistant', 'package.json');
const startScriptPath = path.join(scriptDir, 'start-structure-pilot.ps1');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const assistantPackage = JSON.parse(fs.readFileSync(assistantPackagePath, 'utf8'));
const startScript = fs.readFileSync(startScriptPath, 'utf8');

assert.equal(config.assistant.port, 3003);
assert.equal(config.assistant.gatewayPort, 3004);
assert.notEqual(config.assistant.port, config.assistant.gatewayPort);
assert.equal(new URL(config.assistant.structuredToolBaseUrl).hostname, '127.0.0.1');
assert.equal(new URL(config.assistant.structuredToolBaseUrl).port, '3001');
assert.equal(config.deepseek.fillModel, 'deepseek-v4-pro');
assert.equal(config.deepseek.reviewModel, 'deepseek-v4-pro');
assert.equal(config.deepseek.lowBalanceCny, 20);
assert.equal(config.dsh.version, '0.1.0-rc.6');
assert.equal(config.dsh.nodeMajor, 24);
assert.equal(config.dsh.maxInstances, 10);
assert.equal(config.dsh.startTimeoutMs, 60000);
assert.equal(config.dsh.stopGraceMs, 5000);
assert.equal(config.accounts.length, 5);
assert.equal(new Set(config.accounts.map(account => account.id)).size, 5);
assert.equal(new Set(config.accounts.map(account => account.username)).size, 5);
assert.equal(config.accounts.every(account => !Object.hasOwn(account, 'apiKeyEnv')), true);
assert.equal(config.accounts.every(account => !Object.hasOwn(account, 'apiKey')), true);
assert.equal(config.accounts.filter(account => account.role === 'admin').length, 1);
assert.equal(config.accounts.find(account => account.role === 'admin').displayName, '张广懿');
assert.equal(config.accounts.find(account => account.id === 'engineering_rd').department, '工程技术部');
assert.equal(config.accounts.find(account => account.id === 'engineering_production').department, '工程技术部');
assert.deepEqual(
  config.accounts.map(account => account.displayName),
  ['张广懿', '丁硕', '工程技术部研发', '工程技术部批产', '行政人事部']
);
assert.equal(
  JSON.stringify(config).includes('sk-'),
  false,
  'tracked pilot config must not contain an API key value'
);
assert.equal(typeof rootPackage.scripts['start:structure-pilot'], 'string');
assert.equal(typeof rootPackage.scripts['smoke:structure-pilot'], 'string');
assert.equal(typeof rootPackage.scripts['test:structure-pilot-config'], 'string');
assert.equal(typeof rootPackage.scripts['verify:dsh-entry'], 'string');
assert.equal(assistantPackage.dependencies['@deepseek-ai/dsh'], '0.1.0-rc.6');
assert.equal(assistantPackage.scripts['verify:dsh-entry'], 'node scripts/verify-dsh-entry.js');
assert.equal(assistantPackage.scripts['smoke:models'], undefined);
assert.equal(
  fs.existsSync(path.join(repoRoot, 'apps', 'structure-assistant', 'scripts', 'live-model-smoke.js')),
  false,
  'the administrator-run cross-account paid smoke script must stay retired'
);
assert.equal(fs.existsSync(startScriptPath), true);
assert.equal(fs.existsSync(path.join(scriptDir, 'smoke-structure-pilot.mjs')), true);
assert.match(
  startScript,
  /Get-Content -Raw -Encoding UTF8 -LiteralPath \$configPath \| ConvertFrom-Json/,
  'the Windows pilot starter must decode the tracked Chinese JSON config as UTF-8'
);
assert.equal(
  startScript.includes('STRUCTURED_OUTPUT_HOST'),
  false,
  'the optional assistant pilot must not rebind the independent 3001 LAN service'
);
assert.equal(
  startScript.includes('Stop-Listener -Port $structuredPort'),
  false,
  'the optional assistant pilot must not stop the independent 3001 LAN service'
);
assert.equal(
  startScript.includes('-WorkingDirectory $structuredToolDir'),
  false,
  'the optional assistant pilot must not start or manage the independent 3001 LAN service'
);
assert.equal(startScript.includes('apiKeyEnv'), false, 'the starter must not require server-side API keys');
assert.equal(startScript.includes('DEEPSEEK_API_KEY'), false, 'the starter must not read server-side API keys');
assert.match(startScript, /independent 3001 LAN service/i);
assert.match(startScript, /Node\.js 24/);
assert.match(startScript, /STRUCTURE_ASSISTANT_PUBLIC_HOSTS/);
assert.match(startScript, /verify:dsh-entry/);

console.log('structure pilot fixed-config tests passed');
