const fs = require('fs');
const path = require('path');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function documentNameFromSource(sourceFile) {
  return String(sourceFile || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '来源未标注文档';
}

const DEPARTMENT_OR_OFFICE_NAMES = [
  '工程技术部',
  '质量管理部',
  '财务部',
  '经营发展部',
  '项目管理部',
  '物资保障部',
  '复材车间',
  '运维安环部',
  '行政人事部',
  '办公室',
  '综合办公室',
  '总经理办公室'
];

const LEADER_ROLE_EXCEPTIONS = new Set(['总经理', '经营副总', '生产副总']);
const COMMON_ROLE_TERMS = [
  '负责人',
  '责任人',
  '审核人',
  '批准人',
  '编制人',
  '申请人',
  '管理员',
  '成本会计',
  '设计人员',
  '定额员',
  '检验员',
  '工程师',
  '技术员',
  '部长',
  '主任',
  '经理'
];
const ROLE_TERM_RE = /[\u4e00-\u9fff]{2,20}(?:办公室|负责人|责任人|审核人|批准人|编制人|申请人|管理员|成本会计|设计人员|定额员|检验员|工程师|技术员|副总|部长|主任|经理|车间|部门|部)/g;

function uniqueTerms(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const term = String(value || '').trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    output.push(term);
  }
  return output;
}

function roleDefinitionStatus(roleName, sourceText = '') {
  const name = String(roleName || '').trim();
  const text = String(sourceText || '');
  if (!name) return '待回源确认';
  if (LEADER_ROLE_EXCEPTIONS.has(name)) return '原文明确';
  if (DEPARTMENT_OR_OFFICE_NAMES.includes(name)) return '原文明确';
  if (DEPARTMENT_OR_OFFICE_NAMES.some(prefix => name.startsWith(prefix) && name.length > prefix.length)) {
    return '原文明确';
  }
  if (DEPARTMENT_OR_OFFICE_NAMES.some(prefix => text.includes(`${prefix}${name}`))) {
    return '原文明确';
  }
  return '原文定义不足';
}

function roleTermHasDepartmentPrefix(roleName) {
  const name = String(roleName || '').trim();
  return DEPARTMENT_OR_OFFICE_NAMES.includes(name) ||
    DEPARTMENT_OR_OFFICE_NAMES.some(prefix => name.startsWith(prefix) && name.length > prefix.length);
}

function roleTermsFromText(text) {
  return uniqueTerms([
    ...[...LEADER_ROLE_EXCEPTIONS].filter(role => String(text || '').includes(role)),
    ...COMMON_ROLE_TERMS.filter(role => String(text || '').includes(role)),
    ...[...String(text || '').matchAll(ROLE_TERM_RE)].map(match => match[0])
  ]);
}

function roleAppearsNaked(roleName, sourceText) {
  const role = String(roleName || '').trim();
  const text = String(sourceText || '');
  if (!role || LEADER_ROLE_EXCEPTIONS.has(role) || roleTermHasDepartmentPrefix(role)) return false;
  let index = text.indexOf(role);
  while (index >= 0) {
    const hasPrefix = DEPARTMENT_OR_OFFICE_NAMES.some(prefix =>
      index >= prefix.length && text.slice(index - prefix.length, index) === prefix
    );
    if (!hasPrefix) return true;
    index = text.indexOf(role, index + role.length);
  }
  return false;
}

function inferDefinitionStatus(item, sourceText = '') {
  if (item.definition_status) return item.definition_status;
  const text = `${item.content || item.issue_content || ''}\n${sourceText || ''}`;
  const roleTerms = roleTermsFromText(text);
  if (!roleTerms.length) return '';
  if (roleTerms.some(role => roleAppearsNaked(role, text))) {
    return '原文定义不足';
  }
  return '原文明确';
}

