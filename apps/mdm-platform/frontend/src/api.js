import {protocol} from './protocol.js';
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
    if (code === 'PASSWORD_CHANGE_REQUIRED') this.message = '当前账号需要修改密码，请在当前平台完成修改后重新登录。';
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, onUnauthorized = () => {}, timeoutMs = 15000 } = {}) {
  const client = protocol.createRequestClient({ fetchImpl, onUnauthorized, timeoutMs });
  async function request(url, { method = 'GET', body, signal, responseType = 'json' } = {}) {
    try {
      return await client.request(url, {
        method, body, signal, responseType, bodyEncoding: 'json',
        headers: { Accept: responseType === 'blob' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' }
      });
    } catch (error) {
      if (!(error instanceof protocol.RequestError)) throw error;
      const presented = new ApiError(error.status, error.code, error.fieldErrors);
      presented.importStatus = error.importStatus;
      throw presented;
    }
  }
  return { request, resetSession: client.resetSession };
}
