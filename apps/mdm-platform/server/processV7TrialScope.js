const TECHNICAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function trialProcessRefFromEnv(env = process.env) {
  const raw = String(env && env.PROCESS_V7_TRIAL_PROCESS_REF || '');
  return raw === raw.trim() && TECHNICAL_REF_PATTERN.test(raw) ? raw : '';
}

function isV7TrialProcessRefAllowed(processRef, options = {}) {
  const configured = trialProcessRefFromEnv(options.env || process.env);
  return Boolean(configured && text(processRef) === configured);
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

function assertV7TrialScopeConfigured(options = {}) {
  const configured = trialProcessRefFromEnv(options.env || process.env);
  if (!configured) {
    throw trialScopeError(
      503,
      'V7_TRIAL_SCOPE_NOT_CONFIGURED',
      'V7单流程试点范围尚未配置'
    );
  }
  return configured;
}

function assertV7TrialProcessRef(processRef, options = {}) {
  const configured = assertV7TrialScopeConfigured(options);
  if (text(processRef) !== configured) {
    throw trialScopeError(
      403,
      'V7_TRIAL_PROCESS_SCOPE_DENIED',
      '当前流程不在已批准的V7单流程试点范围内'
    );
  }
  return configured;
}

module.exports = {
  assertV7FormalEnabled,
  assertV7PreviewEnabled,
  assertV7TrialProcessRef,
  assertV7TrialScopeConfigured,
  isV7TrialProcessRefAllowed,
  trialProcessRefFromEnv
};
