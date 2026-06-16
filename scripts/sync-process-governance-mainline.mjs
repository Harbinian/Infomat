import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appRoot = resolve(repoRoot, 'apps', 'mdm-platform');
const snapshotPath = resolve(repoRoot, 'docs', 'company-sankey-data.json');
const mdmDbPath = process.env.MDM_DB_PATH;

if (!mdmDbPath) {
  console.error('MDM_DB_PATH is required. Point it at the intended MDM SQLite database before running process-governance sync.');
  process.exit(1);
}

if (process.argv.includes('--check-env')) {
  console.log(JSON.stringify({ ok: true, mdmDbPath }));
  process.exit(0);
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function npmStep(name, scriptName, extraArgs = []) {
  if (process.env.npm_execpath) {
    return {
      name,
      command: process.execPath,
      args: [process.env.npm_execpath, 'run', scriptName, ...extraArgs],
      cwd: appRoot,
    };
  }
  if (process.platform === 'win32') {
    return {
      name,
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', 'run', scriptName, ...extraArgs].map(quoteCmdArg).join(' ')],
      cwd: appRoot,
    };
  }
  return {
    name,
    command: 'npm',
    args: ['run', scriptName, ...extraArgs],
    cwd: appRoot,
  };
}

const steps = [
  {
    name: 'parse norms snapshot',
    command: process.execPath,
    args: ['scripts/parse-sankey-data.mjs'],
    cwd: repoRoot,
    quietOnSuccess: true,
  },
  {
    name: 'check dashboard data',
    command: process.execPath,
    args: ['scripts/check-dashboard-data.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'check DCM/BBM quality',
    command: process.execPath,
    args: ['scripts/check-dcm-bbm.mjs', '--no-fail'],
    cwd: repoRoot,
  },
  npmStep('sync process governance org', 'sync:process-org', ['--', '--write']),
  npmStep('import MDM process governance snapshot', 'import:process-governance', ['--', '--snapshot', snapshotPath]),
  npmStep('check MDM process governance snapshot', 'check:process-governance'),
];

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const stdio = step.quietOnSuccess ? ['inherit', 'ignore', 'pipe'] : 'inherit';
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    stdio,
    encoding: step.quietOnSuccess ? 'utf8' : undefined,
    env: { ...process.env, MDM_DB_PATH: mdmDbPath },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (step.quietOnSuccess && result.stderr) console.error(result.stderr);
    process.exit(result.status || 1);
  }
}

console.log('\nProcess governance mainline sync completed');
