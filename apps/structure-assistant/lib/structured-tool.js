'use strict';

const { AppError } = require('./errors');

async function requestJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new AppError(502, 'STRUCTURED_TOOL_INVALID_RESPONSE', '结构化工具返回了无法识别的内容。');
    }
    if (!response.ok) {
      throw new AppError(
        502,
        'STRUCTURED_TOOL_UNAVAILABLE',
        body?.error || `结构化工具返回HTTP ${response.status}。`
      );
    }
    return { response, body };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.name === 'AbortError') {
      throw new AppError(504, 'STRUCTURED_TOOL_TIMEOUT', '结构化工具响应超时。');
    }
    throw new AppError(502, 'STRUCTURED_TOOL_UNAVAILABLE', '结构化工具暂时不可用。');
  } finally {
    clearTimeout(timer);
  }
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function createStructuredToolClient({ baseUrl, appCommit, timeoutMs = 8000, request = requestJson }) {
  const root = trimSlash(baseUrl);

  async function snapshot() {
    const [healthResult, schemaResult] = await Promise.all([
      request(`${root}/api/health`, { cache: 'no-store' }, timeoutMs),
      request(`${root}/api/schema`, { cache: 'no-store' }, timeoutMs)
    ]);
    const health = healthResult.body;
    const schema = schemaResult.body;
    const schemaVersion = String(schema?.properties?.schema_version?.const || '');
    const headerDigest = String(schemaResult.response.headers.get('x-infomat-schema-digest') || '');
    const healthDigest = String(health?.schema_digest || '');
    const toolCommit = String(health?.app_commit || '');

    if (health?.status !== 'ok' || schemaVersion !== 'process-governance-v1') {
      throw new AppError(503, 'STRUCTURED_TOOL_CONTRACT_UNAVAILABLE', '结构化工具当前结构规则不可用。');
    }
    if (!headerDigest || headerDigest !== healthDigest) {
      throw new AppError(503, 'STRUCTURED_TOOL_DIGEST_MISMATCH', '结构化工具的结构校验值不一致。');
    }
    if (!toolCommit || toolCommit === 'unknown' || toolCommit !== appCommit) {
      throw new AppError(
        503,
        'APP_COMMIT_MISMATCH',
        'MDM-AI助手与结构化工具不是同一个Infomat试点版本。'
      );
    }
    return {
      appCommit,
      schemaVersion,
      schemaDigest: headerDigest,
      schema,
      structuredTool: {
        status: health.status,
        service: health.service,
        uptime: health.uptime
      }
    };
  }

  async function template() {
    const current = await snapshot();
    const result = await request(
      `${root}/api/template?version=process-governance-v1`,
      { cache: 'no-store' },
      timeoutMs
    );
    const body = result.body;
    if (
      body?.app_commit !== current.appCommit
      || body?.schema_version !== current.schemaVersion
      || body?.schema_digest !== current.schemaDigest
      || body?.data?.schema_version !== current.schemaVersion
    ) {
      throw new AppError(503, 'TEMPLATE_VERSION_MISMATCH', '空白模板与当前结构版本不一致。');
    }
    return {
      ...current,
      data: body.data
    };
  }

  async function validate(data) {
    const result = await request(`${root}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    }, timeoutMs);
    return result.body;
  }

  return {
    snapshot,
    template,
    validate
  };
}

function assertExpectedVersion(expected, current) {
  const expectedCommit = String(expected?.app_commit || '');
  const expectedDigest = String(expected?.schema_digest || '');
  if (!expectedCommit || !expectedDigest) {
    throw new AppError(400, 'VERSION_CONTEXT_REQUIRED', '页面缺少试点版本信息，请刷新后重试。');
  }
  if (expectedCommit !== current.appCommit || expectedDigest !== current.schemaDigest) {
    throw new AppError(
      409,
      'VERSION_CHANGED',
      '版本已更新，请先下载当前草稿，再刷新页面；刷新后可导入草稿继续。'
    );
  }
}

module.exports = {
  requestJson,
  createStructuredToolClient,
  assertExpectedVersion
};
