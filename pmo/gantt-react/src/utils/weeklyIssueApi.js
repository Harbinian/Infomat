// weeklyIssueApi.js — 周会事项台账的文件正本接口
//
// 与 deliverableFsApi.js 同模式：只在 dev / 容器（均跑 Vite dev server）下可用。
// 静态构建或插件不可用时抛 HTTP_ERROR，由 WeeklyIssueLedger 降级到 localStorage。

const BASE = '/api/pmo/weekly-issues';

async function parseResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

export async function listWeeklyIssues() {
  const response = await fetch(BASE);
  return parseResponse(response);
}

export async function createWeeklyIssue(payload) {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function updateWeeklyIssue(id, payload, { ifMatch } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (ifMatch != null) headers['If-Match'] = String(ifMatch);
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}
