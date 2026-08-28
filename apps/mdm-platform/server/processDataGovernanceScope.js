const FEATURE_FLAG = 'PROCESS_DATA_GOVERNANCE_ENABLED';
const TRIAL_VERSION_FLAG = 'PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID';

function configuredProcessVersionId(env = process.env) {
  const raw = String(env && env[TRIAL_VERSION_FLAG] || '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

function isProcessDataGovernanceEnabled(env = process.env) {
  return String(env && env[FEATURE_FLAG] || '') === '1';
}

function isProcessVersionAllowed(processVersionId, env = process.env) {
  const configured = configuredProcessVersionId(env);
  return Boolean(configured && Number(processVersionId) === configured);
}

function scopeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.payload = { error: message, code };
  return error;
}

function assertProcessDataGovernanceEnabled(env = process.env) {
  if (!isProcessDataGovernanceEnabled(env)) {
    throw scopeError(503, 'PROCESS_DATA_GOVERNANCE_DISABLED', '数据生命周期治理工作包当前未启用');
  }
}

function assertProcessVersionScopeConfigured(env = process.env) {
  const configured = configuredProcessVersionId(env);
  if (!configured) {
    throw scopeError(503, 'PROCESS_DATA_GOVERNANCE_SCOPE_NOT_CONFIGURED', '尚未配置唯一试点流程版本');
  }
  return configured;
}

function assertProcessVersionAllowed(processVersionId, env = process.env) {
  const configured = assertProcessVersionScopeConfigured(env);
  if (Number(processVersionId) !== configured) {
    throw scopeError(403, 'PROCESS_DATA_GOVERNANCE_SCOPE_DENIED', '当前流程版本不在唯一试点范围内');
  }
  return configured;
}

function featureStatus(env = process.env) {
  return {
    enabled: isProcessDataGovernanceEnabled(env),
    configured_process_version_id: configuredProcessVersionId(env),
    scope_mode: 'exact_process_version_id',
    responsibility_model: 'process-data-governance-v1-2026-08-27'
  };
}

module.exports = {
  FEATURE_FLAG,
  TRIAL_VERSION_FLAG,
  assertProcessDataGovernanceEnabled,
  assertProcessVersionAllowed,
  assertProcessVersionScopeConfigured,
  configuredProcessVersionId,
  featureStatus,
  isProcessDataGovernanceEnabled,
  isProcessVersionAllowed
};
