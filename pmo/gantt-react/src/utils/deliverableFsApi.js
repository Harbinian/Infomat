const BASE = '/api/pmo/deliverables';

async function parseResponse(response, { raw = false } = {}) {
  const contentType = response.headers.get('Content-Type') || '';
  if (raw) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (contentType.includes('text/html')) {
      const error = new Error('deliverable fs api unavailable');
      error.code = 'HTTP_ERROR';
      error.status = response.status;
      throw error;
    }
    return response.text();
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload?.data;
}

export async function listDeliverables() {
  const response = await fetch(BASE);
  return parseResponse(response);
}

/** 台账索引原始数据：受控正本记录 + 扫描错误 + 建议编号。 */
export async function getDeliverableLedger() {
  const response = await fetch(`${BASE}/ledger`);
  return parseResponse(response);
}

/** 提升为受控：从候选池创建一份新的正本骨架。 */
export async function createDeliverable(payload) {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

async function actionRequest(id, action, payload, { ifMatch } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (ifMatch != null) headers['If-Match'] = String(ifMatch);
  const response = await fetch(`${BASE}/${id}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export const publishDeliverable = (id, payload, options) => actionRequest(id, 'publish', payload, options);
export const acknowledgeDeliverable = (id, payload, options) => actionRequest(id, 'acknowledge', payload, options);
export const submitDeliverableResult = (id, payload, options) => actionRequest(id, 'submit-result', payload, options);
export const closeDeliverableAction = (id, payload, options) => actionRequest(id, 'close', payload, options);
export const reopenDeliverableAction = (id, payload, options) => actionRequest(id, 'reopen', payload, options);
export const changeDeliverableDueDate = (id, payload, options) => actionRequest(id, 'due-date', payload, options);

/** 责任部门名册（解析自《信息化项目部门主备对接人名单》）。 */
export async function getDeliverableRoster() {
  const response = await fetch(`${BASE}/roster`);
  return parseResponse(response);
}

/** 发布文本归档留痕（工作群是正式渠道，看板只存档）。 */
export async function archivePublishText(text) {
  const response = await fetch(`${BASE}/publish-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text }),
  });
  return parseResponse(response);
}

export async function getDeliverable(id) {
  const response = await fetch(`${BASE}/${id}`);
  return parseResponse(response);
}

export async function getDeliverableRaw(id) {
  const response = await fetch(`${BASE}/${id}/raw`);
  return parseResponse(response, { raw: true });
}

export async function putDeliverable(id, content, { ifMatch } = {}) {
  const headers = { 'Content-Type': 'text/markdown; charset=utf-8' };
  if (ifMatch != null) headers['If-Match'] = String(ifMatch);
  const response = await fetch(`${BASE}/${id}`, { method: 'PUT', headers, body: content });
  return parseResponse(response);
}

export async function transitionDeliverable(id, command, { ifMatch } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (ifMatch != null) headers['If-Match'] = String(ifMatch);
  const response = await fetch(`${BASE}/${id}/transition`, {
    method: 'POST',
    headers,
    body: JSON.stringify(command),
  });
  return parseResponse(response);
}

export async function uploadDeliverableEvidence(id, file, { deliverable } = {}) {
  const form = new FormData();
  form.append('file', file);
  if (deliverable) {
    form.append('metadata', JSON.stringify({
      deliverableId: deliverable.deliverableId,
      deliverableName: deliverable.deliverableName,
      deliverableStatus: deliverable.deliverableStatus,
      deliverableType: deliverable.deliverableType,
      deliverableLevel: deliverable.deliverableLevel,
      department: deliverable.department,
      reviewer: deliverable.reviewer,
      plannedFinish: deliverable.plannedFinish,
      taskRisk: deliverable.taskRisk,
    }));
  }
  const response = await fetch(`${BASE}/${id}/upload`, { method: 'POST', body: form });
  return parseResponse(response);
}

export async function apiAvailable() {
  try {
    await listDeliverables();
    return true;
  } catch {
    return false;
  }
}
