const FEATURE_FLAG = 'PROCESS_DATA_GOVERNANCE_ENABLED';
const TRIAL_VERSION_FLAG = 'PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID';
const READ_ONLY_FLAG = 'PROCESS_DATA_GOVERNANCE_READ_ONLY';

function isProcessDataGovernanceReadOnly(env = process.env) {
  const raw = String(env && env[READ_ONLY_FLAG] || '0');
  if (!['0', '1'].includes(raw)) {
    throw scopeError(503, 'PROCESS_DATA_GOVERNANCE_READ_ONLY_INVALID', '工作包只读配置无效，必须为0或1');
  }
  return raw === '1';
}

function assertProcessDataGovernanceWritable(env = process.env) {
  if (isProcessDataGovernanceReadOnly(env)) {
    throw scopeError(409, 'PROCESS_DATA_GOVERNANCE_READ_ONLY', '本批治理工作包当前仅供查阅，已停止办理');
  }
}

// Kept for callers of the previous status contract; the retired trial setting
// never chooses a version or limits access. Each work package stores its source.
function configuredProcessVersionId() { return null; }

function isProcessDataGovernanceEnabled(env = process.env) {
  return String(env && env[FEATURE_FLAG] || '') === '1';
}

function isProcessVersionAllowed(processVersionId, env = process.env) {
  return /^[1-9]\d*$/.test(String(processVersionId || '')) && Number.isSafeInteger(Number(processVersionId));
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
  isProcessDataGovernanceReadOnly(env);
  return true;
}

function assertProcessVersionAllowed(processVersionId, env = process.env) {
  assertProcessVersionScopeConfigured(env);
  if (!isProcessVersionAllowed(processVersionId)) throw scopeError(422, 'PROCESS_DATA_GOVERNANCE_VERSION_REQUIRED', '请选择有效的已发布流程版本');
  // Actual publication state, native V7 and source digest are checked in MySQL.
  return Number(processVersionId);
}

function featureStatus(env = process.env) {
  return {
    enabled: isProcessDataGovernanceEnabled(env),
    read_only: isProcessDataGovernanceReadOnly(env),
    configured_process_version_id: configuredProcessVersionId(env),
    scope_mode: 'published_v7_versions',
    responsibility_model: 'process-data-governance-v1-2026-08-27'
  };
}

module.exports = {
  FEATURE_FLAG,
  TRIAL_VERSION_FLAG,
  READ_ONLY_FLAG,
  assertProcessDataGovernanceEnabled,
  assertProcessDataGovernanceWritable,
  assertProcessVersionAllowed,
  assertProcessVersionScopeConfigured,
  configuredProcessVersionId,
  featureStatus,
  isProcessDataGovernanceEnabled,
  isProcessDataGovernanceReadOnly,
  isProcessVersionAllowed
};
