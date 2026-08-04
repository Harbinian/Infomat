'use strict';

const crypto = require('crypto');
const { AppError } = require('./errors');
const { addUsage } = require('./deepseek');
const { applyRestrictedPatch, parsePointer } = require('./json-patch');
const {
  fillSystemPrompt,
  fillUserPrompt,
  repairPrompt,
  reviewSystemPrompt,
  reviewUserPrompt
} = require('./prompts');

const FIELD_STATUSES = new Set(['confirmed', 'temporarily_missing', 'not_applicable']);
const REVIEW_CATEGORIES = new Set(['field_placement', 'object_split']);

function parseJsonObject(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError(422, 'MODEL_EMPTY_CONTENT', '模型返回了空内容。');
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new AppError(422, 'MODEL_INVALID_JSON', '模型返回的内容不是合法JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(422, 'MODEL_INVALID_JSON', '模型返回的内容不是JSON对象。');
  }
  return parsed;
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeFillResult(parsed) {
  const patch = Array.isArray(parsed.patch) ? parsed.patch : [];
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .slice(0, 20)
    .map(item => {
      parsePointer(item?.path);
      return {
        path: item.path,
        question: normalizeText(item?.question, 600)
      };
    })
    .filter(item => item.question)
    .slice(0, 1);
  const fieldStatuses = (Array.isArray(parsed.field_statuses) ? parsed.field_statuses : [])
    .slice(0, 200)
    .map(item => {
      parsePointer(item?.path);
      const status = String(item?.status || '');
      if (!FIELD_STATUSES.has(status)) {
        throw new AppError(422, 'MODEL_INVALID_FIELD_STATUS', '模型返回了无效的字段状态。');
      }
      return {
        path: item.path,
        status,
        note: normalizeText(item?.note, 400)
      };
    });
  return {
    assistantMessage: normalizeText(parsed.assistant_message, 6000) || '请继续补充与当前结构相关的信息。',
    questions,
    patch,
    fieldStatuses
  };
}

function normalizePriorFieldStatuses(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AppError(400, 'INVALID_FIELD_STATUS', '此前字段确认状态格式不正确。');
  }
  return value.slice(0, 200).map(item => {
    try {
      parsePointer(item?.path);
    } catch (_) {
      throw new AppError(400, 'INVALID_FIELD_STATUS', '此前字段确认状态包含无效路径。');
    }
    const status = String(item?.status || '');
    if (!FIELD_STATUSES.has(status)) {
      throw new AppError(400, 'INVALID_FIELD_STATUS', '此前字段确认状态包含无效状态。');
    }
    return {
      path: item.path,
      status,
      note: normalizeText(item?.note, 400)
    };
  });
}

function normalizeValidationErrors(errors) {
  return (Array.isArray(errors) ? errors : []).slice(0, 100).map(error => ({
    path: String(error.path || '/'),
    keyword: String(error.keyword || ''),
    message: String(error.message || ''),
    params: error.params && typeof error.params === 'object' ? error.params : {}
  }));
}

function normalizeReviewResult(parsed, document, validationErrors) {
  const fixes = new Map();
  for (const item of (Array.isArray(parsed.hard_error_fixes) ? parsed.hard_error_fixes : []).slice(0, 100)) {
    const errorIndex = Number(item?.error_index);
    if (!Number.isInteger(errorIndex) || errorIndex < 0 || errorIndex >= validationErrors.length) continue;
    const patch = Array.isArray(item.patch) ? item.patch : [];
    if (patch.length) applyRestrictedPatch(document, patch);
    fixes.set(errorIndex, {
      title: normalizeText(item?.title, 200),
      explanation: normalizeText(item?.explanation, 1000),
      patch
    });
  }

  const hardErrors = validationErrors.map((error, index) => {
    const fix = fixes.get(index);
    return {
      id: `hard_${index}_${crypto.randomBytes(4).toString('hex')}`,
      severity: 'hard_error',
      category: error.keyword || 'schema',
      path: error.path || '/',
      title: fix?.title || '必须修复的结构错误',
      explanation: fix?.explanation || error.message || '当前JSON不符合结构化工具的硬性结构要求。',
      patch: fix?.patch || [],
      dismissible: false
    };
  });

  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .slice(0, 30)
    .map((item, index) => {
      const category = String(item?.category || '');
      if (!REVIEW_CATEGORIES.has(category)) {
        throw new AppError(422, 'MODEL_INVALID_REVIEW_CATEGORY', '模型返回了超出结构预审范围的问题。');
      }
      parsePointer(item?.path);
      const patch = Array.isArray(item.patch) ? item.patch : [];
      if (patch.length) applyRestrictedPatch(document, patch);
      return {
        id: `suggestion_${index}_${crypto.randomBytes(4).toString('hex')}`,
        severity: 'suggestion',
        category,
        path: item.path,
        title: normalizeText(item?.title, 200) || '结构调整建议',
        explanation: normalizeText(item?.explanation, 1000),
        patch,
        dismissible: true
      };
    });

  return {
    summary: normalizeText(parsed.summary, 2000),
    issues: [...hardErrors, ...suggestions]
  };
}

