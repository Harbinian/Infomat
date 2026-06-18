import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function candidateReviewSchemaSql() {
  return `
CREATE TABLE IF NOT EXISTS candidate_review_runs (
  run_id VARCHAR(128) PRIMARY KEY,
  candidate_run_path VARCHAR(512) NOT NULL,
  candidate_count INT NOT NULL DEFAULT 0,
  embedding_status VARCHAR(64) NOT NULL DEFAULT 'missing',
  embedding_model VARCHAR(128) NOT NULL DEFAULT '',
  mapping_diff_report MEDIUMTEXT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_review_items (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  candidate_id VARCHAR(128) NOT NULL DEFAULT '',
  department VARCHAR(128) NOT NULL DEFAULT '',
  document_name VARCHAR(255) NOT NULL DEFAULT '',
  source_file VARCHAR(512) NOT NULL DEFAULT '',
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  candidate_type VARCHAR(64) NOT NULL DEFAULT '',
  failure_class VARCHAR(64) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mapping_location TEXT NULL,
  suggested_action TEXT NULL,
  owner VARCHAR(255) NOT NULL DEFAULT '',
  display_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stable_key),
  CONSTRAINT fk_candidate_review_items_run FOREIGN KEY (run_id)
    REFERENCES candidate_review_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_review_excerpts (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  chunk_id VARCHAR(128) NOT NULL,
  source_anchor VARCHAR(255) NOT NULL DEFAULT '',
  raw_text MEDIUMTEXT NOT NULL,
  extraction_quality VARCHAR(64) NOT NULL DEFAULT '',
  evidence_status VARCHAR(64) NOT NULL DEFAULT 'candidate',
  verification_status VARCHAR(64) NOT NULL DEFAULT 'unverified',
  allowed_downstream_use VARCHAR(64) NOT NULL DEFAULT 'review_only',
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, stable_key, chunk_id),
  CONSTRAINT fk_candidate_review_excerpts_item FOREIGN KEY (run_id, stable_key)
    REFERENCES candidate_review_items(run_id, stable_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_review_decisions (
  run_id VARCHAR(128) NOT NULL,
  stable_key VARCHAR(128) NOT NULL,
  decision VARCHAR(64) NOT NULL DEFAULT '',
  evidence_status VARCHAR(64) NOT NULL DEFAULT 'not_reviewed',
  next_action VARCHAR(64) NOT NULL DEFAULT 'keep_todo',
  failure_class VARCHAR(64) NOT NULL DEFAULT '',
  issue_type VARCHAR(64) NOT NULL DEFAULT '',
  definition_status VARCHAR(64) NOT NULL DEFAULT '',
  normalized_note TEXT NULL,
  reviewer VARCHAR(128) NOT NULL DEFAULT '',
  reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stable_key),
  CONSTRAINT fk_candidate_review_decisions_item FOREIGN KEY (run_id, stable_key)
    REFERENCES candidate_review_items(run_id, stable_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
}

export function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

export function loadCandidateRunBundle(candidateRunDir) {
  const runId = basename(candidateRunDir);
  const candidates = readJson(join(candidateRunDir, 'mapping_diff_items.json'), []);
  const chunks = readJsonl(join(candidateRunDir, 'chunks.jsonl'));
  const embedding = readJson(join(candidateRunDir, 'embedding_manifest.json'), {});
  const report = existsSync(join(candidateRunDir, 'mapping_diff_report.md'))
    ? readFileSync(join(candidateRunDir, 'mapping_diff_report.md'), 'utf8')
    : '';

  const items = candidates.map((candidate, index) => {
    const item = normalizeCandidate(candidate, index);
    item.source_excerpts = evidenceForCandidate(item, chunks);
    return item;
  });

  return {
    run: {
      run_id: runId,
      candidate_run_path: candidateRunDir,
      candidate_count: items.length,
      embedding_status: embedding.status || 'missing',
      embedding_model: embedding.model || '',
      mapping_diff_report: report,
    },
    items,
  };
}

export function normalizeCandidate(item, index) {
  const stableKey = item.stable_key || item.id || `candidate-${index + 1}`;
  return {
    id: item.id || `CAND-${String(stableKey).toUpperCase()}`,
    stable_key: stableKey,
    department: item.department || '',
    document_name: item.document_name || documentNameFromSource(item.source_file),
    source_file: item.source_file || '',
    source_anchor: item.source_anchor || '',
    candidate_type: item.candidate_type || '',
    failure_class: classifyCandidate(item.candidate_type),
    content: item.content || item.candidate_content || '',
    mapping_location: item.mapping_location || item.current_mapping_location || '',
    suggested_action: item.suggested_action || '',
    owner: item.owner || '',
    display_order: index + 1,
  };
}

export function classifyCandidate(candidateType) {
  const mapping = {
    候选L3: '漏判',
    候选A1: '漏判',
    角色待确认: '证据不足',
    审批链待确认: '证据不足',
    受控传递待确认: '证据不足',
    OCR待复核: '证据不足',
    验收标准待补: '规则缺失',
    归档要求待补: '规则缺失',
    系统落位待确认: '规则缺失',
  };
  return mapping[candidateType] || '测试缺失';
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
  '总经理办公室',
];

const LEADER_ROLE_EXCEPTIONS = new Set(['总经理', '经营副总', '生产副总']);

export function documentNameFromSource(sourceFile) {
  return String(sourceFile || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '来源未标注文档';
}

export function roleDefinitionStatus(roleName, sourceText = '') {
  const name = String(roleName || '').trim();
  const text = String(sourceText || '');
  if (!name) return '待回源确认';
  if (LEADER_ROLE_EXCEPTIONS.has(name)) return '原文明确';
  if (DEPARTMENT_OR_OFFICE_NAMES.includes(name)) return '原文明确';
  if (DEPARTMENT_OR_OFFICE_NAMES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length)) {
    return '原文明确';
  }
  if (DEPARTMENT_OR_OFFICE_NAMES.some((prefix) => text.includes(`${prefix}${name}`))) {
    return '原文明确';
  }
  return '原文定义不足';
}

export function groupCandidatesForReview(items) {
  const byDepartment = new Map();
  for (const item of items || []) {
    const department = item.department || '未标注部门';
    const documentName = item.document_name || documentNameFromSource(item.source_file);
    const type = item.candidate_type || '其他候选';
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
            .map(([candidate_type, candidates]) => ({ candidate_type, candidates })),
        })),
    }));
}

export function formatSourceForBusiness(sourceFile, sourceAnchor) {
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

  if (!parts.length && sourceAnchor) {
    parts.push(humanizeAnchor(sourceAnchor));
  }
  return parts.filter(Boolean).join(' · ') || '来源未标注';
}

export function describeMappingForBusiness(mappingLocation) {
  const value = String(mappingLocation || '').trim();
  if (!value || value === '未标注') {
    return '暂未找到对应的现有映射记录，需要确认这条说法是否应该补入正式映射。';
  }
  if (value.includes('当前正式映射未见')) {
    return '目前没有在正式映射表里看到能直接覆盖这条说法的记录，需要确认是否要补入。';
  }
  if (/^[A-Z]{2,}(?:-[A-Z0-9]+)+$/i.test(value)) {
    return `目前只看到现有映射编号 ${value}，还需要对照正式流程表确认它是否已经覆盖这条说法。`;
  }
  return value;
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
    table_id: table,
  };
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

function sourceMatch(candidate, chunk) {
  const candidateFile = String(candidate.source_file || '').replace(/\\/g, '/');
  const chunkFile = String(chunk.source_file || '').replace(/\\/g, '/');
  return !candidateFile || !chunkFile || candidateFile === chunkFile || candidateFile.endsWith(chunkFile) || chunkFile.endsWith(candidateFile);
}

function scoreChunk(candidate, anchor, chunk) {
  if (!sourceMatch(candidate, chunk)) return -1;
  let score = 0;
  if (anchor.clause && chunk.clause === anchor.clause) score += 12;
  if (anchor.paragraph_id && chunk.paragraph_id === anchor.paragraph_id) score += 12;
  if (anchor.table_id && chunk.table_id === anchor.table_id) score += 10;
  const text = `${chunk.raw_text || ''}\n${chunk.normalized_text || ''}`;
  for (const phrase of highlightPhrases(candidate.content)) {
    if (text.includes(phrase)) score += phrase.length >= 8 ? 8 : 3;
  }
  return score;
}

export function evidenceForCandidate(candidate, chunks) {
  const anchor = parseAnchor(candidate.source_anchor);
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(candidate, anchor, chunk) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ chunk }, index) => ({
      chunk_id: chunk.chunk_id || `excerpt-${index + 1}`,
      source_anchor: chunkAnchor(chunk),
      raw_text: chunk.raw_text || '',
      extraction_quality: chunk.extraction_quality || '',
      evidence_status: chunk.evidence_status || 'candidate',
      verification_status: chunk.verification_status || 'unverified',
      allowed_downstream_use: chunk.allowed_downstream_use || 'review_only',
      display_order: index + 1,
    }));
}

export function highlightPhrases(value) {
  const text = String(value || '');
  const parts = text
    .split(/[→；;，,。\s、/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  const longParts = parts.filter((part) => part.length >= 6);
  return [...new Set([...longParts, ...parts])].slice(0, 18);
}

const ACTION_TERMS = [
  '编制',
  '制定',
  '提交',
  '提供',
  '接收',
  '审核',
  '复核',
  '会签',
  '批准',
  '审批',
  '签批',
  '发放',
  '归档',
  '保存',
  '移交',
  '处理',
  '确认',
  '统计',
  '分析',
];

const ROLE_TERM_RE = /[\u4e00-\u9fff]{2,20}(?:办公室|负责人|责任人|审核人|批准人|编制人|申请人|管理员|成本会计|设计人员|定额员|检验员|工程师|技术员|副总|部长|主任|经理|车间|部门|部)/g;
const OBJECT_TERM_RE = /[\u4e00-\u9fff]{2,28}(?:报表|文件|记录|清单|申请|表单|资料|方案|计划|报告|台账|数据|结果|交付物|说明|通知|凭证|单据)/g;

function uniqueTerms(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const term = String(value || '').trim();
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    output.push(term);
  }
  return output;
}

export function highlightTermsForCandidate(candidate) {
  const content = typeof candidate === 'string' ? candidate : candidate?.content || '';
  const evidenceText = typeof candidate === 'string'
    ? ''
    : (candidate?.source_excerpts || []).map((excerpt) => excerpt.raw_text || '').join('\n');
  const text = `${content}\n${evidenceText}`;
  const phraseTerms = highlightPhrases(content);
  const roleTerms = [...text.matchAll(ROLE_TERM_RE)].map((match) => match[0]);
  const objectTerms = [...text.matchAll(OBJECT_TERM_RE)].flatMap((match) => {
    const term = match[0];
    const tail = term.split(/编制|制定|提交|提供|接收|审核|复核|会签|批准|审批|签批|发放|归档|保存|移交|处理|确认|统计|分析/).pop();
    return tail && tail !== term ? [term, tail] : [term];
  });
  const actionTerms = ACTION_TERMS.filter((term) => text.includes(term));
  return uniqueTerms([...phraseTerms, ...roleTerms, ...objectTerms, ...actionTerms])
    .sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh-Hans-CN'))
    .slice(0, 32);
}

export function highlightEvidenceHtml(rawText, candidateContent, extraTerms = []) {
  const candidate = typeof candidateContent === 'object'
    ? candidateContent
    : { content: candidateContent, source_excerpts: [{ raw_text: rawText }] };
  const phrases = uniqueTerms([...highlightTermsForCandidate(candidate), ...extraTerms])
    .sort((left, right) => right.length - left.length);
  const escapedText = escapeHtml(rawText);
  const alternatives = phrases.map((phrase) => escapeRegExp(escapeHtml(phrase))).filter(Boolean);
  if (!alternatives.length) return escapedText;
  return escapedText.replace(new RegExp(alternatives.join('|'), 'g'), (match) => `<mark>${match}</mark>`);
}

export function reviewButtonPalette() {
  return {
    confirm_candidate: { background: '#1f7a4d', color: '#ffffff' },
    needs_correction: { background: '#9b5f00', color: '#ffffff' },
    reject_candidate: { background: '#a6352d', color: '#ffffff' },
    insufficient_evidence: { background: '#425f73', color: '#ffffff' },
    source_verified: { background: '#236b8e', color: '#ffffff' },
    need_original_review: { background: '#8a5a1e', color: '#ffffff' },
    add_evolution_rule: { background: '#6d4b87', color: '#ffffff' },
    add_test_case: { background: '#345d8c', color: '#ffffff' },
  };
}

export function makeCandidateReviewRepository(pool) {
  return {
    async initSchema() {
      for (const statement of splitSqlStatements(candidateReviewSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async upsertBundle(bundle) {
      await pool.execute(
        `INSERT INTO candidate_review_runs
          (run_id, candidate_run_path, candidate_count, embedding_status, embedding_model, mapping_diff_report)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          candidate_run_path=VALUES(candidate_run_path),
          candidate_count=VALUES(candidate_count),
          embedding_status=VALUES(embedding_status),
          embedding_model=VALUES(embedding_model),
          mapping_diff_report=VALUES(mapping_diff_report),
          updated_at=CURRENT_TIMESTAMP`,
        [
          bundle.run.run_id,
          bundle.run.candidate_run_path,
          bundle.run.candidate_count,
          bundle.run.embedding_status,
          bundle.run.embedding_model,
          bundle.run.mapping_diff_report,
        ],
      );

      const stableKeys = bundle.items.map((item) => item.stable_key).filter(Boolean);
      if (stableKeys.length) {
        await pool.execute(
          `DELETE FROM candidate_review_items
           WHERE run_id = ? AND stable_key NOT IN (${stableKeys.map(() => '?').join(', ')})`,
          [bundle.run.run_id, ...stableKeys],
        );
      } else {
        await pool.execute(
          'DELETE FROM candidate_review_items WHERE run_id = ?',
          [bundle.run.run_id],
        );
      }

      for (const item of bundle.items) {
        await pool.execute(
          `INSERT INTO candidate_review_items
            (run_id, stable_key, candidate_id, department, document_name, source_file, source_anchor, candidate_type,
             failure_class, content, mapping_location, suggested_action, owner, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            candidate_id=VALUES(candidate_id),
            department=VALUES(department),
            document_name=VALUES(document_name),
            source_file=VALUES(source_file),
            source_anchor=VALUES(source_anchor),
            candidate_type=VALUES(candidate_type),
            failure_class=VALUES(failure_class),
            content=VALUES(content),
            mapping_location=VALUES(mapping_location),
            suggested_action=VALUES(suggested_action),
            owner=VALUES(owner),
            display_order=VALUES(display_order),
            updated_at=CURRENT_TIMESTAMP`,
          [
            bundle.run.run_id,
            item.stable_key,
            item.id,
            item.department,
            item.document_name,
            item.source_file,
            item.source_anchor,
            item.candidate_type,
            item.failure_class,
            item.content,
            item.mapping_location,
            item.suggested_action,
            item.owner,
            item.display_order,
          ],
        );

        await pool.execute(
          'DELETE FROM candidate_review_excerpts WHERE run_id = ? AND stable_key = ?',
          [bundle.run.run_id, item.stable_key],
        );

        for (const excerpt of item.source_excerpts || []) {
          await pool.execute(
            `INSERT INTO candidate_review_excerpts
              (run_id, stable_key, chunk_id, source_anchor, raw_text, extraction_quality,
               evidence_status, verification_status, allowed_downstream_use, display_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              source_anchor=VALUES(source_anchor),
              raw_text=VALUES(raw_text),
              extraction_quality=VALUES(extraction_quality),
              evidence_status=VALUES(evidence_status),
              verification_status=VALUES(verification_status),
              allowed_downstream_use=VALUES(allowed_downstream_use),
              display_order=VALUES(display_order)`,
            [
              bundle.run.run_id,
              item.stable_key,
              excerpt.chunk_id,
              excerpt.source_anchor,
              excerpt.raw_text,
              excerpt.extraction_quality,
              excerpt.evidence_status,
              excerpt.verification_status,
              excerpt.allowed_downstream_use,
              excerpt.display_order,
            ],
          );
        }
      }
    },

    async listRuns() {
      const [rows] = await pool.execute(
        `SELECT run_id, candidate_count, embedding_status, embedding_model, imported_at, updated_at
         FROM candidate_review_runs
         ORDER BY updated_at DESC, imported_at DESC`,
      );
      return rows;
    },

    async getCandidates(runId) {
      const [items] = await pool.execute(
        `SELECT i.*, d.decision, d.evidence_status AS decision_evidence_status, d.next_action,
                d.failure_class AS decision_failure_class, d.issue_type, d.definition_status,
                d.normalized_note, d.reviewer, d.reviewed_at
         FROM candidate_review_items i
         LEFT JOIN candidate_review_decisions d
           ON d.run_id = i.run_id AND d.stable_key = i.stable_key
         WHERE i.run_id = ?
         ORDER BY i.display_order ASC, i.stable_key ASC`,
        [runId],
      );
      const [excerpts] = await pool.execute(
        `SELECT *
         FROM candidate_review_excerpts
         WHERE run_id = ?
         ORDER BY stable_key ASC, display_order ASC`,
        [runId],
      );
      const byKey = new Map();
      for (const excerpt of excerpts) {
        if (!byKey.has(excerpt.stable_key)) byKey.set(excerpt.stable_key, []);
        byKey.get(excerpt.stable_key).push(excerpt);
      }
      return items.map((item) => ({
        ...item,
        source_excerpts: byKey.get(item.stable_key) || [],
      }));
    },

    async saveDecision(decision) {
      await pool.execute(
        `INSERT INTO candidate_review_decisions
          (run_id, stable_key, decision, evidence_status, next_action, failure_class,
           issue_type, definition_status, normalized_note, reviewer, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          decision=VALUES(decision),
          evidence_status=VALUES(evidence_status),
          next_action=VALUES(next_action),
          failure_class=VALUES(failure_class),
          issue_type=VALUES(issue_type),
          definition_status=VALUES(definition_status),
          normalized_note=VALUES(normalized_note),
          reviewer=VALUES(reviewer),
          reviewed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP`,
        [
          decision.run_id,
          decision.stable_key,
          decision.decision,
          decision.evidence_status,
          decision.next_action,
          decision.failure_class,
          decision.issue_type || '',
          decision.definition_status || '',
          decision.normalized_note || '',
          decision.reviewer || '',
        ],
      );
    },
  };
}

export function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function createMysqlPoolFromEnv() {
  const mysql = await import('mysql2/promise');
  const database = process.env.MYSQL_DATABASE || process.env.CANDIDATE_REVIEW_DB || 'infomat_candidate_review';
  return mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    charset: 'utf8mb4',
    multipleStatements: false,
  });
}

export function buildReviewAppHtml() {
  const palette = reviewButtonPalette();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>候选映射复核工作台</title>
  <style>
    :root {
      --paper: #f6efe2;
      --surface: #fffaf2;
      --line: #d8c6ac;
      --ink: #283238;
      --muted: #665d52;
      --focus: #265c7e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      letter-spacing: 0;
    }
    button, textarea, select { font: inherit; }
    .layout { display: grid; grid-template-columns: 330px 1fr; min-height: 100vh; }
    aside { padding: 18px; border-right: 1px solid var(--line); background: #eadcc8; }
    main { padding: 20px; min-width: 0; }
    h1 { margin: 0 0 8px; font-size: 22px; color: #493426; }
    .small { color: var(--muted); font-size: 13px; line-height: 1.55; }
    .toolbar, .filters { display: grid; gap: 8px; margin: 12px 0; }
    select, input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: #fffdf8;
      color: var(--ink);
      border-radius: 7px;
      padding: 9px 10px;
    }
    .candidate-list { display: grid; gap: 8px; margin-top: 12px; }
    .candidate-tab {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 8px;
      padding: 10px;
      text-align: left;
      cursor: pointer;
    }
    .candidate-tab.active { border-color: var(--focus); box-shadow: inset 4px 0 0 var(--focus); }
    .candidate-tab.done { background: #ebf3ea; }
    .group-heading { margin: 12px 0 4px; color: #493426; font-size: 12px; font-weight: 800; line-height: 1.45; }
    .card {
      max-width: 1120px;
      border: 1px solid var(--line);
      background: #fffdf8;
      border-radius: 8px;
      overflow: hidden;
    }
    .card-head { padding: 18px 20px; background: #fff3df; border-bottom: 1px solid var(--line); }
    .card-head h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.35; }
    .card-body { padding: 18px 20px 22px; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .fact { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 10px; }
    .fact label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .evidence { border: 2px solid #b58d4a; background: #fff8e8; border-radius: 8px; padding: 12px; margin-bottom: 18px; }
    .evidence h3, .question h3 { margin: 0 0 8px; font-size: 15px; }
    .excerpt { border-top: 1px solid #e2cfae; padding-top: 10px; margin-top: 10px; }
    .excerpt:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
    .excerpt-meta { color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    .excerpt-text { line-height: 1.75; white-space: pre-wrap; font-size: 14px; }
    mark { background: #ffe066; color: #241a00; padding: 0 2px; border-radius: 2px; }
    .question { margin: 16px 0; }
    .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .choice {
      border: 2px solid transparent;
      border-radius: 8px;
      min-height: 44px;
      padding: 9px 11px;
      color: #fff;
      cursor: pointer;
      text-align: left;
      font-weight: 700;
    }
    .choice[data-action="confirm_candidate"] { background: ${palette.confirm_candidate.background}; color: ${palette.confirm_candidate.color}; }
    .choice[data-action="needs_correction"] { background: ${palette.needs_correction.background}; color: ${palette.needs_correction.color}; }
    .choice[data-action="reject_candidate"] { background: ${palette.reject_candidate.background}; color: ${palette.reject_candidate.color}; }
    .choice[data-action="insufficient_evidence"] { background: ${palette.insufficient_evidence.background}; color: ${palette.insufficient_evidence.color}; }
    .choice.selected { outline: 3px solid #111; outline-offset: 2px; }
    .secondary-choice { background: #fffdf8; color: var(--ink); border: 2px solid var(--line); }
    .secondary-choice.selected { border-color: var(--focus); box-shadow: inset 4px 0 0 var(--focus); }
    .structured-review { border-top: 1px solid var(--line); padding-top: 14px; }
    .structured-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .structured-grid label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .structured-grid textarea { min-height: 86px; resize: vertical; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
    .save { background: #7f2f28; color: #fff; border: 0; border-radius: 7px; min-height: 38px; padding: 0 14px; cursor: pointer; }
    .ghost { background: #fffdf8; color: var(--ink); border: 1px solid var(--line); border-radius: 7px; min-height: 38px; padding: 0 14px; cursor: pointer; }
    .boundary { max-width: 1120px; margin-bottom: 12px; color: #6a451e; line-height: 1.6; font-size: 13px; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .facts, .options { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside>
      <h1>候选映射复核</h1>
      <div class="small">服务读取 MySQL，选择结果直接保存到数据库。</div>
      <div class="toolbar">
        <select id="runSelect"></select>
      </div>
      <div class="filters">
        <input id="searchInput" placeholder="搜索候选、来源或原文">
        <select id="stateFilter">
          <option value="">全部状态</option>
          <option value="pending">未复核</option>
          <option value="done">已复核</option>
        </select>
      </div>
      <div class="small" id="progressText"></div>
      <div class="candidate-list" id="candidateList"></div>
    </aside>
    <main>
      <div class="boundary">候选结果只用于人工复核、技能演进和待办判断；正式映射仍需逐条回源核验，不从本页自动写入 docs/norms、PMO 页面或 MDM 接口。</div>
      <section class="card" id="card"></section>
    </main>
  </div>
  <script>
    let runs = [];
    let candidates = [];
    let activeKey = '';
    const state = { runId: '', filter: '', stateFilter: '' };

    const decisionOptions = [
      ['confirm_candidate', '这条说法成立'],
      ['needs_correction', '大方向对，但文字要改'],
      ['reject_candidate', '这条不对'],
      ['insufficient_evidence', '只看这段原文还判断不了']
    ];
    const evidenceOptions = [
      ['source_verified', '能，看这段原文就够了'],
      ['need_original_review', '还要看原文件或图片'],
      ['source_mismatch', '原文和说法对不上'],
      ['not_reviewed', '还没看完']
    ];
    const issueOptions = [
      ['none', '无明显问题'],
      ['role_definition_insufficient', '角色定义不足'],
      ['role_mismatch', '角色或部门不匹配'],
      ['behavior_boundary', '业务行为边界不清'],
      ['source_mismatch', '原文不支撑候选'],
      ['missing_delivery', '交付物或归档不清'],
      ['other', '其他问题']
    ];
    const definitionOptions = [
      ['source_defined', '原文明确'],
      ['source_definition_insufficient', '原文定义不足'],
      ['needs_original_review', '需回源确认']
    ];

    async function api(path, options) {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...options
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    async function loadRuns() {
      runs = await api('/api/runs');
      const select = document.getElementById('runSelect');
      select.innerHTML = runs.map((run) => '<option value="' + escAttr(run.run_id) + '">' + esc(run.run_id) + ' (' + run.candidate_count + ')</option>').join('');
      state.runId = runs[0]?.run_id || '';
      if (state.runId) await loadCandidates();
    }

    async function loadCandidates() {
      candidates = await api('/api/runs/' + encodeURIComponent(state.runId) + '/candidates');
      activeKey = candidates[0]?.stable_key || '';
      render();
    }

    function filtered() {
      const needle = state.filter.trim().toLowerCase();
      return candidates.filter((candidate) => {
        const done = Boolean(candidate.decision);
        if (state.stateFilter === 'done' && !done) return false;
        if (state.stateFilter === 'pending' && done) return false;
        if (!needle) return true;
        return [candidate.stable_key, candidate.content, candidate.source_file, candidate.source_anchor, ...(candidate.source_excerpts || []).map((x) => x.raw_text)]
          .join('\\n').toLowerCase().includes(needle);
      });
    }

    function render() {
      const rows = filtered();
      if (!rows.some((row) => row.stable_key === activeKey)) activeKey = rows[0]?.stable_key || '';
      const done = candidates.filter((candidate) => candidate.decision).length;
      document.getElementById('progressText').textContent = '已复核 ' + done + ' / ' + candidates.length;
      let lastGroup = '';
      document.getElementById('candidateList').innerHTML = rows.map((candidate) => {
        const cls = 'candidate-tab' + (candidate.stable_key === activeKey ? ' active' : '') + (candidate.decision ? ' done' : '');
        const group = [candidate.department || '未标注部门', candidate.document_name || documentName(candidate.source_file), candidate.candidate_type || '其他候选'].join(' / ');
        const heading = group === lastGroup ? '' : '<div class="group-heading">' + esc(group) + '</div>';
        lastGroup = group;
        return heading + '<button class="' + cls + '" data-key="' + escAttr(candidate.stable_key) + '"><strong>' + esc(candidate.candidate_type) + '</strong><br><span>' + esc(candidate.stable_key) + '</span><br><span>' + esc(shorten(candidate.content, 72)) + '</span></button>';
      }).join('');
      document.querySelectorAll('.candidate-tab').forEach((button) => {
        button.addEventListener('click', () => { activeKey = button.dataset.key; render(); });
      });
      renderCard();
    }

    function renderCard() {
      const candidate = candidates.find((item) => item.stable_key === activeKey);
      const card = document.getElementById('card');
      if (!candidate) {
        card.innerHTML = '<div class="card-body">没有可复核候选。先运行导入脚本写入 MySQL。</div>';
        return;
      }
      card.innerHTML = '<div class="card-head"><h2>' + esc(candidate.content) + '</h2><div class="small">' + esc(candidate.candidate_type) + ' · ' + esc(candidate.failure_class) + '</div></div>' +
        '<div class="card-body">' +
        '<div class="facts">' +
        fact('部门', candidate.department || '未标注部门') +
        fact('文档名称', candidate.document_name || documentName(candidate.source_file)) +
        fact('来源', formatSource(candidate.source_file, candidate.source_anchor)) +
        fact('现有映射说明', describeMapping(candidate.mapping_location)) +
        fact('建议确认方式', describeSuggestedAction(candidate.suggested_action)) +
        fact('建议确认对象', describeOwner(candidate.owner)) +
        '</div>' +
        evidenceBlock(candidate) +
        question('这条候选说法是否成立', 'decision', decisionOptions, candidate.decision || '') +
        question('原文能不能支撑这条说法', 'evidence_status', evidenceOptions, candidate.decision_evidence_status || 'not_reviewed') +
        structuredReviewFields(candidate) +
        '<div class="actions"><button class="save" id="saveBtn">保存到 MySQL</button><button class="ghost" id="reloadBtn">重新读取</button></div>' +
        '</div>';
      bindCard(candidate);
    }

    function fact(label, value) {
      return '<div class="fact"><label>' + esc(label) + '</label><div>' + esc(value || '') + '</div></div>';
    }

    function evidenceBlock(candidate) {
      const excerpts = candidate.source_excerpts || [];
      if (!excerpts.length) {
        return '<div class="evidence"><h3>原文摘录</h3><div class="small">未匹配到原文摘录，请按来源文件和锚点回源后再判断。</div></div>';
      }
      return '<div class="evidence"><h3>原文摘录</h3>' + excerpts.map((excerpt) => {
        return '<div class="excerpt"><div class="excerpt-meta">' + esc(formatSource('', excerpt.source_anchor)) + '</div><div class="excerpt-text">' +
          highlight(excerpt.raw_text || '', candidate.content) + '</div></div>';
      }).join('') + '</div>';
    }

    function question(title, field, options, selected) {
      return '<div class="question"><h3>' + esc(title) + '</h3><div class="options">' + options.map(([value, label]) => {
        const primary = field === 'decision';
        const cls = primary ? 'choice' : 'choice secondary-choice';
        return '<button class="' + cls + (value === selected ? ' selected' : '') + '" data-field="' + escAttr(field) + '" data-value="' + escAttr(value) + '" data-action="' + escAttr(value) + '">' + esc(label) + '</button>';
      }).join('') + '</div></div>';
    }

    function structuredReviewFields(candidate) {
      return '<div class="question structured-review"><h3>结构化复核记录</h3>' +
        '<div class="structured-grid">' +
        '<div><label for="issueType">问题类型</label><select id="issueType">' + issueOptions.map(([value, label]) => option(value, label, candidate.issue_type || 'none')).join('') + '</select></div>' +
        '<div><label for="definitionStatus">定义充分性</label><select id="definitionStatus">' + definitionOptions.map(([value, label]) => option(value, label, candidate.definition_status || inferDefinitionStatus(candidate))).join('') + '</select></div>' +
        '<div style="grid-column: 1 / -1;"><label for="normalizedNote">规范化说明</label><textarea id="normalizedNote" placeholder="按原文口径记录需要保留、修正或回源确认的说明。">' + esc(candidate.normalized_note || '') + '</textarea></div>' +
        '</div></div>';
    }

    function option(value, label, selected) {
      return '<option value="' + escAttr(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }

    function bindCard(candidate) {
      document.querySelectorAll('[data-field][data-value]').forEach((button) => {
        button.addEventListener('click', () => {
          candidate[button.dataset.field] = button.dataset.value;
          if (button.dataset.field === 'evidence_status') candidate.decision_evidence_status = button.dataset.value;
          if (button.dataset.field === 'failure_class') candidate.decision_failure_class = button.dataset.value;
          renderCard();
        });
      });
      document.getElementById('issueType').addEventListener('change', (event) => {
        candidate.issue_type = event.target.value;
      });
      document.getElementById('definitionStatus').addEventListener('change', (event) => {
        candidate.definition_status = event.target.value;
      });
      document.getElementById('normalizedNote').addEventListener('input', (event) => {
        candidate.normalized_note = event.target.value;
      });
      document.getElementById('saveBtn').addEventListener('click', async () => {
        await api('/api/runs/' + encodeURIComponent(state.runId) + '/candidates/' + encodeURIComponent(candidate.stable_key) + '/review', {
          method: 'PUT',
          body: JSON.stringify({
            decision: candidate.decision || '',
            evidence_status: candidate.decision_evidence_status || 'not_reviewed',
            next_action: inferNextAction(candidate),
            failure_class: candidate.decision_failure_class || candidate.failure_class || '',
            issue_type: document.getElementById('issueType').value,
            definition_status: document.getElementById('definitionStatus').value,
            normalized_note: document.getElementById('normalizedNote').value,
            reviewer: 'web'
          })
        });
        await loadCandidates();
      });
      document.getElementById('reloadBtn').addEventListener('click', loadCandidates);
    }

    function highlight(raw, content) {
      let html = esc(raw);
      const text = String(raw || '') + '\\n' + String(content || '');
      const actionTerms = ['编制', '制定', '提交', '提供', '接收', '审核', '复核', '会签', '批准', '审批', '签批', '发放', '归档', '保存', '移交', '处理', '确认', '统计', '分析'].filter((term) => text.includes(term));
      const roleTerms = [...text.matchAll(/[\\u4e00-\\u9fff]{2,20}(?:办公室|负责人|责任人|审核人|批准人|编制人|申请人|管理员|成本会计|设计人员|定额员|检验员|工程师|技术员|副总|部长|主任|经理|车间|部门|部)/g)].map((match) => match[0]);
      const objectTerms = [...text.matchAll(/[\\u4e00-\\u9fff]{2,28}(?:报表|文件|记录|清单|申请|表单|资料|方案|计划|报告|台账|数据|结果|交付物|说明|通知|凭证|单据)/g)].map((match) => match[0]);
      const phrases = [...new Set([...String(content || '').split(/[→；;，,。\\s、/]+/).map((x) => x.trim()).filter((x) => x.length >= 3), ...roleTerms, ...objectTerms, ...actionTerms])]
        .sort((a, b) => b.length - a.length).slice(0, 18);
      for (const phrase of phrases) {
        html = html.split(esc(phrase)).join('<mark>' + esc(phrase) + '</mark>');
      }
      return html;
    }

    function formatSource(sourceFile, sourceAnchor) {
      const parts = [];
      const fileName = String(sourceFile || '').replace(/\\\\/g, '/').split('/').filter(Boolean).pop();
      if (fileName) parts.push(fileName);
      const clause = String(sourceAnchor || '').match(/§\\s*([0-9]+(?:\\.[0-9]+)*)/)?.[1] || '';
      const page = String(sourceAnchor || '').match(/\\bpage\\s*=?\\s*(\\d+)\\b/i)?.[1] || String(sourceAnchor || '').match(/第?(\\d+)页/)?.[1] || '';
      const paragraph = String(sourceAnchor || '').match(/\\bP(\\d+)\\b/i)?.[1] || '';
      const table = String(sourceAnchor || '').match(/\\bT(\\d+)\\b/i)?.[1] || '';
      if (clause) parts.push('第' + clause + '条');
      if (page) parts.push('第' + page + '页');
      if (table) parts.push('表' + table);
      if (paragraph && !clause && !page && !table) parts.push('原文位置待核对');
      return parts.join(' · ') || humanizeAnchor(sourceAnchor) || '来源未标注';
    }

    function humanizeAnchor(sourceAnchor) {
      return String(sourceAnchor || '')
        .replace(/§\\s*([0-9]+(?:\\.[0-9]+)*)/g, '第$1条')
        .replace(/\\bpage\\s*=?\\s*(\\d+)\\b/gi, '第$1页')
        .replace(/第?(\\d+)页/g, '第$1页')
        .replace(/\\bP(\\d+)\\b/gi, '原文位置待核对')
        .replace(/\\bT(\\d+)\\b/gi, '表$1')
        .trim();
    }

    function documentName(sourceFile) {
      return String(sourceFile || '').replace(/\\\\/g, '/').split('/').filter(Boolean).pop() || '来源未标注文档';
    }

    function inferDefinitionStatus(candidate) {
      if (candidate.definition_status) return candidate.definition_status;
      if (candidate.issue_type === 'role_definition_insufficient') return 'source_definition_insufficient';
      return 'needs_original_review';
    }

    function describeMapping(mappingLocation) {
      const value = String(mappingLocation || '').trim();
      if (!value || value === '未标注') return '暂未找到对应的现有映射记录，需要确认这条说法是否应该补入正式映射。';
      if (value.includes('当前正式映射未见')) return '目前没有在正式映射表里看到能直接覆盖这条说法的记录，需要确认是否要补入。';
      if (/^[A-Z]{2,}(?:-[A-Z0-9]+)+$/i.test(value)) return '目前只看到现有映射编号 ' + value + '，还需要对照正式流程表确认它是否已经覆盖这条说法。';
      return value;
    }

    function describeSuggestedAction(actionText) {
      const value = String(actionText || '').trim();
      if (!value) return '请对照原文判断这条说法是否成立。';
      if (value.includes('不得直接写入')) return '请先对照原文确认；确认前不会写入正式映射。';
      if (value.includes('确认对象链')) return '请确认这条描述是不是业务上真实发生的一组动作。';
      if (value.includes('受控交接')) return '请确认这里是否真的存在部门之间的资料或责任交接。';
      return value;
    }

    function describeOwner(ownerText) {
      const value = String(ownerText || '').trim();
      if (!value) return '熟悉这项业务的部门人员';
      return value
        .replaceAll('制度责任部门/流程治理负责人', '制度责任部门或流程治理负责人')
        .replaceAll('输入/接收双方部门确认人', '资料提供方和接收方的业务确认人');
    }

    function inferNextAction(candidate) {
      if (candidate.next_action) return candidate.next_action;
      if (candidate.decision === 'confirm_candidate' && candidate.decision_evidence_status === 'source_verified') return 'prepare_formal_update';
      if (candidate.decision === 'reject_candidate') return 'ignore';
      return 'keep_todo';
    }

    function shorten(value, max) {
      const text = String(value || '').replace(/\\s+/g, ' ').trim();
      return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function escAttr(value) { return esc(value).replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;'); }

    document.getElementById('runSelect').addEventListener('change', async (event) => {
      state.runId = event.target.value;
      await loadCandidates();
    });
    document.getElementById('searchInput').addEventListener('input', (event) => {
      state.filter = event.target.value;
      render();
    });
    document.getElementById('stateFilter').addEventListener('change', (event) => {
      state.stateFilter = event.target.value;
      render();
    });
    loadRuns().catch((error) => {
      document.getElementById('card').innerHTML = '<div class="card-body">服务读取失败：' + esc(error.message) + '</div>';
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
