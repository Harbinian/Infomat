const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  formatSourceForBusiness,
  loadCandidateRunBundle,
  makeProcessCandidateReviewRepository,
  normalizeReviewPayload,
  roleDefinitionStatus
} = require('../server/processCandidateReviewRepository');

function makeFakePool() {
  const state = {
    runs: new Map(),
    items: new Map(),
    excerpts: new Map(),
    decisions: new Map(),
    statements: []
  };

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('INSERT INTO process_candidate_review_runs')) {
        const [run_id, candidate_run_path, candidate_count, embedding_status, embedding_model, mapping_diff_report] = params;
        state.runs.set(run_id, {
          run_id,
          candidate_run_path,
          candidate_count,
          embedding_status,
          embedding_model,
          mapping_diff_report,
          imported_at: '2026-06-16 00:00:00',
          updated_at: '2026-06-16 00:00:00'
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('DELETE FROM process_candidate_review_items')) {
        const runId = params[0];
        const keep = new Set(params.slice(1));
        for (const key of Array.from(state.items.keys())) {
          const [itemRunId, stableKey] = key.split('\u0000');
          if (itemRunId === runId && (!keep.size || !keep.has(stableKey))) {
            state.items.delete(key);
            state.decisions.delete(key);
            for (const excerptKey of Array.from(state.excerpts.keys())) {
              if (excerptKey.startsWith(`${key}\u0000`)) state.excerpts.delete(excerptKey);
            }
          }
        }
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_candidate_review_items')) {
        const [
          run_id,
          stable_key,
          candidate_id,
          department,
          document_name,
          source_file,
          source_anchor,
          candidate_type,
          content,
          mapping_location,
          suggested_action,
          definition_status,
          owner,
          display_order
        ] = params;
        state.items.set(`${run_id}\u0000${stable_key}`, {
          run_id,
          stable_key,
          candidate_id,
          department,
          document_name,
          source_file,
          source_anchor,
          candidate_type,
          content,
          mapping_location,
          suggested_action,
          definition_status,
          owner,
          display_order,
          updated_at: '2026-06-16 00:00:00'
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('DELETE FROM process_candidate_review_excerpts')) {
        const [runId, stableKey] = params;
        const prefix = `${runId}\u0000${stableKey}\u0000`;
        for (const key of Array.from(state.excerpts.keys())) {
          if (key.startsWith(prefix)) state.excerpts.delete(key);
        }
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_candidate_review_excerpts')) {
        const [
          run_id,
          stable_key,
          chunk_id,
          source_anchor,
          source_label,
          raw_text,
          evidence_status,
          verification_status,
          allowed_downstream_use,
          display_order
        ] = params;
        state.excerpts.set(`${run_id}\u0000${stable_key}\u0000${chunk_id}`, {
          run_id,
          stable_key,
          chunk_id,
          source_anchor,
          source_label,
          raw_text,
          evidence_status,
          verification_status,
          allowed_downstream_use,
          display_order
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_candidate_review_decisions')) {
        const [
          run_id,
          stable_key,
          decision,
          evidence_status,
          issue_type,
          definition_status,
          normalized_note,
          reviewer
        ] = params;
        state.decisions.set(`${run_id}\u0000${stable_key}`, {
          run_id,
          stable_key,
          decision,
          decision_evidence_status: evidence_status,
          issue_type,
          decision_definition_status: definition_status,
          normalized_note,
          reviewer,
          reviewed_at: '2026-06-16 00:00:00',
          decision_updated_at: '2026-06-16 00:00:00'
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM process_candidate_review_decisions')) {
        const [runId, stableKey] = params;
        const row = state.decisions.get(`${runId}\u0000${stableKey}`);
        return [[row ? {
          decision: row.decision,
          evidence_status: row.decision_evidence_status,
          issue_type: row.issue_type,
          definition_status: row.decision_definition_status,
          normalized_note: row.normalized_note,
          reviewer: row.reviewer,
          reviewed_at: row.reviewed_at,
          updated_at: row.decision_updated_at
        } : undefined].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM process_candidate_review_runs')) {
        return [[...state.runs.values()].sort((a, b) => b.run_id.localeCompare(a.run_id)), undefined];
      }

      if (normalizedSql.includes('FROM process_candidate_review_items i')) {
        const runId = params[0];
        const rows = [...state.items.values()]
          .filter(item => item.run_id === runId)
          .sort((a, b) => a.display_order - b.display_order)
          .map(item => ({
            ...item,
            ...(state.decisions.get(`${item.run_id}\u0000${item.stable_key}`) || {})
          }));
        return [rows, undefined];
      }

      if (normalizedSql.includes('FROM process_candidate_review_excerpts')) {
        const runId = params[0];
        const stableKeys = new Set(params.slice(1));
        return [[...state.excerpts.values()]
          .filter(excerpt => excerpt.run_id === runId && stableKeys.has(excerpt.stable_key))
          .sort((a, b) => a.display_order - b.display_order), undefined];
      }

      throw new Error(`Unhandled SQL in fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-process-candidate-review-'));
  const runDir = path.join(tmp, 'review-run-001');
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, 'mapping_diff_items.json'), JSON.stringify([
    {
      id: 'CAND-001',
      stable_key: 'candidate-001',
      department: '工程技术部',
      source_file: 'docs/norms/工程技术部业务资料/产品设计需求定义管理程序.docx',
      source_anchor: 'GLC120102 §5.2 P71',
      candidate_type: '角色待确认',
      content: '审核人审核产品设计需求文件',
      mapping_location: '当前正式映射未见同名覆盖',
      suggested_action: '回源确认角色定义是否充分。',
      owner: '工程技术部确认人'
    }
  ], null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'chunks.jsonl'), `${JSON.stringify({
    chunk_id: 'chunk-P71',
    source_file: 'docs/norms/工程技术部业务资料/产品设计需求定义管理程序.docx',
    doc_no: 'GLC120102',
    clause: '5.2',
    paragraph_id: 'P71',
    raw_text: '审核人审核产品设计需求文件，工程技术部审核人复核设计更改记录。',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only'
  })}\n`, 'utf8');
  fs.writeFileSync(path.join(runDir, 'embedding_manifest.json'), JSON.stringify({
    status: 'skipped',
    model: 'qwen3-embedding:latest'
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'mapping_diff_report.md'), '# 测试报告\n', 'utf8');

  try {
    const bundle = loadCandidateRunBundle(runDir);
    assert.strictEqual(bundle.run.run_id, 'review-run-001');
    assert.strictEqual(bundle.items[0].document_name, '产品设计需求定义管理程序.docx');
    assert.strictEqual(bundle.items[0].source_label.includes('内部锚点P71'), false);
    assert.strictEqual(bundle.items[0].source_label.includes('原文位置待核对'), false);
    assert.strictEqual(bundle.items[0].source_label.includes('第5.2条'), true);
    assert.strictEqual(bundle.items[0].source_label.includes('第71页'), false);
    assert.strictEqual(bundle.items[0].source_label.includes('段落P71'), false);
    assert.strictEqual(bundle.items[0].source_label.includes('块号P71'), false);
    assert.strictEqual(bundle.items[0].definition_status, '原文定义不足');
    assert.strictEqual(roleDefinitionStatus('总经理', '总经理批准后执行。'), '原文明确');
    assert.strictEqual(roleDefinitionStatus('经营副总', '经营副总审批。'), '原文明确');
    assert.strictEqual(roleDefinitionStatus('生产副总', '生产副总审批。'), '原文明确');
    assert.strictEqual(roleDefinitionStatus('审核人', '审核人审核后提交。'), '原文定义不足');
    assert.strictEqual(
      formatSourceForBusiness('制度.docx', 'P71'),
      '制度.docx · 原文位置待核对'
    );

    const pool = makeFakePool();
    const repo = makeProcessCandidateReviewRepository(pool);
    await repo.initSchema();
    await repo.upsertBundle(bundle);

    const runs = await repo.listRuns();
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].candidate_count, 1);

    const candidates = await repo.getCandidates('review-run-001');
    assert.strictEqual(candidates.items.length, 1);
    assert.strictEqual(candidates.groups[0].department, '工程技术部');
    assert.strictEqual(candidates.groups[0].documents[0].document_name, '产品设计需求定义管理程序.docx');

    const payload = normalizeReviewPayload({
      decision: 'needs_correction',
      evidence_status: 'need_original_review',
      issue_type: 'role_definition_insufficient',
      definition_status: 'source_definition_insufficient',
      normalized_note: '审核人缺少部门前缀，应回源确认。',
      correction_note: '不得作为结构化字段保存',
      reviewer: 'tester'
    });
    assert.strictEqual(payload.correction_note, undefined);

    const firstSave = await repo.saveDecision('review-run-001', 'candidate-001', payload);
    assert.strictEqual(firstSave.decision, 'needs_correction');
    assert.strictEqual(firstSave.issue_type, 'role_definition_insufficient');
    assert.strictEqual(firstSave.definition_status, 'source_definition_insufficient');
    assert.strictEqual(firstSave.normalized_note, '审核人缺少部门前缀，应回源确认。');
    assert.strictEqual(firstSave.reviewed_at, '2026-06-16 00:00:00');
    assert.strictEqual(firstSave.updated_at, '2026-06-16 00:00:00');

    const secondSave = await repo.saveDecision('review-run-001', 'candidate-001', {
      ...payload,
      decision: 'reject_candidate',
      normalized_note: '原文定义不足，暂不进入正式映射。'
    });
    assert.strictEqual(secondSave.decision, 'reject_candidate');
    assert.strictEqual(secondSave.normalized_note, '原文定义不足，暂不进入正式映射。');

    const updated = await repo.getCandidates('review-run-001');
    assert.strictEqual(updated.items[0].decision, 'reject_candidate');
    assert.strictEqual(updated.items[0].normalized_note, '原文定义不足，暂不进入正式映射。');
    assert.ok(pool.state.statements.some(entry => entry.sql.includes('ON DUPLICATE KEY UPDATE')), 'decisions should be upserted for repeat saves');

    console.log('Process candidate review MySQL repository test passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
