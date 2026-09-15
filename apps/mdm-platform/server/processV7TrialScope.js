const TECHNICAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function text(value) {
  return String(value == null ? '' : value).trim();
}

// Compatibility export. The retired trial setting no longer selects a process.
function trialProcessRefFromEnv() { return ''; }

function isV7TrialProcessRefAllowed(processRef, options = {}) {
  const value = String(processRef == null ? '' : processRef);
  return value === value.trim() && TECHNICAL_REF_PATTERN.test(value);
}

function trialScopeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertV7PreviewEnabled(options = {}) {
  const env = options.env || process.env;
  if (!env || env.PROCESS_V7_PREVIEW_ENABLED !== '1') {
    throw trialScopeError(503, 'V7_PREVIEW_DISABLED', 'V7预览核对功能当前未启用');
  }
}

function assertV7FormalEnabled(options = {}) {
  const env = options.env || process.env;
  if (!env || env.PROCESS_V7_FORMAL_ENABLED !== '1') {
    throw trialScopeError(503, 'V7_FORMAL_DISABLED', 'V7正式承接功能当前未启用');
  }
}

// Compatibility export for existing repository/readiness entry points.
function assertV7TrialScopeConfigured() { return true; }

function assertV7TrialProcessRef(processRef, options = {}) {
  if (!isV7TrialProcessRefAllowed(processRef)) {
    throw trialScopeError(
      422,
      'V7_PROCESS_REF_INVALID',
      '流程稳定标识无效，请核对V7文件中的process_ref'
    );
  }
  return text(processRef);
}

module.exports = {
  assertV7FormalEnabled,
  assertV7PreviewEnabled,
  assertV7TrialProcessRef,
  assertV7TrialScopeConfigured,
  isV7TrialProcessRefAllowed,
  trialProcessRefFromEnv
};
