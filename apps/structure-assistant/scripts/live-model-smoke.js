'use strict';

const crypto = require('crypto');
const { loadRuntimeConfig } = require('../lib/config');
const { assertDeployableRepository } = require('../lib/repository');
const { createStructuredToolClient } = require('../lib/structured-tool');
const { createDeepSeekClient } = require('../lib/deepseek');
const { createUsageLog } = require('../lib/usage-log');
const { runFillTurn, runIndependentReview } = require('../lib/model-workflows');

async function main() {
  if (process.env.STRUCTURE_ASSISTANT_LIVE_SMOKE_CONFIRM !== 'YES') {
    throw new Error(
      'Live model smoke consumes the four configured accounts. Set STRUCTURE_ASSISTANT_LIVE_SMOKE_CONFIRM=YES explicitly.'
    );
  }
  const config = loadRuntimeConfig({ strictSecrets: true });
  const repo = assertDeployableRepository(config.repoRoot, config.security.allowDirty);
  const structuredTool = createStructuredToolClient({
    baseUrl: config.assistant.structuredToolBaseUrl,
    appCommit: repo.commit
  });
  const client = createDeepSeekClient({
    baseUrl: config.deepseek.baseUrl,
    timeoutMs: config.deepseek.requestTimeoutMs
  });
  const usageLog = createUsageLog(config.runtime.usageLogPath);
  const current = await structuredTool.snapshot();
  const summary = [];

  for (const account of config.accounts) {
    const balance = await client.balance(account.apiKey);
    if (!balance.isAvailable || balance.totalBalance == null || balance.totalBalance < config.deepseek.lowBalanceCny) {
      throw new Error(`${account.displayName}的人民币余额不足${config.deepseek.lowBalanceCny}元，停止付费烟测。`);
    }
    const template = await structuredTool.template();
    const fillRequestId = `live_fill_${account.id}_${crypto.randomBytes(4).toString('hex')}`;
    const fill = await runFillTurn({
      client,
      apiKey: account.apiKey,
      model: config.deepseek.fillModel,
      maxTokens: config.deepseek.fillMaxTokens,
      requestId: fillRequestId,
      schema: current.schema,
      document: template.data,
      sourceMaterials: [{
        material_name: '合成试点说明.txt',
        file_sha256: null,
        readable_text: '测试人员提交试点申请，信息化项目组确认记录已经填写。'
      }],
      messages: [],
      userMessage: '这是合成结构烟测。请只按现有结构整理，不评价业务内容。',
      validateDocument: data => structuredTool.validate(data)
    });
    usageLog.append({
      request_id: fillRequestId,
      user_id: account.id,
      operation: 'live_smoke_fill',
      model: config.deepseek.fillModel,
      prompt_tokens: fill.usage.prompt_tokens,
      completion_tokens: fill.usage.completion_tokens,
      total_tokens: fill.usage.total_tokens,
      schema_version: current.schemaVersion,
      schema_digest: current.schemaDigest,
      validation_valid: fill.validation.valid,
      error_code: null,
      attempt_count: fill.apiCallCount
    });

    const validation = await structuredTool.validate(fill.document);
    const reviewRequestId = `live_review_${account.id}_${crypto.randomBytes(4).toString('hex')}`;
    const review = await runIndependentReview({
      client,
      apiKey: account.apiKey,
      model: config.deepseek.reviewModel,
      maxTokens: config.deepseek.reviewMaxTokens,
      requestId: reviewRequestId,
      schema: current.schema,
      document: fill.document,
      validation
    });
    usageLog.append({
      request_id: reviewRequestId,
      user_id: account.id,
      operation: 'live_smoke_review',
      model: config.deepseek.reviewModel,
      prompt_tokens: review.usage.prompt_tokens,
      completion_tokens: review.usage.completion_tokens,
      total_tokens: review.usage.total_tokens,
      schema_version: current.schemaVersion,
      schema_digest: current.schemaDigest,
      validation_valid: validation.valid,
      error_code: null,
      attempt_count: review.apiCallCount
    });
    summary.push({
      account: account.displayName,
      fillValid: fill.validation.valid,
      reviewIssueCount: review.issues.length,
      fillTokens: fill.usage.total_tokens,
      reviewTokens: review.usage.total_tokens,
      balanceBefore: balance.totalBalance
    });
  }

  console.log(JSON.stringify({
    ok: true,
    appCommit: current.appCommit,
    schemaVersion: current.schemaVersion,
    schemaDigest: current.schemaDigest,
    accounts: summary
  }, null, 2));
  console.log('four-account DeepSeek live model smoke passed');
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