function parseAnchor(anchor) {
  const text = String(anchor || '');
  const clause = text.match(/§\s*([0-9]+(?:\.[0-9]+)*)/)?.[1] || '';
  const page = text.match(/\bpage\s*=?\s*(\d+)\b/i)?.[1] || text.match(/第?(\d+)页/)?.[1] || '';
  const paragraph = text.match(/\bP(\d+)\b/i)?.[1] || '';
  const table = text.match(/\b(T\d+)\b/i)?.[1] || '';
  return {
    clause,
    page,
    paragraph_id: paragraph ? `P${paragraph}` : '',
    table_id: table
  };
}

function humanizeAnchor(anchorText) {
  return String(anchorText || '')
    .replace(/§\s*([0-9]+(?:\.[0-9]+)*)/g, '第$1条')
    .replace(/\bpage\s*=?\s*(\d+)\b/gi, '第$1页')
    .replace(/第?(\d+)页/g, '第$1页')
    .replace(/\bP(\d+)\b/gi, '原文位置待核对')
    .replace(/\bT(\d+)\b/gi, '表$1')
    .trim();
}

function formatSourceForBusiness(sourceFile, sourceAnchor) {
  const parts = [];
  const fileName = sourceFile ? documentNameFromSource(sourceFile) : '';
  if (fileName) parts.push(fileName);

  const anchor = parseAnchor(sourceAnchor);
  if (anchor.clause) parts.push(`第${anchor.clause}条`);
  if (anchor.page) parts.push(`第${anchor.page}页`);
  if (anchor.table_id) parts.push(anchor.table_id.replace(/^T/i, '表'));
  if (anchor.paragraph_id && !anchor.clause && !anchor.page && !anchor.table_id) {
    parts.push('原文位置待核对');
  }

  if (!parts.length && sourceAnchor) parts.push(humanizeAnchor(sourceAnchor));
  return parts.filter(Boolean).join(' · ') || '来源未标注';
}

function chunkAnchor(chunk) {
  const parts = [];
  if (chunk.doc_no) parts.push(chunk.doc_no);
  if (chunk.clause) parts.push(`§${chunk.clause}`);
  if (chunk.page) parts.push(`page=${chunk.page}`);
  if (chunk.paragraph_id) parts.push(chunk.paragraph_id);
  if (chunk.table_id) parts.push(`${chunk.table_id}${chunk.row_id ? `R${chunk.row_id}` : ''}`);
  return parts.join(' ');
}

function sourceMatch(reviewItem, chunk) {
  const reviewFile = String(reviewItem.source_file || '').replace(/\\/g, '/');
  const chunkFile = String(chunk.source_file || '').replace(/\\/g, '/');
  return !reviewFile || !chunkFile || reviewFile === chunkFile ||
    reviewFile.endsWith(chunkFile) || chunkFile.endsWith(reviewFile);
}

function highlightPhrases(value) {
  return [...new Set(String(value || '')
    .split(/[→；;，,。\s、/]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3))]
    .slice(0, 18);
}

function scoreChunk(reviewItem, anchor, chunk) {
  if (!sourceMatch(reviewItem, chunk)) return -1;
  let score = 0;
  if (anchor.clause && chunk.clause === anchor.clause) score += 12;
  if (anchor.paragraph_id && chunk.paragraph_id === anchor.paragraph_id) score += 12;
  if (anchor.table_id && chunk.table_id === anchor.table_id) score += 10;
  const text = `${chunk.raw_text || ''}\n${chunk.normalized_text || ''}`;
  for (const phrase of highlightPhrases(reviewItem.content)) {
    if (text.includes(phrase)) score += phrase.length >= 8 ? 8 : 3;
  }
  return score;
}

