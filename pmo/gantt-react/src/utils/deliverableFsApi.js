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
