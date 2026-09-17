const messages = {
  401: '登录状态已失效，请重新登录。当前输入仍保留。',
  403: '当前身份无权执行此操作，请核对权限或联系负责人。',
  404: '未找到请求的内容，请返回入口重新选择。',
  409: '内容已变化或请求冲突，请重新核对后再操作。当前输入仍保留。',
  413: '提交内容过大，请缩小范围后重试。',
  429: '请求过于频繁，请稍后重试。',
  503: '服务暂不可用，请稍后重试。当前输入仍保留。'
};

export class ApiError extends Error {
  constructor(status, code, fieldErrors) {
    super(messages[status] || (status === 400 ? '请检查填写内容后重试。' : '请求未完成，请稍后重试。当前输入仍保留。'));
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors || {};
    if (code === 'PASSWORD_CHANGE_REQUIRED') this.message = '当前账号需要修改密码，请使用原入口完成修改后再继续。';
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, onUnauthorized = () => {}, timeoutMs = 15000 } = {}) {
  let csrfToken = null;
  let sessionGeneration = 0;
  function resetSession() { csrfToken = null; sessionGeneration += 1; }
  async function request(url, { method = 'GET', body, signal } = {}) {
    if (!/^\/api\//.test(url) || url.includes('\\') || url.includes('..')) throw new Error('Only same-origin API paths are allowed.');
    const generation = sessionGeneration;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const login = url === '/api/org/login';
    method = method.toUpperCase();
    try {
      const headers = { Accept: 'application/json' };
      const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
      if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !login) {
        if (!csrfToken) {
          const result = await request('/api/csrf-token', { signal: combinedSignal });
          if (generation !== sessionGeneration) throw new DOMException('Session changed', 'AbortError');
          csrfToken = result.csrfToken;
        }
        headers['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetchImpl(url, {
        method, headers, credentials: 'same-origin', cache: 'no-store', signal: combinedSignal,
        ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {})
      });
      // Logout, a new login or a replaced request makes the old response unusable.
      if (generation !== sessionGeneration || combinedSignal.aborted) throw new DOMException('Request replaced', 'AbortError');
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (generation !== sessionGeneration || combinedSignal.aborted) throw new DOMException('Request replaced', 'AbortError');
      if (!response.ok) {
        if (response.status === 401 && !login) { resetSession(); onUnauthorized(); }
        if (response.status === 403) csrfToken = null;
        throw new ApiError(response.status, data?.code, data?.field_errors);
      }
      if (data === null && response.status !== 204) throw new ApiError(502, 'INVALID_RESPONSE');
      return data;
    } catch (error) {
      if (signal?.aborted || generation !== sessionGeneration && !(error instanceof ApiError)) throw new DOMException('Request replaced', 'AbortError');
      if (error instanceof ApiError) throw error;
      if (error.name === 'AbortError' && !controller.signal.aborted) throw error;
      throw new ApiError(0, controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
  return { request, resetSession };
}