function evidenceForReviewItem(reviewItem, chunks) {
  const anchor = parseAnchor(reviewItem.source_anchor);
  return chunks
    .map(chunk => ({ chunk, score: scoreChunk(reviewItem, anchor, chunk) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ chunk }, index) => {
      const sourceAnchor = chunkAnchor(chunk);
      return {
        chunk_id: chunk.chunk_id || `excerpt-${index + 1}`,
        source_anchor: sourceAnchor,
        source_label: formatSourceForBusiness('', sourceAnchor),
        raw_text: chunk.raw_text || '',
        evidence_status: chunk.evidence_status || 'needs_review',
        verification_status: chunk.verification_status || 'unverified',
        allowed_downstream_use: chunk.allowed_downstream_use || 'review_only',
        display_order: index + 1
      };
    });
}

function normalizeReviewItem(item, index) {
  const stableKey = item.stable_key || item.id || `review-item-${index + 1}`;
  return {
    id: item.id || `IBR-${String(stableKey).toUpperCase()}`,
    stable_key: stableKey,
    review_item_id: item.review_item_id || item.id || `IBR-${String(stableKey).toUpperCase()}`,
    department: item.department || '',
    document_name: item.document_name || documentNameFromSource(item.source_file),
    source_file: item.source_file || '',
    source_anchor: item.source_anchor || '',
    source_label: formatSourceForBusiness(item.source_file, item.source_anchor),
    issue_type: item.issue_type || '',
    content: item.content || item.issue_content || '',
    mapping_location: item.mapping_location || item.current_mapping_location || '',
    suggested_action: item.suggested_action || '',
    definition_status: item.definition_status || '',
    owner: item.owner || '',
    display_order: index + 1
  };
}

function loadReviewRunBundle(reviewRunDir) {
  const runId = path.basename(reviewRunDir);
  const reviewItems = readJson(path.join(reviewRunDir, 'mapping_diff_items.json'), []);
  const chunks = readJsonl(path.join(reviewRunDir, 'chunks.jsonl'));
  const embedding = readJson(path.join(reviewRunDir, 'embedding_manifest.json'), {});
  const reportPath = path.join(reviewRunDir, 'mapping_diff_report.md');
  const mappingDiffReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const items = reviewItems.map((reviewItem, index) => {
    const item = normalizeReviewItem(reviewItem, index);
    item.source_excerpts = evidenceForReviewItem(item, chunks);
    item.definition_status = inferDefinitionStatus(item, item.source_excerpts.map(excerpt => excerpt.raw_text).join('\n'));
    return item;
  });

  return {
    run: {
      run_id: runId,
      review_run_path: reviewRunDir,
      issue_count: items.length,
      embedding_status: embedding.status || 'missing',
      embedding_model: embedding.model || '',
      mapping_diff_report: mappingDiffReport
    },
    items
  };
}