async function callWithOneRepair({
  client,
  completionOptions,
  initialMessages,
  parse,
  validateParsed
}) {
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let apiCallCount = 0;
  let transportAttempts = 0;
  let firstContent = '';
  let firstProblem = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = attempt === 0
      ? initialMessages
      : [
          ...initialMessages,
          { role: 'assistant', content: firstContent || '{}' },
          { role: 'user', content: repairPrompt(firstContent, firstProblem) }
        ];
    const response = await client.completion({ ...completionOptions, messages });
    apiCallCount += 1;
    transportAttempts += response.transportAttempts;
    usage = addUsage(usage, response.usage);
    try {
      const parsed = parse(response.content);
      const value = await validateParsed(parsed);
      return {
        value,
        usage,
        apiCallCount,
        transportAttempts
      };
    } catch (error) {
      if (attempt === 1) {
        throw new AppError(
          422,
          'MODEL_OUTPUT_INVALID',
          '模型连续两次返回无法通过结构校验的结果，请保留草稿后稍后重试。',
          {
            usage,
            apiCallCount,
            transportAttempts
          }
        );
      }
      firstContent = String(response.content || '');
      firstProblem = error.message || '返回结果无法处理';
    }
  }
  throw new AppError(422, 'MODEL_OUTPUT_INVALID', '模型结果无法处理。');
}

async function runFillTurn({
  client,
  apiKey,
  model,
  maxTokens,
  requestId,
  schema,
  document,
  sourceMaterials,
  messages,
  validationErrors,
  priorFieldStatuses,
  userMessage,
  validateDocument
}) {
  const initialMessages = [
    { role: 'system', content: fillSystemPrompt(schema) },
    {
      role: 'user',
      content: fillUserPrompt({
        document,
        sourceMaterials,
        messages,
        validationErrors: normalizeValidationErrors(validationErrors),
        priorFieldStatuses: normalizePriorFieldStatuses(priorFieldStatuses),
        userMessage
      })
    }
  ];
  const result = await callWithOneRepair({
    client,
    completionOptions: {
      apiKey,
      model,
      thinking: false,
      maxTokens,
      requestId
    },
    initialMessages,
    parse: parseJsonObject,
    validateParsed: async parsed => {
      const normalized = normalizeFillResult(parsed);
      const updatedDocument = applyRestrictedPatch(document, normalized.patch);
      const validation = await validateDocument(updatedDocument);
      if (!validation.valid) {
        const details = normalizeValidationErrors(validation.errors)
          .slice(0, 10)
          .map(error => `${error.path}: ${error.message}`)
          .join('；');
        throw new AppError(422, 'MODEL_PATCH_INVALID', `修改后未通过结构校验：${details}`);
      }
      return {
        ...normalized,
        document: validation.data || updatedDocument,
        validation: {
          valid: true,
          errors: []
        }
      };
    }
  });
  return {
    ...result.value,
    usage: result.usage,
    apiCallCount: result.apiCallCount,
    transportAttempts: result.transportAttempts
  };
}

async function runIndependentReview({
  client,
  apiKey,
  model,
  maxTokens,
  requestId,
  schema,
  document,
  validation
}) {
  const validationErrors = normalizeValidationErrors(validation.errors);
  const initialMessages = [
    { role: 'system', content: reviewSystemPrompt(schema) },
    {
      role: 'user',
      content: reviewUserPrompt({ document, validationErrors })
    }
  ];
  const result = await callWithOneRepair({
    client,
    completionOptions: {
      apiKey,
      model,
      thinking: true,
      reasoningEffort: 'high',
      maxTokens,
      requestId
    },
    initialMessages,
    parse: parseJsonObject,
    validateParsed: async parsed => normalizeReviewResult(parsed, document, validationErrors)
  });
  return {
    ...result.value,
    validation: {
      valid: Boolean(validation.valid),
      errors: validationErrors
    },
    usage: result.usage,
    apiCallCount: result.apiCallCount,
    transportAttempts: result.transportAttempts
  };
}

module.exports = {
  parseJsonObject,
  normalizeFillResult,
  normalizePriorFieldStatuses,
  normalizeValidationErrors,
  normalizeReviewResult,
  callWithOneRepair,
  runFillTurn,
  runIndependentReview
};
