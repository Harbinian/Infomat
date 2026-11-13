// Input: an explicit Docker container and optional absolute candidate file path.
// Output: JSON describing mount/file metadata only. Never reads credentials,
// private runtime configuration, account data or database connections; no writes.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DESTINATION = '/run/secrets/account-initial-password';
// Ask Docker for an allowlist, never the full inspect response or Config.Env.
const FORMAT = '{"container_id":{{json .Id}},"image_id":{{json .Image}},"state":{{json .State.Status}},"mounts":{{json .Mounts}}}';

function fileMetadata(filename) {
  if (!filename || !path.isAbsolute(filename)) return { kind: 'invalid_path' };
  try {
    const stat = fs.lstatSync(filename);
    return { kind: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other' };
  } catch (error) {
    return { kind: error.code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}

function inspectMount(snapshot, candidateFile) {
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.container_id || '') || !Array.isArray(snapshot.mounts)) {
    throw new Error('INVALID_CONTAINER_METADATA');
  }
  const matches = snapshot.mounts.filter(mount => mount.Destination === DESTINATION);
  let status = 'missing_mount', source = null;
  if (matches.length > 1) status = 'ambiguous_mount';
  else if (matches.length === 1) {
    const mount = matches[0];
    if (mount.Type !== 'bind') status = 'unsupported_mount_type';
    else {
      source = { path: mount.Source, ...fileMetadata(mount.Source) };
      status = source.kind !== 'file' ? 'invalid_source' : mount.RW !== false ? 'writable_mount' : 'mount_ready';
    }
  }
  return {
    checked_at: new Date().toISOString(),
    container: { id: snapshot.container_id, image_id: snapshot.image_id, state: snapshot.state },
    expected_destination: DESTINATION,
    status,
    mount_ready: status === 'mount_ready',
    source,
    ...(candidateFile ? { candidate: { path: candidateFile, ...fileMetadata(candidateFile) } } : {}),
    credential_contents_read: false,
    runtime_policy_verified: false,
    account_activation_verified: false,
    changed: false
  };
}

function argumentsFor(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!['--container', '--candidate-file'].includes(name) || result[name] !== undefined || !value || value.startsWith('--')) {
      throw new Error('INVALID_ARGUMENTS');
    }
    result[name] = value;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(result['--container'] || '')) throw new Error('EXPLICIT_CONTAINER_REQUIRED');
  if (result['--candidate-file'] && !path.isAbsolute(result['--candidate-file'])) throw new Error('ABSOLUTE_CANDIDATE_FILE_REQUIRED');
  return result;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('node scripts/inspect-account-initial-password.js --container <name-or-id> [--candidate-file <absolute-path>]');
    console.log('Read-only metadata inspection. Exit 0: mount prerequisites present; 2: mount incomplete; 1: inspection failed. Does not verify password contents, runtime policy or activation.');
    return 0;
  }
  const args = argumentsFor(argv);
  const snapshot = JSON.parse(execFileSync('docker', ['inspect', '--type', 'container', '--format', FORMAT, args['--container']], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }));
  const result = inspectMount(snapshot, args['--candidate-file']);
  console.log(JSON.stringify(result, null, 2));
  return result.mount_ready ? 0 : 2;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    // Docker errors may include command output. Emit only known diagnostic codes.
    const known = ['INVALID_ARGUMENTS', 'EXPLICIT_CONTAINER_REQUIRED', 'ABSOLUTE_CANDIDATE_FILE_REQUIRED', 'INVALID_CONTAINER_METADATA'];
    console.error(JSON.stringify({ status: 'inspection_failed', code: known.includes(error.message) ? error.message : 'DOCKER_INSPECTION_FAILED', changed: false }));
    process.exitCode = 1;
  }
}

module.exports = { DESTINATION, FORMAT, fileMetadata, inspectMount, argumentsFor };