function groupReviewItemsForReview(items) {
  const byDepartment = new Map();
  for (const item of items || []) {
    const department = item.department || '未标注部门';
    const documentName = item.document_name || documentNameFromSource(item.source_file);
    const type = item.issue_type || '其他待确认';
    if (!byDepartment.has(department)) byDepartment.set(department, new Map());
    const byDocument = byDepartment.get(department);
    if (!byDocument.has(documentName)) byDocument.set(documentName, new Map());
    const byType = byDocument.get(documentName);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }

  return [...byDepartment.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([department, documents]) => ({
      department,
      documents: [...documents.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .map(([document_name, types]) => ({
          document_name,
          types: [...types.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
            .map(([issue_type, reviewItems]) => ({ issue_type, reviewItems }))
        }))
    }));
}

function normalizeReviewPayload(payload = {}) {
  const text = value => String(value || '').trim();
  return {
    decision: text(payload.decision),
    evidence_status: text(payload.evidence_status || payload.decision_evidence_status || 'not_reviewed'),
    issue_type: text(payload.issue_type || 'none'),
    definition_status: text(payload.definition_status || 'needs_original_review'),
    normalized_note: text(payload.normalized_note),
    reviewer: text(payload.reviewer)
  };
}

function attachExcerpts(items, excerpts) {
  const byStableKey = new Map();
  for (const excerpt of excerpts) {
    if (!byStableKey.has(excerpt.stable_key)) byStableKey.set(excerpt.stable_key, []);
    byStableKey.get(excerpt.stable_key).push(excerpt);
  }
  return items.map(item => ({
    ...item,
    source_label: item.source_label || formatSourceForBusiness(item.source_file, item.source_anchor),
    decision_evidence_status: item.decision_evidence_status || '',
    definition_status: item.decision_definition_status || item.definition_status || '',
    source_excerpts: byStableKey.get(item.stable_key) || []
  }));
}

function filterReviewItems(items, filters = {}) {
  return items.filter(item => {
    if (filters.dept && item.department !== String(filters.dept)) return false;
    if (filters.document && item.document_name !== String(filters.document)) return false;
    if (filters.type && item.issue_type !== String(filters.type)) return false;
    return true;
  });
}

function makeProcessInputBaselineReviewRepository(pool) {
  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async upsertBundle(bundle) {
      await pool.execute(
        `INSERT INTO process_input_baseline_review_runs
          (run_id, review_run_path, issue_count, embedding_status, embedding_model, mapping_diff_report)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          review_run_path=VALUES(review_run_path),
          issue_count=VALUES(issue_count),
          embedding_status=VALUES(embedding_status),
          embedding_model=VALUES(embedding_model),
          mapping_diff_report=VALUES(mapping_diff_report),
          updated_at=CURRENT_TIMESTAMP`,
        [
          bundle.run.run_id,
          bundle.run.review_run_path,
          bundle.run.issue_count,
          bundle.run.embedding_status,
          bundle.run.embedding_model,
          bundle.run.mapping_diff_report || ''
        ]
      );

      const stableKeys = bundle.items.map(item => item.stable_key).filter(Boolean);
      if (stableKeys.length) {
        await pool.execute(
          `DELETE FROM process_input_baseline_review_items
           WHERE run_id = ? AND stable_key NOT IN (${stableKeys.map(() => '?').join(', ')})`,
          [bundle.run.run_id, ...stableKeys]
        );
      } else {
        await pool.execute('DELETE FROM process_input_baseline_review_items WHERE run_id = ?', [bundle.run.run_id]);
      }

      for (const item of bundle.items) {
        await pool.execute(
          `INSERT INTO process_input_baseline_review_items
            (run_id, stable_key, review_item_id, department, document_name, source_file, source_anchor,
             issue_type, content, mapping_location, suggested_action, definition_status, owner, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            review_item_id=VALUES(review_item_id),
            department=VALUES(department),
            document_name=VALUES(document_name),
            source_file=VALUES(source_file),
            source_anchor=VALUES(source_anchor),
            issue_type=VALUES(issue_type),
            content=VALUES(content),
            mapping_location=VALUES(mapping_location),
            suggested_action=VALUES(suggested_action),
            definition_status=VALUES(definition_status),
            owner=VALUES(owner),
            display_order=VALUES(display_order),
            updated_at=CURRENT_TIMESTAMP`,
          [
            bundle.run.run_id,
            item.stable_key,
            item.review_item_id || item.id || '',
            item.department,
            item.document_name,
            item.source_file,
            item.source_anchor,
            item.issue_type,
            item.content,
            item.mapping_location,
            item.suggested_action,
            item.definition_status,
            item.owner,
            item.display_order
          ]
        );

        await pool.execute(
          'DELETE FROM process_input_baseline_review_excerpts WHERE run_id = ? AND stable_key = ?',
          [bundle.run.run_id, item.stable_key]
        );

        for (const excerpt of item.source_excerpts || []) {
          await pool.execute(
            `INSERT INTO process_input_baseline_review_excerpts
              (run_id, stable_key, chunk_id, source_anchor, source_label, raw_text, evidence_status,
               verification_status, allowed_downstream_use, display_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              bundle.run.run_id,
              item.stable_key,
              excerpt.chunk_id,
              excerpt.source_anchor,
              excerpt.source_label || formatSourceForBusiness('', excerpt.source_anchor),
              excerpt.raw_text,
              excerpt.evidence_status,
              excerpt.verification_status,
              excerpt.allowed_downstream_use,
              excerpt.display_order
            ]
          );
        }
      }
    },

    async listRuns() {
      const [rows] = await pool.execute(
        `SELECT run_id, review_run_path, issue_count, embedding_status, embedding_model, imported_at, updated_at
         FROM process_input_baseline_review_runs
         ORDER BY imported_at DESC, run_id DESC`
      );
      return rows;
    },

    async getReviewItems(runId, filters = {}) {
      const [itemRows] = await pool.execute(
        `SELECT i.*,
                d.decision,
                d.evidence_status AS decision_evidence_status,
                d.issue_type,
                d.definition_status AS decision_definition_status,
                d.normalized_note,
                d.reviewer,
                d.reviewed_at,
                d.updated_at AS decision_updated_at
         FROM process_input_baseline_review_items i
         LEFT JOIN process_input_baseline_review_decisions d
           ON d.run_id = i.run_id AND d.stable_key = i.stable_key
         WHERE i.run_id = ?
         ORDER BY i.department, i.document_name, i.issue_type, i.display_order, i.stable_key`,
        [runId]
      );

      let items = itemRows.map(row => ({
        ...row,
        source_label: formatSourceForBusiness(row.source_file, row.source_anchor)
      }));
      if (items.length) {
        const stableKeys = items.map(item => item.stable_key);
        const [excerptRows] = await pool.execute(
          `SELECT run_id, stable_key, chunk_id, source_anchor, source_label, raw_text, evidence_status,
                  verification_status, allowed_downstream_use, display_order
           FROM process_input_baseline_review_excerpts
           WHERE run_id = ? AND stable_key IN (${stableKeys.map(() => '?').join(', ')})
           ORDER BY stable_key, display_order, chunk_id`,
          [runId, ...stableKeys]
        );
        items = attachExcerpts(items, excerptRows);
      }

      items = filterReviewItems(items, filters);
      return {
        summary: { total: items.length },
        groups: groupReviewItemsForReview(items),
        items
      };
    },

    async saveDecision(runId, stableKey, payload) {
      const normalized = normalizeReviewPayload(payload);
      await pool.execute(
        `INSERT INTO process_input_baseline_review_decisions
          (run_id, stable_key, decision, evidence_status, issue_type, definition_status, normalized_note, reviewer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          decision=VALUES(decision),
          evidence_status=VALUES(evidence_status),
          issue_type=VALUES(issue_type),
          definition_status=VALUES(definition_status),
          normalized_note=VALUES(normalized_note),
          reviewer=VALUES(reviewer),
          reviewed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP`,
        [
          runId,
          stableKey,
          normalized.decision,
          normalized.evidence_status,
          normalized.issue_type,
          normalized.definition_status,
          normalized.normalized_note,
          normalized.reviewer
        ]
      );
      const [rows] = await pool.execute(
        `SELECT decision, evidence_status, issue_type, definition_status, normalized_note, reviewer, reviewed_at, updated_at
         FROM process_input_baseline_review_decisions
         WHERE run_id = ? AND stable_key = ?
         LIMIT 1`,
        [runId, stableKey]
      );
      const row = rows[0];
      return row ? {
        decision: row.decision || '',
        evidence_status: row.evidence_status || 'not_reviewed',
        issue_type: row.issue_type || 'none',
        definition_status: row.definition_status || 'needs_original_review',
        normalized_note: row.normalized_note || '',
        reviewer: row.reviewer || '',
        reviewed_at: row.reviewed_at || null,
        updated_at: row.updated_at || null
      } : normalized;
    }
  };
}

module.exports = {
  documentNameFromSource,
  formatSourceForBusiness,
  groupReviewItemsForReview,
  loadReviewRunBundle,
  makeProcessInputBaselineReviewRepository,
  normalizeReviewPayload,
  roleDefinitionStatus
};
