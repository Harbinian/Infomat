// Allowlist operating-system plumbing, never inherit application/database secrets.
function isolatedEnvironment(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)) env[key] = value;
  }
  return { ...env, NODE_ENV: 'test', MDM_DB_QUIET: '1', ...overrides };
}
module.exports = { isolatedEnvironment };
