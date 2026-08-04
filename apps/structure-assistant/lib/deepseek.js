'use strict';

const { AppError } = require('./errors');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new AppError(502, 'MODEL_AUTH_FAILED', '当前账号的DeepSeek接口密钥不可用。');
  }
  if (status === 402) {
    return new AppError(402, 'MODEL_BALANCE_INSUFFICIENT', '当前DeepSeek账号余额不足。');
  }
  if (status === 429) {
    return new AppError(503, 'MODEL_BUSY', 'DeepSeek当前请求较多，请稍后重试。');
  }
  if (status === 500 || status === 503) {
    return new AppError(503, 'MODEL_UNAVAILABLE', 'DeepSeek暂时无法完成请求。');
  }
  return new AppError(502, 'MODEL_REQUEST_FAILED', `DeepSeek返回HTTP ${status}。`);
}

function normalizedUsage(value) {
  return {
    prompt_tokens: Number(value?.prompt_tokens || 0),
    completion_tokens: Number(value?.completion_tokens || 0),
    total_tokens: Number(value?.total_tokens || 0)
  };
}

function addUsage(left, right) {
  return {
    prompt_tokens: Number(left?.prompt_tokens || 0) + Number(right?.prompt_tokens || 0),
    completion_tokens: Number(left?.completion_tokens || 0) + Number(right?.completion_tokens || 0),
    total_tokens: Number(left?.total_tokens || 0) + Number(right?.total_tokens || 0)
  };
}

function createDeepSeekClient({ baseUrl, timeoutMs, fetchFn = global.fetch, retryDelayMs = 500 }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function completion({
    apiKey,
    model,
    messages,
    thinking,
    reasoningEffort,
    maxTokens,
    requestId
  }) {
    let transportAttempts = 0;
    while (transportAttempts < 2) {
      transportAttempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(timeoutMs || 120000));
      try {
        const response = await fetchFn(`${root}/chat/completions`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-Request-ID': requestId
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            thinking: { type: thinking ? 'enabled' : 'disabled' },
            ...(thinking ? { reasoning_effort: reasoningEffort || 'high' } : {})
          }),
          signal: controller.signal
        });
        const text = await response.text();
        if (!response.ok) {
          if ([429, 500, 503].includes(response.status) && transportAttempts === 1) {
            await wait(retryDelayMs);
            continue;
          }
          throw mapHttpError(response.status);
        }
        let body;
        try {
          body = text ? JSON.parse(text) : null;
        } catch (_) {
          throw new AppError(502, 'MODEL_INVALID_RESPONSE', 'DeepSeek返回了无法识别的响应。');
        }
        return {
          content: body?.choices?.[0]?.message?.content,
          finishReason: body?.choices?.[0]?.finish_reason || null,
          usage: normalizedUsage(body?.usage),
          transportAttempts
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error?.name === 'AbortError') {
          throw new AppError(
            504,
            'MODEL_TIMEOUT_UNCERTAIN',
            'DeepSeek响应超时。为避免重复计费，系统没有自动重试。'
          );
        }
        throw new AppError(
          502,
          'MODEL_NETWORK_UNCERTAIN',
          'DeepSeek连接中断。为避免重复计费，系统没有自动重试。'
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AppError(503, 'MODEL_UNAVAILABLE', 'DeepSeek暂时无法完成请求。');
  }

  async function balance(apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchFn(`${root}/user/balance`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      if (!response.ok) throw mapHttpError(response.status);
      const body = await response.json();
      const cny = (body?.balance_infos || []).find(item => item.currency === 'CNY') || null;
      return {
        isAvailable: Boolean(body?.is_available),
        currency: cny?.currency || null,
        totalBalance: cny ? Number(cny.total_balance) : null,
        toppedUpBalance: cny ? Number(cny.topped_up_balance) : null,
        grantedBalance: cny ? Number(cny.granted_balance) : null
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.name === 'AbortError') {
        throw new AppError(504, 'BALANCE_TIMEOUT', 'DeepSeek余额查询超时。');
      }
      throw new AppError(502, 'BALANCE_UNAVAILABLE', 'DeepSeek余额暂时无法查询。');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    completion,
    balance
  };
}

module.exports = {
  normalizedUsage,
  addUsage,
  createDeepSeekClient
};
