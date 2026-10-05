/**
 * Compatibility import of an explicitly chosen historical display snapshot.
 * This entry does not generate norms data or establish current governance facts.
 * --check-env: report only configuration booleans; no files or database access.
 * --legacy-display --snapshot <json>: validate and print a plan, without writes.
 * Add --apply only after the target, permissions, backup and recovery are authorized.
 * Apply invokes the existing MySQL importer; never SQLite, parser or dashboard writes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appRoot = resolve(repoRoot, 'apps', 'mdm-platform');
const requiredMysqlEnvNames = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const argv = process.argv.slice(2);
const configured = Object.fromEntries(requiredMysqlEnvNames.map(name => [name, Boolean(process.env[name])]));
const missingMysqlEnvNames = requiredMysqlEnvNames.filter(name => !configured[name]);

if (argv.includes('--check-env')) {
  if (argv.length !== 1) throw new Error('--check-env cannot be combined with import arguments');
  console.log(JSON.stringify({ ok: !missingMysqlEnvNames.length, target: 'mysql', configured }));
  process.exitCode = missingMysqlEnvNames.length ? 1 : 0;
} else {
  let snapshotPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (['--legacy-display', '--apply'].includes(argv[index])) continue;
    if (argv[index] !== '--snapshot') throw new Error(`Unknown argument: ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --snapshot');
    snapshotPath = resolve(value);
  }
  if (!argv.includes('--legacy-display') || !snapshotPath) {
    console.error('Historical compatibility import requires --legacy-display --snapshot <json>; docs are not current governance authority');
    process.exitCode = 1;
  } else {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    if (!Array.isArray(snapshot.processMappings) || !snapshot.processMappings.length) {
      throw new Error('Historical compatibility snapshot requires non-empty processMappings');
    }
    if (!argv.includes('--apply')) {
      console.log(JSON.stringify({ ok: true, mode: 'plan', target: 'mysql', authority: 'historical_display_only', snapshot: snapshotPath, processMappings: snapshot.processMappings.length, databaseWrites: false }));
    } else if (missingMysqlEnvNames.length) {
      console.error(`Missing required MySQL environment variables: ${missingMysqlEnvNames.join(', ')}`);
      process.exitCode = 1;
    } else {
      const importArgs = ['run', 'import:process-governance-mysql', '--', '--snapshot', snapshotPath];
      let command = 'npm';
      let args = importArgs;
      if (process.env.npm_execpath) {
        command = process.execPath;
        args = [process.env.npm_execpath, ...importArgs];
      } else if (process.platform === 'win32') {
        command = process.env.ComSpec || 'cmd.exe';
        // Reject shell metacharacters rather than composing an unsafe Windows command.
        if (/["%!\r\n]/.test(snapshotPath)) throw new Error('Snapshot path cannot contain quotes, expansion characters or line breaks when using cmd.exe');
        args = ['/d', '/s', '/c', ['npm', ...importArgs].map(value => `"${value}"`).join(' ')];
      }
      const result = spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', env: process.env, windowsHide: true });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      if (!process.exitCode) console.log('Historical display snapshot MySQL compatibility import completed');
    }
  }
}
