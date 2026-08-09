import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const configPath = path.join(repoRoot, 'apps', 'structure-assistant', 'config', 'pilot.config.json');
const packagePath = path.join(repoRoot, 'package.json');
const startScriptPath = path.join(scriptDir, 'start-structure-pilot.ps1');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const startScript = fs.readFileSync(startScriptPath, 'utf8');

assert.equal(config.assistant.port, 3003);
assert.equal(config.assistant.gatewayPort, 3004);
assert.notEqual(config.assistant.port, config.assistant.gatewayPort);
assert.equal(new URL(config.assistant.structuredToolBaseUrl).hostname, '127.0.0.1');
assert.equal(new URL(config.assistant.structuredToolBaseUrl).port, '3001');
assert.equal(config.deepseek.fillModel, 'deepseek-v4-flash');
assert.equal(config.deepseek.reviewModel, 'deepseek-v4-pro');
assert.equal(config.deepseek.lowBalanceCny, 20);
assert.equal(config.accounts.length, 4);
assert.equal(new Set(config.accounts.map(account => account.id)).size, 4);
assert.equal(new Set(config.accounts.map(account => account.username)).size, 4);
assert.equal(new Set(config.accounts.map(account => account.apiKeyEnv)).size, 4);
assert.equal(config.accounts.filter(account => account.role === 'admin').length, 1);
assert.equal(config.accounts.find(account => account.role === 'admin').displayName, '张广懿');
assert.equal(
  JSON.stringify(config).includes('sk-'),
  false,
  'tracked pilot config must not contain an API key value'
);
assert.equal(typeof rootPackage.scripts['start:structure-pilot'], 'string');
assert.equal(typeof rootPackage.scripts['smoke:structure-pilot'], 'string');
assert.equal(typeof rootPackage.scripts['test:structure-pilot-config'], 'string');
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
assert.match(startScript, /independent 3001 LAN service/i);

console.log('structure pilot fixed-config tests passed');
