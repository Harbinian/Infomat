import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INFOMAT_SERVICE_CONFIG,
  buildFixedServiceEnv,
  localEnvPath,
  parseLocalEnv
} from './infomat-service-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'infomat-services-config-test-'));
fs.mkdirSync(path.join(tempRoot, 'scripts'), { recursive: true });

assert.equal(INFOMAT_SERVICE_CONFIG.mdm.port, 3000);
assert.equal(INFOMAT_SERVICE_CONFIG.pmo.port, 5173);
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.host, '127.0.0.1');
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.port, 3307);
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.user, 'mdm_user');
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.database, 'infomat_mdm');
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.connectionLimit, 10);
assert.equal(INFOMAT_SERVICE_CONFIG.mysql.dockerContainer, 'infomat-candidate-review-mysql');
assert.equal(INFOMAT_SERVICE_CONFIG.readModels.identity, 'mysql');
assert.equal(INFOMAT_SERVICE_CONFIG.readModels.processGovernance, 'mysql');
assert.equal(INFOMAT_SERVICE_CONFIG.admin.employeeNo, 'ADMIN001');

const fixed = buildFixedServiceEnv({
  MYSQL_HOST: 'mysql-floating',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'root',
  MYSQL_PASSWORD: 'secret-from-env',
  MYSQL_DATABASE: 'wrong_db',
  MYSQL_CONNECTION_LIMIT: '2',
  MDM_IDENTITY_READ_MODEL: 'sqlite',
  PROCESS_GOVERNANCE_READ_MODEL: 'sqlite',
  PORT: '3999',
  MDM_ADMIN_EMPLOYEE_NO: 'OTHER',
  MDM_ADMIN_PASSWORD: 'admin-secret'
}, tempRoot);

assert.equal(fixed.MYSQL_HOST, '127.0.0.1');
assert.equal(fixed.MYSQL_PORT, '3307');
assert.equal(fixed.MYSQL_USER, 'mdm_user');
assert.equal(fixed.MYSQL_PASSWORD, 'secret-from-env');
assert.equal(fixed.MYSQL_DATABASE, 'infomat_mdm');
assert.equal(fixed.MYSQL_CONNECTION_LIMIT, '10');
assert.equal(fixed.MDM_IDENTITY_READ_MODEL, 'mysql');
assert.equal(fixed.PROCESS_GOVERNANCE_READ_MODEL, 'mysql');
assert.equal(fixed.PORT, '3000');
assert.equal(fixed.MDM_ADMIN_EMPLOYEE_NO, 'ADMIN001');
assert.equal(fixed.MDM_ADMIN_PASSWORD, 'admin-secret');
assert.equal(fixed.ALLOW_INSECURE_SESSION_SECRET, '1');

assert.throws(
  () => buildFixedServiceEnv({ MDM_ADMIN_PASSWORD: 'admin-secret' }, tempRoot),
  /MYSQL_PASSWORD/
);
assert.throws(
  () => buildFixedServiceEnv({ MYSQL_PASSWORD: 'secret-from-env' }, tempRoot),
  /MDM_ADMIN_PASSWORD/
);

const tempLocalEnv = localEnvPath(tempRoot);
fs.writeFileSync(tempLocalEnv, 'MYSQL_PASSWORD=secret-from-local\nMDM_ADMIN_PASSWORD=admin-from-local\n', 'utf8');
const localFixed = buildFixedServiceEnv({
  MYSQL_PASSWORD: 'secret-from-env',
  MDM_ADMIN_PASSWORD: 'admin-secret'
}, tempRoot);
assert.equal(localFixed.MYSQL_PASSWORD, 'secret-from-local');
assert.equal(localFixed.MDM_ADMIN_PASSWORD, 'admin-from-local');

assert.deepEqual(parseLocalEnv('MYSQL_PASSWORD=abc\n# comment\nMDM_ADMIN_PASSWORD=def\n'), {
  MYSQL_PASSWORD: 'abc',
  MDM_ADMIN_PASSWORD: 'def'
});
assert.equal(localEnvPath(repoRoot), path.join(repoRoot, 'scripts', 'infomat-services.local.env'));

const smokeScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'smoke-infomat-services.mjs'), 'utf8');
assert.ok(smokeScript.includes("from './infomat-service-config.mjs'"), 'smoke should load the fixed service config');
assert.ok(smokeScript.includes('buildFixedServiceEnv'), 'smoke should build a fixed env contract');
assert.ok(!smokeScript.includes("process.env.MYSQL_PORT || 3307"), 'smoke must not pick a drifting MySQL port from the shell');

const startScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'start-infomat-services.ps1'), 'utf8');
assert.ok(startScript.includes('infomat-services.config.json'), 'PowerShell starter should read the fixed service config');
assert.ok(startScript.includes('infomat-services.local.env'), 'PowerShell starter should load the local private env file');
assert.ok(startScript.includes('$fixedMysqlPort'), 'PowerShell starter should use the fixed MySQL port');
assert.ok(!startScript.includes('[int]$MysqlPort'), 'PowerShell starter should not accept a mutable MySQL port parameter');

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['start:infomat-services'], 'cmd /c start-infomat-services.cmd');
assert.equal(packageJson.scripts['smoke:infomat-services'], 'node scripts/smoke-infomat-services.mjs');

const startAndSmoke = fs.readFileSync(path.join(repoRoot, 'start-and-smoke-infomat-services.cmd'), 'utf8');
assert.ok(startAndSmoke.includes('call "%~dp0start-infomat-services.cmd"'), 'start-and-smoke should use the fixed starter');
assert.ok(!startAndSmoke.includes('smoke-infomat-services.mjs" --start'), 'start-and-smoke should not let smoke choose startup config');

const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
assert.ok(gitignore.includes('*.local.env'), 'local service secrets must stay out of git');

const rootReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
assert.ok(rootReadme.includes('npm run start:infomat-services'), 'root README should document the fixed starter');
assert.ok(rootReadme.includes('127.0.0.1:3307'), 'root README should document the fixed MySQL port');
assert.ok(rootReadme.includes('scripts/infomat-services.local.env'), 'root README should document local-only service secrets');

const scriptsReadme = fs.readFileSync(path.join(repoRoot, 'scripts', 'README.md'), 'utf8');
assert.ok(scriptsReadme.includes('MDM / PMO 固定启动合同'), 'scripts README should document the fixed startup contract');
assert.ok(scriptsReadme.includes('启动确认项'), 'scripts README should document startup checks');
assert.ok(scriptsReadme.includes('Docker 容器 `infomat-candidate-review-mysql` 通过 `127.0.0.1:3307` 提供服务'), 'scripts README should document the fixed MySQL service');

const mdmReadme = fs.readFileSync(path.join(repoRoot, 'apps', 'mdm-platform', 'README.md'), 'utf8');
assert.ok(mdmReadme.includes('MDM 和 PMO 从仓库根目录使用固定入口启动'), 'MDM README should document the fixed root starter');
assert.ok(mdmReadme.includes('$env:MYSQL_PORT = "3307"'), 'MDM README should show the fixed MySQL port for schema rebuilds');

const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
assert.ok(agents.includes('MDM / PMO 本地联动启动使用仓库根目录固定入口'), 'AGENTS should guide future agents to the fixed starter');
const roleUsageGuide = fs.readFileSync(path.join(repoRoot, 'apps', 'mdm-platform', 'docs', 'role-based-usage-guide.md'), 'utf8');
assert.ok(roleUsageGuide.includes('MDM 和 PMO 使用仓库根目录的固定启动方式'), 'role usage guide should document the fixed startup path');
assert.equal(/裸跑|临时改 `MYSQL_PORT`|不要临时传 `MYSQL_PORT`|连到了 3306/.test([
  rootReadme,
  scriptsReadme,
  mdmReadme,
  agents,
  roleUsageGuide
].join('\n')), false, 'startup docs should keep only the fixed startup path');

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('Infomat fixed service config test passed');
