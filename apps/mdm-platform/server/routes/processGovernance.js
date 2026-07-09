const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const router = express.Router();
const db = require('../db');
const {
  requireAuth,
  getUserEffectivePermissions,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getUserByIdAsync,
  getDepartmentByIdAsync
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const {
  loadReviewRunBundle: loadProcessReviewRunBundle,
  makeProcessInputBaselineReviewRepository,
  normalizeReviewPayload
} = require('../processInputBaselineReviewRepository');
const { makeProcessGovernanceMysqlRepository } = require('../processGovernanceMysqlRepository');
const {
  QUEUE_DEFINITIONS,
  makeProcessGovernanceIssuePoolRepository
} = require('../processGovernanceIssuePoolRepository');
const SOURCE_FILE_COVERAGE_LIMIT = 20;
const REPO_ROOT = path.resolve(__dirname, '../../../..');
let inputBaselineReviewRepoPromise = null;
let inputBaselineReviewRepositoryFactory = null;
let processGovernanceRepoPromise = null;
let processGovernanceRepositoryFactory = null;
let issuePoolRepoPromise = null;
let issuePoolRepositoryFactory = null;

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  }
}

function runAsyncAction(res, action) {
  return action().catch(error => {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function knownStatusError(res, error) {
  if (error && error.statusCode) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

async function closeGateOrSend(res, repo, scope, item, payload) {
  try {
    return await repo.assertLatestImportResolved(scope, item, payload);
  } catch (error) {
    if (knownStatusError(res, error)) return null;
    throw error;
  }
}

async function inputBaselineReviewRepository() {
  if (inputBaselineReviewRepositoryFactory) {
    return await inputBaselineReviewRepositoryFactory();
  }
  if (!useInputBaselineReviewMysqlStore()) {
    throw new Error('Process input baseline review MySQL store is disabled');
  }
  if (!inputBaselineReviewRepoPromise) {
    inputBaselineReviewRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeProcessInputBaselineReviewRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await inputBaselineReviewRepoPromise;
  } catch (error) {
    inputBaselineReviewRepoPromise = null;
    throw error;
  }
}

function setInputBaselineReviewRepositoryFactory(factory) {
  inputBaselineReviewRepositoryFactory = factory;
  inputBaselineReviewRepoPromise = null;
}

function resetInputBaselineReviewRepositoryFactory() {
  inputBaselineReviewRepositoryFactory = null;
  inputBaselineReviewRepoPromise = null;
}

function useInputBaselineReviewMysqlStore() {
  const mode = String(process.env.PROCESS_CANDIDATE_REVIEW_STORE || 'mysql').trim().toLowerCase();
  return !['artifact', 'none', 'off', 'false', '0'].includes(mode);
}

function useMysqlProcessGovernanceReadModel() {
  return String(process.env.PROCESS_GOVERNANCE_READ_MODEL || '').toLowerCase() === 'mysql';
}

async function processGovernanceRepository() {
  if (processGovernanceRepositoryFactory) {
    return await processGovernanceRepositoryFactory();
  }
  if (!processGovernanceRepoPromise) {
    processGovernanceRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeProcessGovernanceMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await processGovernanceRepoPromise;
  } catch (error) {
    processGovernanceRepoPromise = null;
    throw error;
  }
}

async function processGovernanceRepositoryOrSendUnavailable(res) {
  try {
    return await processGovernanceRepository();
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: '流程治理 MySQL 读模型不可用' });
    return null;
  }
}

function setProcessGovernanceRepositoryFactory(factory) {
  processGovernanceRepositoryFactory = factory;
  processGovernanceRepoPromise = null;
}

function resetProcessGovernanceRepositoryFactory() {
  processGovernanceRepositoryFactory = null;
  processGovernanceRepoPromise = null;
}

async function issuePoolRepository() {
  if (issuePoolRepositoryFactory) {
    return await issuePoolRepositoryFactory();
  }
  if (!issuePoolRepoPromise) {
    issuePoolRepoPromise = (async () => {
      if (!useMysqlProcessGovernanceReadModel()) {
        throw new Error('Process governance issue pool requires PROCESS_GOVERNANCE_READ_MODEL=mysql');
      }
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeProcessGovernanceIssuePoolRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await issuePoolRepoPromise;
  } catch (error) {
    issuePoolRepoPromise = null;
    throw error;
  }
}

async function issuePoolRepositoryOrSendUnavailable(res) {
  try {
    return await issuePoolRepository();
  } catch (error) {
    console.error(error);
    res.status(503).json({ error: '流程治理问题池不可用' });
    return null;
  }
}

function setIssuePoolRepositoryFactory(factory) {
  issuePoolRepositoryFactory = factory;
  issuePoolRepoPromise = null;
}

function resetIssuePoolRepositoryFactory() {
  issuePoolRepositoryFactory = null;
  issuePoolRepoPromise = null;
}

async function inputBaselineReviewRepositoryOrNull() {
  if (!inputBaselineReviewRepositoryFactory && !useInputBaselineReviewMysqlStore()) return null;
  try {
    return await inputBaselineReviewRepository();
  } catch (error) {
    if (process.env.MDM_DB_QUIET !== '1') {
      console.warn(`input baseline review MySQL unavailable: ${error.message}`);
    }
    return null;
  }
}

function activeSnapshot() {
  return db.prepare(`
    SELECT *
    FROM process_governance_snapshots
    WHERE status='active'
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get();
}

function snapshotStats(snapshot) {
  if (!snapshot) return {};
  try {
    return JSON.parse(snapshot.stats_json || '{}');
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function reviewArtifactsRoot() {
  return process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR
    ? path.resolve(process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR)
    : path.join(REPO_ROOT, 'artifacts', 'process-input-baseline-review');
}

function safeRunId(value) {
  const runId = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(runId) ? runId : '';
}

function reviewRunDir(runId) {
  const safeId = safeRunId(runId);
  return safeId ? path.join(reviewArtifactsRoot(), safeId) : '';
}

function documentNameFromSource(sourceFile) {
  return String(sourceFile || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '来源未标注文档';
}

function parseReviewItemAnchor(anchor) {
  const text = String(anchor || '');
  return {
    clause: text.match(/§\s*([0-9]+(?:\.[0-9]+)*)/)?.[1] || '',
    page: text.match(/\bpage\s*=?\s*(\d+)\b/i)?.[1] || text.match(/第?(\d+)页/)?.[1] || '',
    paragraph_id: text.match(/\bP(\d+)\b/i)?.[1] ? `P${text.match(/\bP(\d+)\b/i)[1]}` : '',
    table_id: text.match(/\b(T\d+)\b/i)?.[1] || ''
  };
}

function formatReviewItemSource(sourceFile, sourceAnchor) {
  const parts = [];
  const fileName = sourceFile ? documentNameFromSource(sourceFile) : '';
  if (fileName) parts.push(fileName);
  const anchor = parseReviewItemAnchor(sourceAnchor);
  if (anchor.clause) parts.push(`第${anchor.clause}条`);
  if (anchor.page) parts.push(`第${anchor.page}页`);
  if (anchor.table_id) parts.push(anchor.table_id.replace(/^T/i, '表'));
  if (anchor.paragraph_id && !anchor.clause && !anchor.page && !anchor.table_id) {
    parts.push('原文位置待核对');
  }
  return parts.join(' · ') || String(sourceAnchor || '').replace(/\bP(\d+)\b/gi, '原文位置待核对') || '来源未标注';
}

function reviewSourceMatches(reviewItem, chunk) {
  const reviewFile = String(reviewItem.source_file || '').replace(/\\/g, '/');
  const chunkFile = String(chunk.source_file || '').replace(/\\/g, '/');
  return !reviewFile || !chunkFile || reviewFile === chunkFile || reviewFile.endsWith(chunkFile) || chunkFile.endsWith(reviewFile);
}

function reviewExcerptScore(reviewItem, anchor, chunk) {
  if (!reviewSourceMatches(reviewItem, chunk)) return -1;
  let score = 0;
  if (anchor.clause && chunk.clause === anchor.clause) score += 10;
  if (anchor.paragraph_id && chunk.paragraph_id === anchor.paragraph_id) score += 10;
  const text = `${chunk.raw_text || ''}\n${chunk.normalized_text || ''}`;
  String(reviewItem.content || '')
    .split(/[→；;，,。\s、/]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3)
    .forEach(part => {
      if (text.includes(part)) score += part.length >= 8 ? 8 : 3;
    });
  return score;
}

function loadReviewRunBundle(runId) {
  const safeId = safeRunId(runId);
  if (!safeId) return null;
  const runDir = path.join(reviewArtifactsRoot(), safeId);
  const itemsPath = path.join(runDir, 'mapping_diff_items.json');
  if (!fs.existsSync(itemsPath)) return null;
  const reviewItems = readJsonFile(itemsPath, []);
  const chunks = readJsonlFile(path.join(runDir, 'chunks.jsonl'));
  const embedding = readJsonFile(path.join(runDir, 'embedding_manifest.json'), {});
  const items = reviewItems.map((reviewItem, index) => {
    const anchor = parseReviewItemAnchor(reviewItem.source_anchor);
    const sourceExcerpts = chunks
      .map(chunk => ({ chunk, score: reviewExcerptScore(reviewItem, anchor, chunk) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(({ chunk }, excerptIndex) => ({
        chunk_id: chunk.chunk_id || `excerpt-${excerptIndex + 1}`,
        source_anchor: [chunk.doc_no, chunk.clause ? `§${chunk.clause}` : '', chunk.page ? `page=${chunk.page}` : '', chunk.paragraph_id].filter(Boolean).join(' '),
        source_label: formatReviewItemSource('', [chunk.doc_no, chunk.clause ? `§${chunk.clause}` : '', chunk.page ? `page=${chunk.page}` : '', chunk.paragraph_id].filter(Boolean).join(' ')),
        raw_text: chunk.raw_text || '',
        evidence_status: chunk.evidence_status || 'needs_review',
        verification_status: chunk.verification_status || 'unverified',
        allowed_downstream_use: chunk.allowed_downstream_use || 'review_only'
      }));
    return {
      ...reviewItem,
      stable_key: reviewItem.stable_key || reviewItem.id || `review-item-${index + 1}`,
      document_name: reviewItem.document_name || documentNameFromSource(reviewItem.source_file),
      source_label: formatReviewItemSource(reviewItem.source_file, reviewItem.source_anchor),
      source_excerpts: sourceExcerpts
    };
  });
  return {
    run: {
      run_id: safeId,
      issue_count: items.length,
      embedding_status: embedding.status || 'missing',
      embedding_model: embedding.model || ''
    },
    items
  };
}

function groupInputBaselineReviewItems(items) {
  const byDepartment = new Map();
  for (const item of items) {
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
  return [...byDepartment.entries()].map(([department, documents]) => ({
    department,
    documents: [...documents.entries()].map(([document_name, types]) => ({
      document_name,
      types: [...types.entries()].map(([issue_type, reviewItems]) => ({ issue_type, reviewItems }))
    }))
  }));
}

function filterInputBaselineReviewItems(items, filters) {
  return (items || []).filter(item => {
    if (filters.dept && item.department !== String(filters.dept)) return false;
    if (filters.document && item.document_name !== String(filters.document)) return false;
    if (filters.type && item.issue_type !== String(filters.type)) return false;
    return true;
  });
}

function inputBaselineReviewPayloadFromBundle(bundle, filters) {
  const items = filterInputBaselineReviewItems(bundle.items, filters);
  return {
    run: bundle.run,
    summary: { total: items.length },
    groups: groupInputBaselineReviewItems(items),
    items
  };
}

function listReviewRuns() {
  const root = reviewArtifactsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadReviewRunBundle(entry.name))
    .filter(Boolean)
    .map(bundle => bundle.run)
    .sort((left, right) => right.run_id.localeCompare(left.run_id));
}

async function scopedReviewRunForDepartment(run, departmentName, repo) {
  if (!departmentName || !run || !run.run_id) return run;
  let count = 0;
  if (repo && typeof repo.getReviewItems === 'function') {
    try {
      const stored = await repo.getReviewItems(run.run_id, { dept: departmentName });
      count = Number(stored && stored.summary && stored.summary.total || 0);
    } catch (error) {
      count = 0;
    }
  }
  if (count === 0) {
    const bundle = loadReviewRunBundle(run.run_id);
    if (bundle && Array.isArray(bundle.items)) {
      count = filterInputBaselineReviewItems(bundle.items, { dept: departmentName }).length;
    }
  }
  if (count <= 0) return null;
  return { ...run, issue_count: count };
}

function emptySankey() {
  return {
    nodes: [],
    links: [],
    systems: [],
    stats: {},
    crossDept: { stats: {}, risks: [], interactionChains: [], source: null }
  };
}

function publishedDesignSankeyParts() {
  const versions = db.prepare(`
    SELECT v.id AS version_id, v.l1_name, v.l2_name, v.l3_name, d.department_id, dept.name AS department_name
    FROM process_design_versions v
    JOIN process_design_drafts d ON d.id=v.draft_id
    LEFT JOIN departments dept ON dept.id=v.department_id
    WHERE v.status='published'
    ORDER BY v.id
  `).all();
  const steps = db.prepare(`
    SELECT s.id, s.step_name, s.a1_code, s.sort_order, v.id AS version_id
    FROM process_design_steps s
    JOIN process_design_versions v ON v.draft_id=s.draft_id
    WHERE v.status='published'
    ORDER BY v.id, s.sort_order, s.id
  `).all();
  const stepByVersion = new Map();
  steps.forEach(step => {
    if (!stepByVersion.has(step.version_id)) stepByVersion.set(step.version_id, []);
    stepByVersion.get(step.version_id).push(step);
  });

  const nodeByName = new Map();
  const links = [];
  function addNode(name, label, nodeType, deptName, parentKey) {
    if (!name || nodeByName.has(name)) return;
    nodeByName.set(name, {
      name,
      label: label || name,
      node_type: nodeType,
      domain_name: null,
      dept_name: deptName || null,
      parent_key: parentKey || null,
      source_file: 'process_design_versions'
    });
  }
  function addLink(source, target) {
    if (source && target) links.push({ source, target, value: 1 });
  }

  versions.forEach(version => {
    const deptName = version.department_name || '未绑定部门';
    const l1Key = `process-design:${version.version_id}:l1`;
    const l2Key = `process-design:${version.version_id}:l2`;
    const l3Key = `process-design:${version.version_id}:l3`;
    addNode(deptName, deptName, 'department', deptName);
    addNode(l1Key, version.l1_name, 'l2', deptName, deptName);
    addNode(l2Key, version.l2_name, 'l2', deptName, l1Key);
    addNode(l3Key, version.l3_name, 'l3', deptName, l2Key);
    addLink(deptName, l1Key);
    addLink(l1Key, l2Key);
    addLink(l2Key, l3Key);
    (stepByVersion.get(version.version_id) || []).forEach(step => {
      const stepKey = `process-design:${version.version_id}:step:${step.id}`;
      addNode(stepKey, step.step_name, 'a1', deptName, l3Key);
      addLink(l3Key, stepKey);
    });
  });
  return { nodes: Array.from(nodeByName.values()), links };
}

function emptyQualitySummary() {
  return { BLOCK: 0, WARN: 0, INFO: 0 };
}

function qualitySummary(snapshotId) {
  const summary = emptyQualitySummary();
  if (!snapshotId) return summary;
  const rows = db.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM process_governance_quality_findings
    WHERE snapshot_id=?
    GROUP BY severity
  `).all(snapshotId);
  rows.forEach(row => {
    if (Object.prototype.hasOwnProperty.call(summary, row.severity)) {
      summary[row.severity] = row.count;
    }
  });
  return summary;
}

const QUALITY_CASE_STATUSES = new Set(['open', 'assigned', 'rectifying', 'submitted', 'source_resolved', 'closed', 'reopened']);
const USER_SET_STATUSES = new Set(['open', 'assigned', 'rectifying', 'submitted', 'reopened']);
const QUALITY_CASE_PRIORITIES = new Set(['high', 'medium', 'low']);
const MAPPING_RECORD_STATUSES = new Set(['active', 'source_missing', 'published', 'archived']);
const MAPPING_TODO_TYPES = new Set(['dept_confirm', 'verification', 'adjustment', 'cross_dept', 'evidence']);
const MAPPING_TODO_STATUSES = new Set(['open', 'assigned', 'rectifying', 'submitted', 'source_resolved', 'closed', 'reopened', 'accepted']);
const USER_SET_MAPPING_TODO_STATUSES = new Set(['open', 'assigned', 'rectifying', 'submitted', 'reopened']);
const PROCESS_GOVERNANCE_GLOBAL_ROLES = ['admin', 'decision_group', 'it_lead'];
const DEPARTMENT_CONFIRM_ROLES = ['project_lead', 'workgroup_lead', 'business_contact', 'data_quality', 'submitter', 'owner', 'reviewer'];

function getCurrentRoleCodes(req) {
  if (!req.session || !req.session.userId) return [];
  const rows = db.prepare(`
    SELECT r.role_code AS code
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id=?
  `).all(req.session.userId);
  const codes = new Set(rows.map(row => row.code));
  if (req.session.userRole) codes.add(req.session.userRole);
  return Array.from(codes);
}

function requestHasQualityRole(req, roleCodes) {
  if (!req.session || !req.session.userId) return false;
  const current = getCurrentRoleCodes(req);
  return roleCodes.some(code => current.includes(code));
}

function requestHasAnyPermission(req, permissionCodes) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = getUserEffectivePermissions(req.session.userId);
  return permSet.has('*:*') || permissionCodes.some(code => permSet.has(code));
}

function canViewAllProcessGovernance(req) {
  return requestHasAnyPermission(req, ['admin:access', 'process_governance:view_all']) ||
    requestHasQualityRole(req, PROCESS_GOVERNANCE_GLOBAL_ROLES);
}

async function canViewAllProcessGovernanceAsync(req) {
  return await requestHasAnyPermissionAsync(req, ['admin:access', 'process_governance:view_all']) ||
    await requestHasQualityRoleAsync(req, PROCESS_GOVERNANCE_GLOBAL_ROLES);
}

function currentDepartmentName(req) {
  if (req.session && req.session.departmentName) return String(req.session.departmentName || '');
  if (!req.session || !req.session.departmentId) return '';
  const department = db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId);
  return department && department.name || '';
}

function canAccessDepartmentQualityCase(req, qualityCase) {
  if (!qualityCase || !req.session || !req.session.userId) return false;
  const departmentName = currentDepartmentName(req);
  if (qualityCase.dept_name) return !!departmentName && qualityCase.dept_name === departmentName;
  return Number(qualityCase.owner_user_id || 0) === Number(req.session.userId || 0) ||
    Number(qualityCase.owner_dept_id || 0) === Number(req.session.departmentId || 0);
}

function canAccessDepartmentMappingTodo(req, todo) {
  if (!todo || !req.session || !req.session.userId) return false;
  const departmentName = currentDepartmentName(req);
  if (todo.dept_name || todo.target_dept_name) {
    return !!departmentName && (todo.dept_name === departmentName || todo.target_dept_name === departmentName);
  }
  return Number(todo.owner_user_id || 0) === Number(req.session.userId || 0) ||
    Number(todo.owner_dept_id || 0) === Number(req.session.departmentId || 0);
}

async function canAccessDepartmentQualityCaseAsync(req, qualityCase) {
  if (!qualityCase || !req.session || !req.session.userId) return false;
  const departmentName = await currentDepartmentNameAsync(req);
  if (qualityCase.dept_name) return !!departmentName && qualityCase.dept_name === departmentName;
  return Number(qualityCase.owner_user_id || 0) === Number(req.session.userId || 0) ||
    Number(qualityCase.owner_dept_id || 0) === Number(req.session.departmentId || 0);
}

async function canAccessDepartmentMappingTodoAsync(req, todo) {
  if (!todo || !req.session || !req.session.userId) return false;
  const departmentName = await currentDepartmentNameAsync(req);
  if (todo.dept_name || todo.target_dept_name) {
    return !!departmentName && (todo.dept_name === departmentName || todo.target_dept_name === departmentName);
  }
  return Number(todo.owner_user_id || 0) === Number(req.session.userId || 0) ||
    Number(todo.owner_dept_id || 0) === Number(req.session.departmentId || 0);
}

function canViewQualityCase(req, qualityCase) {
  return canViewAllProcessGovernance(req) || canAccessDepartmentQualityCase(req, qualityCase);
}

async function canViewQualityCaseAsync(req, qualityCase) {
  return await canViewAllProcessGovernanceAsync(req) || await canAccessDepartmentQualityCaseAsync(req, qualityCase);
}

function canViewMappingTodo(req, todo) {
  return canViewAllProcessGovernance(req) || canAccessDepartmentMappingTodo(req, todo);
}

async function canViewMappingTodoAsync(req, todo) {
  return await canViewAllProcessGovernanceAsync(req) || await canAccessDepartmentMappingTodoAsync(req, todo);
}

function canViewAllQualityCases(req) {
  return canViewAllProcessGovernance(req);
}

function canManageQualityCase(req, qualityCase) {
  if (canViewAllProcessGovernance(req)) return true;
  if (!canAccessDepartmentQualityCase(req, qualityCase)) return false;
  return requestHasAnyPermission(req, ['process_quality:manage', 'review:approve']) ||
    requestHasQualityRole(req, DEPARTMENT_CONFIRM_ROLES);
}

function canCloseQualityCase(req) {
  return canViewAllProcessGovernance(req) ||
    requestHasAnyPermission(req, ['process_quality:close']);
}

function canViewAllMappingTodos(req) {
  return canViewAllProcessGovernance(req);
}

function canManageMappingTodo(req, todo) {
  if (canViewAllProcessGovernance(req)) return true;
  if (!canAccessDepartmentMappingTodo(req, todo)) return false;
  return requestHasAnyPermission(req, ['process_mapping:manage', 'review:approve']) ||
    requestHasQualityRole(req, DEPARTMENT_CONFIRM_ROLES);
}

function canCloseMappingTodo(req) {
  return canViewAllProcessGovernance(req) ||
    requestHasAnyPermission(req, ['process_mapping:close']);
}

async function getCurrentRoleCodesAsync(req) {
  if (!req.session || !req.session.userId) return [];
  const rows = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  const codes = new Set((rows || []).map(row => row.code || row.role_code).filter(Boolean));
  if (req.session.userRole) codes.add(req.session.userRole);
  return Array.from(codes);
}

async function requestHasQualityRoleAsync(req, roleCodes) {
  if (!req.session || !req.session.userId) return false;
  const current = await getCurrentRoleCodesAsync(req);
  return roleCodes.some(code => current.includes(code));
}

async function requestHasAnyPermissionAsync(req, permissionCodes) {
  if (!req.session || !req.session.userId) return false;
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('*:*') || permissionCodes.some(code => permSet.has(code));
}

async function currentDepartmentNameAsync(req) {
  if (req.session && req.session.departmentName) return String(req.session.departmentName || '');
  if (!req.session || !req.session.departmentId) return '';
  const department = await getDepartmentByIdAsync(req.session.departmentId);
  return department && department.name || '';
}

async function currentIssuePoolDepartmentNameAsync(req) {
  if (await canViewAllProcessGovernanceAsync(req)) return '';
  return await currentDepartmentNameAsync(req);
}

async function currentInputBaselineReviewDepartmentName(req) {
  if (await canViewAllInputBaselineReviewsAsync(req)) return '';
  return await currentDepartmentNameAsync(req);
}

function scopedInputBaselineReviewFilters(filters, departmentName) {
  const requestedDept = filters && filters.dept ? String(filters.dept) : '';
  if (!departmentName) {
    return {
      ...filters,
      dept: requestedDept
    };
  }
  return {
    ...filters,
    dept: requestedDept && requestedDept !== departmentName ? '__no_department__' : (departmentName || '__no_department__')
  };
}

function canAccessInputBaselineReviewItem(reviewItem, departmentName) {
  return !!reviewItem && !!departmentName && reviewItem.department === departmentName;
}

function sessionHasAnyRole(req, roleCodes) {
  if (!req.session) return false;
  const current = new Set();
  if (req.session.userRole) current.add(req.session.userRole);
  if (Array.isArray(req.session.roleCodes)) {
    req.session.roleCodes.forEach(code => current.add(code));
  }
  return roleCodes.some(code => current.has(code));
}

async function canViewAllInputBaselineReviewsAsync(req) {
  if (sessionHasAnyRole(req, PROCESS_GOVERNANCE_GLOBAL_ROLES)) return true;
  if (req.session && ['submitter', 'owner', 'reviewer'].includes(req.session.userRole)) return false;
  return await canViewAllProcessGovernanceAsync(req);
}

async function canAccessInputBaselineReviewItemAsync(req, reviewItem, departmentName) {
  if (await canViewAllInputBaselineReviewsAsync(req)) return !!reviewItem;
  return canAccessInputBaselineReviewItem(reviewItem, departmentName);
}

async function canViewAllQualityCasesAsync(req) {
  return await canViewAllProcessGovernanceAsync(req);
}

async function canManageQualityCaseAsync(req, qualityCase) {
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  if (!await canAccessDepartmentQualityCaseAsync(req, qualityCase)) return false;
  return await requestHasAnyPermissionAsync(req, ['process_quality:manage', 'review:approve']) ||
    await requestHasQualityRoleAsync(req, DEPARTMENT_CONFIRM_ROLES);
}

async function canCloseQualityCaseAsync(req) {
  return await canViewAllProcessGovernanceAsync(req) ||
    await requestHasAnyPermissionAsync(req, ['process_quality:close']);
}

async function canViewAllMappingTodosAsync(req) {
  return await canViewAllProcessGovernanceAsync(req);
}

async function canManageMappingTodoAsync(req, todo) {
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  if (!await canAccessDepartmentMappingTodoAsync(req, todo)) return false;
  return await requestHasAnyPermissionAsync(req, ['process_mapping:manage', 'review:approve']) ||
    await requestHasQualityRoleAsync(req, DEPARTMENT_CONFIRM_ROLES);
}

async function canCloseMappingTodoAsync(req) {
  return await canViewAllProcessGovernanceAsync(req) ||
    await requestHasAnyPermissionAsync(req, ['process_mapping:close']);
}

function mapIssueQueues(rows) {
  const labels = new Map(QUEUE_DEFINITIONS);
  return (rows || []).map(row => ({
    key: row.key || row.display_status,
    label: row.label || labels.get(row.key || row.display_status) || '待处理',
    count: Number(row.count || 0),
    preview: Array.isArray(row.preview) ? row.preview : []
  }));
}

async function canGenerateIssuePoolAsync(req) {
  if (await requestHasAnyPermissionAsync(req, ['process_governance:generate_issue_pool', 'admin:access'])) return true;
  return await requestHasQualityRoleAsync(req, ['admin', 'it_lead', 'decision_group']);
}

async function issuePoolActor(req) {
  const roleCodes = await getCurrentRoleCodesAsync(req);
  return {
    actorUserId: req.session && req.session.userId || null,
    actorDeptName: await currentDepartmentNameAsync(req),
    actorRoleCode: roleCodes[0] || req.session && req.session.userRole || ''
  };
}

function issuePoolRelatedDepartments(detail) {
  const issue = detail && detail.issue || {};
  const departments = new Set();
  [
    issue.primary_dept_name,
    issue.owner_dept_name,
    issue.dept_name,
    issue.target_dept_name
  ].forEach(name => {
    if (name) departments.add(String(name));
  });
  ((detail && detail.participants) || []).forEach(participant => {
    if (participant && participant.dept_name) departments.add(String(participant.dept_name));
  });
  return departments;
}

async function canAccessIssuePoolDetailAsync(req, detail) {
  if (!detail || !detail.issue) return false;
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  const departmentName = await currentDepartmentNameAsync(req);
  return !!departmentName && issuePoolRelatedDepartments(detail).has(departmentName);
}

async function canDepartmentActOnIssuePoolAsync(req, detail) {
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  if (!await canAccessIssuePoolDetailAsync(req, detail)) return false;
  return await requestHasAnyPermissionAsync(req, ['process_governance:submit', 'process_governance:review']) ||
    await requestHasQualityRoleAsync(req, DEPARTMENT_CONFIRM_ROLES);
}

async function canReviewIssuePoolAsync(req, detail) {
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  if (!await canAccessIssuePoolDetailAsync(req, detail)) return false;
  return await requestHasAnyPermissionAsync(req, ['process_governance:review']) ||
    await requestHasQualityRoleAsync(req, ['project_lead', 'workgroup_lead', 'data_quality', 'owner', 'reviewer']);
}

async function canDecideIssuePoolAsync(req) {
  return await requestHasAnyPermissionAsync(req, ['admin:access']) ||
    await requestHasQualityRoleAsync(req, ['admin', 'it_lead', 'decision_group']);
}

async function canCloseIssuePoolAsync(req, detail) {
  if (await canViewAllProcessGovernanceAsync(req)) return true;
  return await canReviewIssuePoolAsync(req, detail);
}

async function canApplyIssuePoolPointActionAsync(req, detail, actionName) {
  if (['mdm-decision', 'studio-review'].includes(actionName)) {
    return await canDecideIssuePoolAsync(req);
  }
  if (actionName === 'review') {
    return await canReviewIssuePoolAsync(req, detail);
  }
  return await canDepartmentActOnIssuePoolAsync(req, detail);
}

async function issuePoolDetailForPoint(repo, pointId) {
  if (typeof repo.getIssueDetailByPoint === 'function') {
    return await repo.getIssueDetailByPoint(pointId);
  }
  return null;
}

async function issuePoolTermTask(repo, termTaskId) {
  if (typeof repo.getTermTask === 'function') {
    return await repo.getTermTask(termTaskId);
  }
  return null;
}

async function canAnswerIssuePoolTermTaskAsync(req, task, detail, requestedDepartmentName) {
  if (!task || !detail || !detail.issue) return false;
  if (await canDecideIssuePoolAsync(req)) return true;
  if (!await canDepartmentActOnIssuePoolAsync(req, detail)) return false;
  const actorDepartmentName = await currentDepartmentNameAsync(req);
  if (!actorDepartmentName || requestedDepartmentName !== actorDepartmentName) return false;
  const selectedDepartments = Array.isArray(task.selected_departments) ? task.selected_departments : [];
  return selectedDepartments.includes(actorDepartmentName);
}

function caseSelectSql() {
  return `
    SELECT c.*,
           owner.name AS owner_user_name,
           owner.employee_no AS owner_employee_no,
           ownerDept.name AS owner_dept_name,
           closer.name AS closed_by_name
    FROM process_governance_quality_cases c
    LEFT JOIN users owner ON owner.id = c.owner_user_id
    LEFT JOIN departments ownerDept ON ownerDept.id = c.owner_dept_id
    LEFT JOIN users closer ON closer.id = c.closed_by
  `;
}

function mappingRecordSummary(items) {
  const byType = { l3: 0, a1: 0 };
  const byStatus = { active: 0, source_missing: 0, published: 0, archived: 0 };
  items.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(byType, item.record_type)) byType[item.record_type] += 1;
    if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) byStatus[item.status] += 1;
  });
  return { total: items.length, byType, byStatus };
}

function mappingRecordSummaryFromRows(rows) {
  const summary = mappingRecordSummary([]);
  rows.forEach(row => {
    const count = Number(row.count || 0);
    if (Object.prototype.hasOwnProperty.call(summary.byType, row.record_type)) summary.byType[row.record_type] += count;
    if (Object.prototype.hasOwnProperty.call(summary.byStatus, row.status)) summary.byStatus[row.status] += count;
    summary.total += count;
  });
  return summary;
}

function mappingTodoSummary(items) {
  const byType = { dept_confirm: 0, verification: 0, adjustment: 0, cross_dept: 0, evidence: 0 };
  const byStatus = {
    open: 0,
    assigned: 0,
    rectifying: 0,
    submitted: 0,
    source_resolved: 0,
    closed: 0,
    reopened: 0,
    accepted: 0
  };
  items.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(byType, item.todo_type)) byType[item.todo_type] += 1;
    if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) byStatus[item.status] += 1;
  });
  return { total: items.length, byType, byStatus };
}

function mappingTodoSummaryFromRows(rows) {
  const summary = mappingTodoSummary([]);
  rows.forEach(row => {
    const count = Number(row.count || 0);
    if (Object.prototype.hasOwnProperty.call(summary.byType, row.todo_type)) summary.byType[row.todo_type] += count;
    if (Object.prototype.hasOwnProperty.call(summary.byStatus, row.status)) summary.byStatus[row.status] += count;
    summary.total += count;
  });
  return summary;
}

function sourceFileSummaryFromRows(rows) {
  const summary = { total: 0, byStatus: { '纳入': 0, '排除': 0, '待复核': 0 }, byAssetType: {} };
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.process_status) summary.byStatus[row.process_status] = (summary.byStatus[row.process_status] || 0) + count;
    if (row.asset_type) summary.byAssetType[row.asset_type] = (summary.byAssetType[row.asset_type] || 0) + count;
  });
  return summary;
}

function mdmRequirementSummaryFromRows(rows) {
  const summary = { total: 0, byDept: {} };
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.dept_name) summary.byDept[row.dept_name] = (summary.byDept[row.dept_name] || 0) + count;
  });
  return summary;
}

function evidenceSummaryFromRows(rows) {
  const summary = { total: 0, byType: { L3: 0, A1: 0, MDM: 0 } };
  rows.forEach(row => {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.ref_type) summary.byType[row.ref_type] = (summary.byType[row.ref_type] || 0) + count;
  });
  return summary;
}

function mappingTodoSelectSql() {
  return `
    SELECT t.*,
           owner.name AS owner_user_name,
           owner.employee_no AS owner_employee_no,
           ownerDept.name AS owner_dept_name,
           closer.name AS closed_by_name,
           r.record_type,
           r.behavior AS mapping_behavior
    FROM process_mapping_todos t
    LEFT JOIN users owner ON owner.id = t.owner_user_id
    LEFT JOIN departments ownerDept ON ownerDept.id = t.owner_dept_id
    LEFT JOIN users closer ON closer.id = t.closed_by
    LEFT JOIN process_mapping_records r ON r.id = t.mapping_record_id
  `;
}

function loadMappingTodo(todoId) {
  return db.prepare(`${mappingTodoSelectSql()} WHERE t.id=?`).get(todoId);
}

function mappingTodoEvents(todoId) {
  return db.prepare(`
    SELECT e.*, u.name AS actor_user_name
    FROM process_mapping_todo_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.todo_id=?
    ORDER BY e.id
  `).all(todoId).map(row => ({
    ...row,
    payload: parseJsonObject(row.payload_json)
  }));
}

function addMappingTodoEvent(todoId, eventType, actorUserId, note, payload) {
  db.prepare(`
    INSERT INTO process_mapping_todo_events (todo_id, event_type, actor_user_id, note, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(todoId, eventType, actorUserId || null, note || null, payload ? JSON.stringify(payload) : null);
}

function sendMappingTodoWithEvents(res, todoId) {
  const todo = loadMappingTodo(todoId);
  return res.json({ todo, events: mappingTodoEvents(todoId) });
}

function loadQualityCase(caseId) {
  return db.prepare(`${caseSelectSql()} WHERE c.id=?`).get(caseId);
}

function qualityCaseEvents(caseId) {
  return db.prepare(`
    SELECT e.*, u.name AS actor_user_name
    FROM process_governance_quality_case_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.case_id=?
    ORDER BY e.id
  `).all(caseId).map(row => ({
    ...row,
    payload: parseJsonObject(row.payload_json)
  }));
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function qualityCaseSummary(items) {
  const bySeverity = { BLOCK: 0, WARN: 0 };
  const byStatus = {
    open: 0,
    assigned: 0,
    rectifying: 0,
    submitted: 0,
    source_resolved: 0,
    closed: 0,
    reopened: 0
  };
  items.forEach(item => {
    if (Object.prototype.hasOwnProperty.call(bySeverity, item.severity)) bySeverity[item.severity] += 1;
    if (Object.prototype.hasOwnProperty.call(byStatus, item.status)) byStatus[item.status] += 1;
  });
  return { total: items.length, bySeverity, byStatus };
}

function addQualityCaseEvent(caseId, eventType, actorUserId, note, payload) {
  db.prepare(`
    INSERT INTO process_governance_quality_case_events (case_id, event_type, actor_user_id, note, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(caseId, eventType, actorUserId || null, note || null, payload ? JSON.stringify(payload) : null);
}

function sendCaseWithEvents(res, caseId) {
  const qualityCase = loadQualityCase(caseId);
  return res.json({ case: qualityCase, events: qualityCaseEvents(caseId) });
}

function getOwnerDeptId(ownerUserId, ownerDeptId) {
  if (ownerDeptId) return ownerDeptId;
  if (!ownerUserId) return null;
  const owner = db.prepare('SELECT department_id FROM users WHERE id=?').get(ownerUserId);
  return owner && owner.department_id || null;
}

async function resolveOwnerAssignmentAsync(ownerUserId, requestedOwnerDeptId) {
  let owner = null;
  if (ownerUserId) {
    owner = await getUserByIdAsync(ownerUserId);
    if (!owner) return { error: '责任人不存在' };
  }
  const ownerDeptId = requestedOwnerDeptId || (owner && (owner.department_id || owner.departmentId)) || null;
  if (ownerDeptId) {
    const department = await getDepartmentByIdAsync(ownerDeptId);
    if (!department) return { error: '责任部门不存在' };
  }
  return { ownerDeptId };
}

function parseCaseId(req) {
  return Number(req.params.id || 0);
}

router.get('/snapshots', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      let repo;
      try {
        repo = await processGovernanceRepository();
      } catch (error) {
        console.error(error);
        return res.status(503).json({ error: '流程治理 MySQL 读模型不可用' });
      }
      return res.json(await repo.listSnapshots());
    });
  }

  return runDbAction(res, () => {
    const snapshots = db.prepare(`
      SELECT id, source_json_path, source_hash, generated_at, imported_at, status, note
      FROM process_governance_snapshots
      ORDER BY imported_at DESC, id DESC
    `).all();
    res.json(snapshots);
  });
});

router.get('/current', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      let repo;
      try {
        repo = await processGovernanceRepository();
      } catch (error) {
        console.error(error);
        return res.status(503).json({ error: '流程治理 MySQL 读模型不可用' });
      }
      return res.json(await repo.getCurrentSnapshot());
    });
  }

  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({});
    res.json({
      id: snapshot.id,
      source_json_path: snapshot.source_json_path,
      source_hash: snapshot.source_hash,
      generated_at: snapshot.generated_at,
      imported_at: snapshot.imported_at,
      status: snapshot.status,
      note: snapshot.note,
      stats: snapshotStats(snapshot),
      qualitySummary: qualitySummary(snapshot.id)
    });
  });
});

router.get('/sankey', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      let repo;
      try {
        repo = await processGovernanceRepository();
      } catch (error) {
        console.error(error);
        return res.status(503).json({ error: '流程治理 MySQL 读模型不可用' });
      }
      return res.json(await repo.getActiveSankey());
    });
  }

  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json(emptySankey());

    let nodes = db.prepare(`
      SELECT node_key AS name, name AS label, node_type, domain_name, dept_name, parent_key, source_file
      FROM process_governance_nodes
      WHERE snapshot_id=?
      ORDER BY sort_order, id
    `).all(snapshot.id);

    let links = db.prepare(`
      SELECT source_key AS source, target_key AS target, value
      FROM process_governance_edges
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id);
    const publishedDesignParts = publishedDesignSankeyParts();
    const existingNodeNames = new Set(nodes.map(node => node.name));
    const extraNodes = publishedDesignParts.nodes.filter(node => !existingNodeNames.has(node.name));
    nodes = nodes.concat(extraNodes);
    links = links.concat(publishedDesignParts.links);

    const systems = nodes
      .filter(node => node.node_type === 'system')
      .map(node => node.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const risks = db.prepare(`
      SELECT source_dept AS source, target_dept AS target, a1_code AS a1, refs,
             risk_level AS risk, confirm_status AS status, description AS desc, source_report
      FROM process_cross_dept_interactions
      WHERE snapshot_id=?
      ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
    `).all(snapshot.id);

    const interactionChains = db.prepare(`
      SELECT name, status, breaks_json, source_report
      FROM process_interaction_chains
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id).map(row => ({
      name: row.name,
      status: row.status,
      breaks: parseJsonArray(row.breaks_json),
      source_report: row.source_report
    }));

    const stats = snapshotStats(snapshot);
    const publishedA1Count = publishedDesignParts.nodes.filter(node => node.node_type === 'a1').length;
    const publishedL3Count = publishedDesignParts.nodes.filter(node => node.node_type === 'l3').length;
    res.json({
      nodes,
      links,
      systems,
      stats: {
        mappings: (stats.mappings || 0) + publishedL3Count,
        a1: (stats.a1 || 0) + publishedA1Count,
        departmentsWithData: stats.departmentsWithData || 0,
        departmentsEmpty: stats.departmentsEmpty || 0
      },
      crossDept: {
        stats: stats.crossDept || {},
        risks: risks.map(({ source_report, ...risk }) => risk),
        interactionChains,
        source: risks[0] && risks[0].source_report || interactionChains[0] && interactionChains[0].source_report || null
      }
    });
  });
});

router.get('/a1', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      let repo;
      try {
        repo = await processGovernanceRepository();
      } catch (error) {
        console.error(error);
        return res.status(503).json({ error: '流程治理 MySQL 读模型不可用' });
      }
      return res.json({ items: await repo.getA1Items(req.query) });
    });
  }

  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT *
      FROM process_a1_items
      WHERE snapshot_id=?
    `;

    if (req.query.dept) {
      sql += ' AND dept_name=?';
      params.push(req.query.dept);
    }
    if (req.query.l3) {
      sql += ' AND l3_name=?';
      params.push(req.query.l3);
    }
    if (req.query.system) {
      sql += ' AND suggested_systems LIKE ?';
      params.push(`%"${req.query.system}"%`);
    }

    sql += ' ORDER BY dept_name, l3_name, a1_code, id';
    const items = db.prepare(sql).all(...params).map(row => ({
      ...row,
      suggested_systems: parseJsonArray(row.suggested_systems)
    }));
    res.json({ items });
  });
});

router.get('/source-files', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepository();
      const result = await repo.getSourceFiles({
        dept: req.query.dept,
        status: req.query.status,
        assetType: req.query.assetType
      }, SOURCE_FILE_COVERAGE_LIMIT);
      return res.json(result);
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) {
      return res.json({ summary: { total: 0, byStatus: { '纳入': 0, '排除': 0, '待复核': 0 }, byAssetType: {}, returned: 0, limit: SOURCE_FILE_COVERAGE_LIMIT }, items: [] });
    }

    const params = [snapshot.id];
    let whereSql = 'WHERE snapshot_id=?';
    if (req.query.dept) {
      whereSql += ' AND dept_name=?';
      params.push(String(req.query.dept));
    }
    if (req.query.status && ['纳入', '排除', '待复核'].includes(String(req.query.status))) {
      whereSql += ' AND process_status=?';
      params.push(String(req.query.status));
    }
    if (req.query.assetType) {
      whereSql += ' AND asset_type=?';
      params.push(String(req.query.assetType));
    }

    const summaryRows = db.prepare(`
      SELECT process_status, asset_type, COUNT(*) AS count
      FROM process_source_files
      ${whereSql}
      GROUP BY process_status, asset_type
    `).all(...params);
    const items = db.prepare(`
      SELECT file_path, dept_name, asset_type, file_no, revision, size_bytes, mtime, sha256, process_status, process_reason
      FROM process_source_files
      ${whereSql}
      ORDER BY dept_name, process_status, asset_type, file_path
      LIMIT ?
    `).all(...params, SOURCE_FILE_COVERAGE_LIMIT);
    return res.json({ summary: { ...sourceFileSummaryFromRows(summaryRows), returned: items.length, limit: SOURCE_FILE_COVERAGE_LIMIT }, items });
  });
});

router.get('/mdm-requirements', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepository();
      const result = await repo.getMdmRequirements({
        dept: req.query.dept,
        object: req.query.object
      }, 500);
      return res.json(result);
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ summary: { total: 0, byDept: {}, returned: 0, limit: 500 }, items: [] });

    const params = [snapshot.id];
    let whereSql = 'WHERE snapshot_id=?';
    if (req.query.dept) {
      whereSql += ' AND dept_name=?';
      params.push(String(req.query.dept));
    }
    if (req.query.object) {
      whereSql += ' AND master_data_object=?';
      params.push(String(req.query.object));
    }

    const summaryRows = db.prepare(`
      SELECT dept_name, COUNT(*) AS count
      FROM process_mdm_requirement_items
      ${whereSql}
      GROUP BY dept_name
    `).all(...params);
    const items = db.prepare(`
      SELECT dept_name, master_data_object, source_l2, key_fields, responsible_dept, system_boundary, governance_requirement, source_file
      FROM process_mdm_requirement_items
      ${whereSql}
      ORDER BY dept_name, source_l2, master_data_object, id
      LIMIT 500
    `).all(...params);
    return res.json({ summary: { ...mdmRequirementSummaryFromRows(summaryRows), returned: items.length, limit: 500 }, items });
  });
});

router.get('/evidence', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepository();
      const result = await repo.getEvidenceRefs({
        dept: req.query.dept,
        l3: req.query.l3,
        a1: req.query.a1,
        object: req.query.object,
        type: req.query.type
      }, 500);
      return res.json(result);
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ summary: { total: 0, byType: { L3: 0, A1: 0, MDM: 0 }, returned: 0, limit: 500 }, items: [] });

    const params = [snapshot.id];
    let whereSql = 'WHERE snapshot_id=?';
    if (req.query.dept) {
      whereSql += ' AND dept_name=?';
      params.push(String(req.query.dept));
    }
    if (req.query.l3) {
      whereSql += ' AND l3_name=?';
      params.push(String(req.query.l3));
    }
    if (req.query.a1) {
      if (req.query.l3) {
        whereSql += " AND (a1_code=? OR (ref_type='L3' AND (a1_code IS NULL OR a1_code='')))";
        params.push(String(req.query.a1));
      } else {
        whereSql += ' AND a1_code=?';
        params.push(String(req.query.a1));
      }
    }
    if (req.query.object) {
      whereSql += ' AND master_data_object=?';
      params.push(String(req.query.object));
    }
    const refType = String(req.query.type || '').toUpperCase();
    if (['L3', 'A1', 'MDM'].includes(refType)) {
      whereSql += ' AND ref_type=?';
      params.push(refType);
    }

    const summaryRows = db.prepare(`
      SELECT ref_type, COUNT(*) AS count
      FROM process_evidence_refs
      ${whereSql}
      GROUP BY ref_type
    `).all(...params);
    const items = db.prepare(`
      SELECT ref_type, dept_name, l3_name, a1_code, master_data_object, evidence_type, source_file, citation, note
      FROM process_evidence_refs
      ${whereSql}
      ORDER BY CASE ref_type WHEN 'L3' THEN 0 WHEN 'A1' THEN 1 ELSE 2 END,
               dept_name, l3_name, a1_code, master_data_object, id
      LIMIT 500
    `).all(...params);
    return res.json({ summary: { ...evidenceSummaryFromRows(summaryRows), returned: items.length, limit: 500 }, items });
  });
});

router.get('/cross-dept', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const items = await repo.getCrossDeptInteractions({
        risk: req.query.risk,
        status: req.query.status,
        dept: req.query.dept
      });
      return res.json({ items });
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT *
      FROM process_cross_dept_interactions
      WHERE snapshot_id=?
    `;

    if (req.query.risk) {
      sql += ' AND risk_level=?';
      params.push(req.query.risk);
    }
    if (req.query.status) {
      sql += ' AND confirm_status=?';
      params.push(req.query.status);
    }
    if (req.query.dept) {
      sql += ' AND (source_dept=? OR target_dept=?)';
      params.push(req.query.dept, req.query.dept);
    }

    sql += " ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id";
    res.json({ items: db.prepare(sql).all(...params) });
  });
});

router.get('/quality', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      return res.json(await repo.getQualityFindings({
        severity: String(req.query.severity || '').toUpperCase(),
        area: req.query.area,
        dept: req.query.dept
      }));
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ summary: emptyQualitySummary(), items: [] });

    const params = [snapshot.id];
    let sql = `
      SELECT id, severity, area, source_file, source_line, message, suggestion, dept_name, imported_at
      FROM process_governance_quality_findings
      WHERE snapshot_id=?
    `;

    const severity = String(req.query.severity || '').toUpperCase();
    if (['BLOCK', 'WARN', 'INFO'].includes(severity)) {
      sql += ' AND severity=?';
      params.push(severity);
    }
    if (req.query.area) {
      sql += ' AND area=?';
      params.push(String(req.query.area));
    }
    if (req.query.dept) {
      sql += ' AND dept_name=?';
      params.push(String(req.query.dept));
    }

    sql += `
      ORDER BY CASE severity WHEN 'BLOCK' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END,
               area, source_file, COALESCE(source_line, 0), id
    `;

    res.json({
      summary: qualitySummary(snapshot.id),
      items: db.prepare(sql).all(...params)
    });
  });
});

router.get('/quality-cases', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const canViewAll = await canViewAllQualityCasesAsync(req);
      const departmentName = await currentDepartmentNameAsync(req);
      return res.json(await repo.getQualityCases({
        severity: String(req.query.severity || '').toUpperCase(),
        status: req.query.status,
        area: req.query.area,
        dept: req.query.dept,
        owner: req.query.owner,
        userId: req.session.userId,
        departmentId: req.session.departmentId || -1,
        snapshot: req.query.snapshot,
        canViewAll,
        departmentName
      }));
    });
  }
  return runDbAction(res, () => {
    const params = [];
    let sql = `${caseSelectSql()} WHERE 1=1`;

    const severity = String(req.query.severity || '').toUpperCase();
    if (['BLOCK', 'WARN'].includes(severity)) {
      sql += ' AND c.severity=?';
      params.push(severity);
    }
    const status = String(req.query.status || '');
    if (QUALITY_CASE_STATUSES.has(status)) {
      sql += ' AND c.status=?';
      params.push(status);
    }
    if (req.query.area) {
      sql += ' AND c.area=?';
      params.push(String(req.query.area));
    }
    if (req.query.dept) {
      sql += ' AND c.dept_name=?';
      params.push(String(req.query.dept));
    }
    if (req.query.owner === 'me') {
      sql += ' AND c.owner_user_id=?';
      params.push(req.session.userId);
    } else if (req.query.owner) {
      sql += ' AND c.owner_user_id=?';
      params.push(Number(req.query.owner));
    }
    if (req.query.snapshot === 'active') {
      const snapshot = activeSnapshot();
      if (snapshot) {
        sql += ' AND c.latest_snapshot_id=?';
        params.push(snapshot.id);
      }
    }

    if (!canViewAllQualityCases(req)) {
      const department = req.session.departmentId
        ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
        : null;
      sql += ` AND (
        c.dept_name=?
        OR (
          c.dept_name IS NULL
          AND (c.owner_user_id=? OR c.owner_dept_id=?)
        )
      )`;
      params.push(department && department.name || '__none__', req.session.userId, req.session.departmentId || -1);
    }

    sql += `
      ORDER BY CASE c.status
                 WHEN 'open' THEN 0
                 WHEN 'reopened' THEN 1
                 WHEN 'assigned' THEN 2
                 WHEN 'rectifying' THEN 3
                 WHEN 'submitted' THEN 4
                 WHEN 'source_resolved' THEN 5
                 WHEN 'closed' THEN 6
                 ELSE 7
               END,
               CASE c.severity WHEN 'BLOCK' THEN 0 ELSE 1 END,
               c.dept_name IS NULL,
               c.dept_name,
               c.updated_at DESC,
               c.id
    `;

    const items = db.prepare(sql).all(...params);
    res.json({ summary: qualityCaseSummary(items), items });
  });
});

router.get('/quality-cases/:id', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canViewQualityCaseAsync(req, qualityCase)) {
        return res.status(403).json({ error: '权限不足' });
      }
      return res.json({ case: qualityCase, events: await repo.getQualityCaseEvents(qualityCase.id) });
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canViewQualityCase(req, qualityCase)) {
      return res.status(403).json({ error: '权限不足' });
    }
    return res.json({ case: qualityCase, events: qualityCaseEvents(qualityCase.id) });
  });
});

router.post('/quality-cases/:id/assign', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canManageQualityCaseAsync(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
      if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能分派' });

      const ownerUserId = req.body.owner_user_id ? Number(req.body.owner_user_id) : null;
      const assignment = await resolveOwnerAssignmentAsync(ownerUserId, req.body.owner_dept_id ? Number(req.body.owner_dept_id) : null);
      if (assignment.error) return res.status(400).json({ error: assignment.error });
      const priority = String(req.body.priority || qualityCase.priority || 'medium');
      if (!QUALITY_CASE_PRIORITIES.has(priority)) return res.status(400).json({ error: '优先级无效' });
      return res.json(await repo.assignQualityCase(qualityCase.id, {
        owner_user_id: ownerUserId,
        owner_dept_id: assignment.ownerDeptId,
        priority,
        due_date: req.body.due_date ? String(req.body.due_date) : null,
        actor_user_id: req.session.userId,
        note: req.body.note || '已分派治理问题单'
      }));
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canManageQualityCase(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
    if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能分派' });

    const ownerUserId = req.body.owner_user_id ? Number(req.body.owner_user_id) : null;
    if (ownerUserId && !db.prepare('SELECT id FROM users WHERE id=?').get(ownerUserId)) {
      return res.status(400).json({ error: '责任人不存在' });
    }
    const ownerDeptId = getOwnerDeptId(ownerUserId, req.body.owner_dept_id ? Number(req.body.owner_dept_id) : null);
    if (ownerDeptId && !db.prepare('SELECT id FROM departments WHERE id=?').get(ownerDeptId)) {
      return res.status(400).json({ error: '责任部门不存在' });
    }
    const priority = String(req.body.priority || qualityCase.priority || 'medium');
    if (!QUALITY_CASE_PRIORITIES.has(priority)) return res.status(400).json({ error: '优先级无效' });
    const dueDate = req.body.due_date ? String(req.body.due_date) : null;

    db.prepare(`
      UPDATE process_governance_quality_cases
      SET owner_user_id=COALESCE(?, owner_user_id),
          owner_dept_id=COALESCE(?, owner_dept_id),
          priority=?,
          due_date=?,
          status='assigned',
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(ownerUserId, ownerDeptId, priority, dueDate, qualityCase.id);
    addQualityCaseEvent(qualityCase.id, 'assigned', req.session.userId, req.body.note || '已分派治理问题单', {
      owner_user_id: ownerUserId,
      owner_dept_id: ownerDeptId,
      priority,
      due_date: dueDate
    });
    return sendCaseWithEvents(res, qualityCase.id);
  });
});

router.post('/quality-cases/:id/status', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canManageQualityCaseAsync(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
      const nextStatus = String(req.body.status || '');
      if (!USER_SET_STATUSES.has(nextStatus)) return res.status(400).json({ error: '状态无效' });
      if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能直接改状态' });
      return res.json(await repo.updateQualityCaseStatus(qualityCase.id, {
        status: nextStatus,
        actor_user_id: req.session.userId,
        note: req.body.note || null,
        from_status: qualityCase.status
      }));
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canManageQualityCase(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
    const nextStatus = String(req.body.status || '');
    if (!USER_SET_STATUSES.has(nextStatus)) return res.status(400).json({ error: '状态无效' });
    if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能直接改状态' });

    db.prepare(`
      UPDATE process_governance_quality_cases
      SET status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(nextStatus, qualityCase.id);
    addQualityCaseEvent(qualityCase.id, 'status_changed', req.session.userId, req.body.note || null, {
      from_status: qualityCase.status,
      to_status: nextStatus
    });
    return sendCaseWithEvents(res, qualityCase.id);
  });
});

router.post('/quality-cases/:id/comment', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canViewQualityCaseAsync(req, qualityCase)) {
        return res.status(403).json({ error: '权限不足' });
      }
      const note = String(req.body.note || '').trim();
      if (!note) return res.status(400).json({ error: '备注不能为空' });
      return res.json(await repo.addQualityCaseComment(qualityCase.id, {
        actor_user_id: req.session.userId,
        note
      }));
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canViewQualityCase(req, qualityCase)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: '备注不能为空' });
    addQualityCaseEvent(qualityCase.id, 'commented', req.session.userId, note, null);
    db.prepare('UPDATE process_governance_quality_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(qualityCase.id);
    return sendCaseWithEvents(res, qualityCase.id);
  });
});

router.post('/quality-cases/:id/submit', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canManageQualityCaseAsync(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
      if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能提交整改' });
      return res.json(await repo.submitQualityCase(qualityCase.id, {
        actor_user_id: req.session.userId,
        note: req.body.note || '已提交整改说明，等待重新质检',
        from_status: qualityCase.status
      }));
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canManageQualityCase(req, qualityCase)) return res.status(403).json({ error: '权限不足' });
    if (qualityCase.status === 'closed') return res.status(409).json({ error: '已关闭问题单不能提交整改' });

    db.prepare(`
      UPDATE process_governance_quality_cases
      SET status='submitted', updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(qualityCase.id);
    addQualityCaseEvent(qualityCase.id, 'submitted', req.session.userId, req.body.note || '已提交整改说明，等待重新质检', {
      from_status: qualityCase.status
    });
    return sendCaseWithEvents(res, qualityCase.id);
  });
});

router.post('/quality-cases/:id/close', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canCloseQualityCaseAsync(req)) return res.status(403).json({ error: '权限不足' });
      if (qualityCase.status !== 'source_resolved') {
        return res.status(409).json({ error: '只有重新质检未再出现的问题单才能关闭' });
      }
      const resolution = String(req.body.resolution || '').trim();
      const reason = String(req.body.reason || '').trim();
      if (resolution === 'not_an_issue' && !reason) {
        return res.status(400).json({ error: '说明这条核验项不是问题时，问题原因不能为空' });
      }
      const note = String(req.body.note || (resolution === 'not_an_issue' ? reason : '')).trim();
      if (!note) return res.status(400).json({ error: '关闭说明不能为空' });
      const closeGate = await closeGateOrSend(res, repo, 'quality', qualityCase, {
        actor_user_id: req.session.userId,
        note,
        resolution,
        reason,
        from_status: qualityCase.status
      });
      if (!closeGate) return null;
      return res.json(await repo.closeQualityCase(qualityCase.id, {
        actor_user_id: req.session.userId,
        note,
        from_status: qualityCase.status,
        resolution,
        reason,
        close_gate: closeGate
      }));
    });
  }
  return res.status(503).json({ error: '关闭卡口仅支持 MySQL' });
});

router.post('/quality-cases/:id/reopen', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const qualityCase = await repo.getQualityCase(parseCaseId(req));
      if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
      if (!await canCloseQualityCaseAsync(req)) return res.status(403).json({ error: '权限不足' });
      return res.json(await repo.reopenQualityCase(qualityCase.id, {
        actor_user_id: req.session.userId,
        note: req.body.note || '手动重开治理问题单',
        from_status: qualityCase.status
      }));
    });
  }
  return runDbAction(res, () => {
    const qualityCase = loadQualityCase(parseCaseId(req));
    if (!qualityCase) return res.status(404).json({ error: '问题单不存在' });
    if (!canCloseQualityCase(req)) return res.status(403).json({ error: '权限不足' });

    db.prepare(`
      UPDATE process_governance_quality_cases
      SET status='reopened',
          reopened_count=reopened_count + CASE WHEN status='reopened' THEN 0 ELSE 1 END,
          closed_by=NULL,
          closed_at=NULL,
          closure_note=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(qualityCase.id);
    addQualityCaseEvent(qualityCase.id, 'reopened', req.session.userId, req.body.note || '手动重开治理问题单', {
      from_status: qualityCase.status
    });
    return sendCaseWithEvents(res, qualityCase.id);
  });
});

router.get('/issue-pool/queues', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const departmentName = await currentIssuePoolDepartmentNameAsync(req);
    const queues = await repo.listQueues({ departmentName });
    return res.json({
      dataStatus: 'ready',
      departmentName: departmentName || '全部部门',
      queues: mapIssueQueues(queues.items || [])
    });
  });
});

router.get('/issue-pool/issues', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const departmentName = await currentIssuePoolDepartmentNameAsync(req);
    return res.json(await repo.listIssues({
      departmentName,
      queue: req.query.queue,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  });
});

router.get('/issue-pool/issues/:issueId', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const detail = await repo.getIssueDetail(Number(req.params.issueId || 0));
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    if (!await canAccessIssuePoolDetailAsync(req, detail)) return res.status(403).json({ error: '只能查看本部门相关问题' });
    return res.json(detail);
  });
});

function registerIssuePoolPointAction(actionName, routeName) {
  router.post(`/issue-pool/points/:pointId/${routeName}`, requireAuth, (req, res) => {
    return runAsyncAction(res, async () => {
      const repo = await issuePoolRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const pointId = Number(req.params.pointId || 0);
      const detail = await issuePoolDetailForPoint(repo, pointId);
      if (!detail || !detail.issue) return res.status(404).json({ error: '问题点不存在' });
      if (!await canApplyIssuePoolPointActionAsync(req, detail, actionName)) {
        return res.status(403).json({ error: '当前账户不能处理这个问题点' });
      }
      const result = await repo.applyPointAction(Number(req.params.pointId || 0), {
        action: actionName,
        selectedOption: req.body.selected_option || req.body.selectedOption || null,
        handlingMethod: req.body.handling_method || req.body.handlingMethod || '',
        handlingReason: req.body.handling_reason || req.body.handlingReason || '',
        note: req.body.note || '',
        ...(await issuePoolActor(req))
      });
      if (!result) return res.status(404).json({ error: '问题点不存在' });
      if (result.blocked) return res.status(409).json({ error: result.reason || '当前问题点缺少确认依据', ...result });
      return res.json(result);
    });
  });
}

registerIssuePoolPointAction('confirm', 'confirm');
registerIssuePoolPointAction('review', 'review');
registerIssuePoolPointAction('collaborate', 'collaborate');
registerIssuePoolPointAction('studio-review', 'studio-review');
registerIssuePoolPointAction('mdm-decision', 'mdm-decision');

router.post('/issue-pool/issues/:issueId/comment', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: '说明不能为空' });
    const issueId = Number(req.params.issueId || 0);
    const current = await repo.getIssueDetail(issueId);
    if (!current || !current.issue) return res.status(404).json({ error: '问题不存在' });
    if (!await canDepartmentActOnIssuePoolAsync(req, current)) return res.status(403).json({ error: '当前账户不能备注这个问题' });
    const detail = await repo.addIssueComment(issueId, {
      note,
      ...(await issuePoolActor(req))
    });
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    return res.json(detail);
  });
});

router.post('/issue-pool/issues/:issueId/close', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const issueId = Number(req.params.issueId || 0);
    const current = await repo.getIssueDetail(issueId);
    if (!current || !current.issue) return res.status(404).json({ error: '问题不存在' });
    if (!await canCloseIssuePoolAsync(req, current)) return res.status(403).json({ error: '当前账户不能关闭这个问题' });
    const detail = await repo.closeIssue(issueId, {
      note: req.body.note || '已关闭问题卡',
      ...(await issuePoolActor(req))
    });
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    return res.json(detail);
  });
});

router.post('/issue-pool/issues/:issueId/reopen', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const issueId = Number(req.params.issueId || 0);
    const current = await repo.getIssueDetail(issueId);
    if (!current || !current.issue) return res.status(404).json({ error: '问题不存在' });
    if (!await canCloseIssuePoolAsync(req, current)) return res.status(403).json({ error: '当前账户不能重开这个问题' });
    const detail = await repo.reopenIssue(issueId, {
      note: req.body.note || '已重新打开问题卡',
      ...(await issuePoolActor(req))
    });
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    return res.json(detail);
  });
});

router.post('/issue-pool/term-tasks', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    if (!await canDecideIssuePoolAsync(req)) return res.status(403).json({ error: '当前账户不能创建术语统一待办' });
    const detail = await repo.getIssueDetail(Number(req.body.issue_id || 0));
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    const selectedDepartments = Array.isArray(req.body.selected_departments) ? req.body.selected_departments : [];
    const result = await repo.createTermTask({
      issueId: Number(req.body.issue_id || 0),
      pointId: req.body.point_id ? Number(req.body.point_id) : null,
      termText: req.body.term_text,
      contextText: req.body.context_text || '',
      selectedDepartments,
      createdBy: req.session.userId
    });
    return res.json(result);
  });
});

router.post('/issue-pool/term-tasks/:termTaskId/answer', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const task = await issuePoolTermTask(repo, Number(req.params.termTaskId || 0));
    if (!task) return res.status(404).json({ error: '术语待办不存在' });
    const detail = await repo.getIssueDetail(Number(task.issue_id || 0));
    const actorDepartmentName = await currentDepartmentNameAsync(req);
    const requestedDepartmentName = req.body.department_name || actorDepartmentName;
    if (!await canAnswerIssuePoolTermTaskAsync(req, task, detail, requestedDepartmentName)) {
      return res.status(403).json({ error: '当前账户不能回复这个术语待办' });
    }
    const result = await repo.answerTermTask(Number(req.params.termTaskId || 0), {
      departmentName: requestedDepartmentName,
      answer: req.body.answer || '',
      note: req.body.note || '',
      actorUserId: req.session.userId
    });
    if (!result.success) return res.status(404).json({ error: '术语待办不存在' });
    return res.json(result);
  });
});

router.post('/issue-pool/term-tasks/:termTaskId/decision', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const task = await issuePoolTermTask(repo, Number(req.params.termTaskId || 0));
    if (!task) return res.status(404).json({ error: '术语待办不存在' });
    const detail = await repo.getIssueDetail(Number(task.issue_id || 0));
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    if (!await canDecideIssuePoolAsync(req)) return res.status(403).json({ error: '当前账户不能裁决术语待办' });
    const result = await repo.decideTermTask(Number(req.params.termTaskId || 0), {
      decision: req.body.decision || {},
      decidedBy: req.session.userId
    });
    if (!result.success) return res.status(404).json({ error: '术语待办不存在' });
    return res.json(result);
  });
});

router.post('/issue-pool/batches/generate', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await canGenerateIssuePoolAsync(req)) return res.status(403).json({ error: '权限不足' });
    const repo = await issuePoolRepositoryOrSendUnavailable(res);
    if (!repo) return null;
    const body = req.body || {};
    const departmentName = Object.prototype.hasOwnProperty.call(body, 'department_name')
      ? body.department_name
      : await currentIssuePoolDepartmentNameAsync(req);
    return res.json(await repo.generateIssuePool({
      departmentName,
      generatedBy: req.session.userId,
      sourceType: 'process_mapping'
    }));
  });
});

router.get('/mapping-workspace', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const canViewAll = await canViewAllMappingTodosAsync(req);
      const departmentName = await currentDepartmentNameAsync(req);
      return res.json(await repo.getMappingWorkspace({
        type: req.query.type,
        status: req.query.status,
        dept: req.query.dept,
        canViewAll,
        departmentName
      }));
    });
  }
  return runDbAction(res, () => {
    const params = [];
    let whereSql = 'WHERE 1=1';
    let sql = `
      SELECT r.*, parent.l3_name AS parent_l3_name
      FROM process_mapping_records r
      LEFT JOIN process_mapping_records parent ON parent.id = r.parent_record_id
    `;

    if (['l3', 'a1'].includes(String(req.query.type || ''))) {
      whereSql += ' AND r.record_type=?';
      params.push(String(req.query.type));
    }
    if (MAPPING_RECORD_STATUSES.has(String(req.query.status || ''))) {
      whereSql += ' AND r.status=?';
      params.push(String(req.query.status));
    }
    if (req.query.dept) {
      whereSql += ' AND r.dept_name=?';
      params.push(String(req.query.dept));
    }

    if (!canViewAllMappingTodos(req)) {
      const department = req.session.departmentId
        ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
        : null;
      whereSql += ' AND r.dept_name=?';
      params.push(department && department.name || '__none__');
    }

    const summaryRows = db.prepare(`
      SELECT r.record_type, r.status, COUNT(*) AS count
      FROM process_mapping_records r
      ${whereSql}
      GROUP BY r.record_type, r.status
    `).all(...params);
    const summary = mappingRecordSummaryFromRows(summaryRows);

    sql += `
      ${whereSql}
      ORDER BY CASE r.record_type WHEN 'l3' THEN 0 ELSE 1 END,
               r.dept_name, r.l2_name, r.l3_name, r.a1_code, r.id
      LIMIT 500
    `;
    const items = db.prepare(sql).all(...params).map(row => ({
      ...row,
      suggested_systems: parseJsonArray(row.suggested_systems)
    }));
    return res.json({ summary: { ...summary, returned: items.length, limit: 500 }, items });
  });
});

router.get('/mapping-todos', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const canViewAll = await canViewAllMappingTodosAsync(req);
      const departmentName = await currentDepartmentNameAsync(req);
      return res.json(await repo.getMappingTodos({
        type: req.query.type,
        status: req.query.status,
        dept: req.query.dept,
        owner: req.query.owner,
        userId: req.session.userId,
        departmentId: req.session.departmentId || -1,
        canViewAll,
        departmentName
      }));
    });
  }
  return runDbAction(res, () => {
    const params = [];
    let whereSql = 'WHERE 1=1';
    let sql = mappingTodoSelectSql();

    const type = String(req.query.type || '');
    if (MAPPING_TODO_TYPES.has(type)) {
      whereSql += ' AND t.todo_type=?';
      params.push(type);
    }
    const status = String(req.query.status || '');
    if (MAPPING_TODO_STATUSES.has(status)) {
      whereSql += ' AND t.status=?';
      params.push(status);
    }
    if (req.query.dept) {
      whereSql += ' AND (t.dept_name=? OR t.target_dept_name=?)';
      params.push(String(req.query.dept), String(req.query.dept));
    }
    if (req.query.owner === 'me') {
      whereSql += ' AND t.owner_user_id=?';
      params.push(req.session.userId);
    } else if (req.query.owner) {
      whereSql += ' AND t.owner_user_id=?';
      params.push(Number(req.query.owner));
    }

    if (!canViewAllMappingTodos(req)) {
      const department = req.session.departmentId
        ? db.prepare('SELECT name FROM departments WHERE id=?').get(req.session.departmentId)
        : null;
      whereSql += ` AND (
        t.dept_name=?
        OR t.target_dept_name=?
        OR (
          t.dept_name IS NULL
          AND t.target_dept_name IS NULL
          AND (t.owner_user_id=? OR t.owner_dept_id=?)
        )
      )`;
      params.push(department && department.name || '__none__', department && department.name || '__none__', req.session.userId, req.session.departmentId || -1);
    }

    const summaryRows = db.prepare(`
      SELECT t.todo_type, t.status, COUNT(*) AS count
      FROM process_mapping_todos t
      ${whereSql}
      GROUP BY t.todo_type, t.status
    `).all(...params);
    const summary = mappingTodoSummaryFromRows(summaryRows);

    sql += `
      ${whereSql}
      ORDER BY CASE t.status
                 WHEN 'open' THEN 0
                 WHEN 'reopened' THEN 1
                 WHEN 'assigned' THEN 2
                 WHEN 'rectifying' THEN 3
                 WHEN 'submitted' THEN 4
                 WHEN 'source_resolved' THEN 5
                 WHEN 'accepted' THEN 6
                 WHEN 'closed' THEN 7
                 ELSE 8
               END,
               CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               t.due_date IS NULL, t.due_date, t.dept_name, t.id
      LIMIT 500
    `;
    const items = db.prepare(sql).all(...params);
    return res.json({ summary: { ...summary, returned: items.length, limit: 500 }, items });
  });
});

router.get('/mapping-todos/:id', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canViewMappingTodoAsync(req, todo)) {
        return res.status(403).json({ error: '权限不足' });
      }
      return res.json({ todo, events: await repo.getMappingTodoEvents(todo.id) });
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canViewMappingTodo(req, todo)) {
      return res.status(403).json({ error: '权限不足' });
    }
    return res.json({ todo, events: mappingTodoEvents(todo.id) });
  });
});

router.post('/mapping-todos/:id/assign', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canManageMappingTodoAsync(req, todo)) return res.status(403).json({ error: '权限不足' });
      if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能分派' });

      const ownerUserId = req.body.owner_user_id ? Number(req.body.owner_user_id) : null;
      const assignment = await resolveOwnerAssignmentAsync(ownerUserId, req.body.owner_dept_id ? Number(req.body.owner_dept_id) : null);
      if (assignment.error) return res.status(400).json({ error: assignment.error });
      const priority = String(req.body.priority || todo.priority || 'medium');
      if (!QUALITY_CASE_PRIORITIES.has(priority)) return res.status(400).json({ error: '优先级无效' });
      return res.json(await repo.assignMappingTodo(todo.id, {
        owner_user_id: ownerUserId,
        owner_dept_id: assignment.ownerDeptId,
        priority,
        due_date: req.body.due_date ? String(req.body.due_date) : null,
        actor_user_id: req.session.userId,
        note: req.body.note || '已分派流程映射待办'
      }));
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canManageMappingTodo(req, todo)) return res.status(403).json({ error: '权限不足' });
    if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能分派' });

    const ownerUserId = req.body.owner_user_id ? Number(req.body.owner_user_id) : null;
    if (ownerUserId && !db.prepare('SELECT id FROM users WHERE id=?').get(ownerUserId)) {
      return res.status(400).json({ error: '责任人不存在' });
    }
    const ownerDeptId = getOwnerDeptId(ownerUserId, req.body.owner_dept_id ? Number(req.body.owner_dept_id) : null);
    if (ownerDeptId && !db.prepare('SELECT id FROM departments WHERE id=?').get(ownerDeptId)) {
      return res.status(400).json({ error: '责任部门不存在' });
    }
    const priority = String(req.body.priority || todo.priority || 'medium');
    if (!QUALITY_CASE_PRIORITIES.has(priority)) return res.status(400).json({ error: '优先级无效' });
    const dueDate = req.body.due_date ? String(req.body.due_date) : null;

    db.prepare(`
      UPDATE process_mapping_todos
      SET owner_user_id=COALESCE(?, owner_user_id),
          owner_dept_id=COALESCE(?, owner_dept_id),
          priority=?,
          due_date=?,
          status='assigned',
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(ownerUserId, ownerDeptId, priority, dueDate, todo.id);
    addMappingTodoEvent(todo.id, 'assigned', req.session.userId, req.body.note || '已分派流程映射待办', {
      owner_user_id: ownerUserId,
      owner_dept_id: ownerDeptId,
      priority,
      due_date: dueDate
    });
    return sendMappingTodoWithEvents(res, todo.id);
  });
});

router.post('/mapping-todos/:id/status', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canManageMappingTodoAsync(req, todo)) return res.status(403).json({ error: '权限不足' });
      const nextStatus = String(req.body.status || '');
      if (!USER_SET_MAPPING_TODO_STATUSES.has(nextStatus)) return res.status(400).json({ error: '状态无效' });
      if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能直接改状态' });
      return res.json(await repo.updateMappingTodoStatus(todo.id, {
        status: nextStatus,
        actor_user_id: req.session.userId,
        note: req.body.note || null,
        from_status: todo.status
      }));
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canManageMappingTodo(req, todo)) return res.status(403).json({ error: '权限不足' });
    const nextStatus = String(req.body.status || '');
    if (!USER_SET_MAPPING_TODO_STATUSES.has(nextStatus)) return res.status(400).json({ error: '状态无效' });
    if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能直接改状态' });

    db.prepare('UPDATE process_mapping_todos SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nextStatus, todo.id);
    addMappingTodoEvent(todo.id, 'status_changed', req.session.userId, req.body.note || null, {
      from_status: todo.status,
      to_status: nextStatus
    });
    return sendMappingTodoWithEvents(res, todo.id);
  });
});

router.post('/mapping-todos/:id/comment', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canViewMappingTodoAsync(req, todo)) {
        return res.status(403).json({ error: '权限不足' });
      }
      const note = String(req.body.note || '').trim();
      if (!note) return res.status(400).json({ error: '备注不能为空' });
      return res.json(await repo.addMappingTodoComment(todo.id, {
        actor_user_id: req.session.userId,
        note
      }));
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canViewMappingTodo(req, todo)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: '备注不能为空' });
    addMappingTodoEvent(todo.id, 'commented', req.session.userId, note, null);
    db.prepare('UPDATE process_mapping_todos SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(todo.id);
    return sendMappingTodoWithEvents(res, todo.id);
  });
});

router.post('/mapping-todos/:id/submit', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canManageMappingTodoAsync(req, todo)) return res.status(403).json({ error: '权限不足' });
      if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能提交' });
      return res.json(await repo.submitMappingTodo(todo.id, {
        actor_user_id: req.session.userId,
        note: req.body.note || '已提交流程映射处理说明',
        from_status: todo.status
      }));
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canManageMappingTodo(req, todo)) return res.status(403).json({ error: '权限不足' });
    if (todo.status === 'closed') return res.status(409).json({ error: '已关闭待办不能提交' });

    db.prepare('UPDATE process_mapping_todos SET status=\'submitted\', updated_at=CURRENT_TIMESTAMP WHERE id=?').run(todo.id);
    addMappingTodoEvent(todo.id, 'submitted', req.session.userId, req.body.note || '已提交流程映射处理说明', {
      from_status: todo.status
    });
    return sendMappingTodoWithEvents(res, todo.id);
  });
});

router.post('/mapping-todos/:id/close', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canCloseMappingTodoAsync(req)) return res.status(403).json({ error: '权限不足' });
      if (todo.status !== 'source_resolved') {
        return res.status(409).json({ error: '只有重新导入后未再出现的映射待办才能关闭' });
      }
      const resolution = String(req.body.resolution || '').trim();
      const reason = String(req.body.reason || '').trim();
      if (resolution === 'not_an_issue' && !reason) {
        return res.status(400).json({ error: '说明这条核验项不是问题时，问题原因不能为空' });
      }
      const note = String(req.body.note || (resolution === 'not_an_issue' ? reason : '')).trim();
      if (!note) return res.status(400).json({ error: '关闭说明不能为空' });
      const closeGate = await closeGateOrSend(res, repo, 'mapping', todo, {
        actor_user_id: req.session.userId,
        note,
        resolution,
        reason,
        from_status: todo.status
      });
      if (!closeGate) return null;
      return res.json(await repo.closeMappingTodo(todo.id, {
        actor_user_id: req.session.userId,
        note,
        from_status: todo.status,
        resolution,
        reason,
        close_gate: closeGate
      }));
    });
  }
  return res.status(503).json({ error: '关闭卡口仅支持 MySQL' });
});

router.post('/mapping-todos/:id/reopen', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepositoryOrSendUnavailable(res);
      if (!repo) return null;
      const todo = await repo.getMappingTodo(Number(req.params.id || 0));
      if (!todo) return res.status(404).json({ error: '映射待办不存在' });
      if (!await canCloseMappingTodoAsync(req)) return res.status(403).json({ error: '权限不足' });
      return res.json(await repo.reopenMappingTodo(todo.id, {
        actor_user_id: req.session.userId,
        note: req.body.note || '手动重开流程映射待办',
        from_status: todo.status
      }));
    });
  }
  return runDbAction(res, () => {
    const todo = loadMappingTodo(Number(req.params.id || 0));
    if (!todo) return res.status(404).json({ error: '映射待办不存在' });
    if (!canCloseMappingTodo(req)) return res.status(403).json({ error: '权限不足' });

    db.prepare(`
      UPDATE process_mapping_todos
      SET status='reopened',
          reopened_count=reopened_count + CASE WHEN status='reopened' THEN 0 ELSE 1 END,
          closed_by=NULL,
          closed_at=NULL,
          closure_note=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(todo.id);
    addMappingTodoEvent(todo.id, 'reopened', req.session.userId, req.body.note || '手动重开流程映射待办', {
      from_status: todo.status
    });
    return sendMappingTodoWithEvents(res, todo.id);
  });
});

router.get('/input-baseline-review/runs', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const artifactRuns = listReviewRuns();
    const byRunId = new Map(artifactRuns.map(item => [item.run_id, item]));
    const repo = await inputBaselineReviewRepositoryOrNull();
    if (repo) {
      const storedRuns = await repo.listRuns();
      for (const item of storedRuns) {
        byRunId.set(item.run_id, { ...item, ...(byRunId.get(item.run_id) || {}) });
      }
    }
    let items = [...byRunId.values()];
    const departmentName = await currentInputBaselineReviewDepartmentName(req);
    if (departmentName) {
      const scoped = [];
      for (const item of items) {
        const scopedItem = await scopedReviewRunForDepartment(item, departmentName, repo);
        if (scopedItem) scoped.push(scopedItem);
      }
      items = scoped;
    }
    items.sort((left, right) => right.run_id.localeCompare(left.run_id));
    res.json({ summary: { total: items.length }, items });
  });
});

router.get('/input-baseline-review/runs/:runId/review-items', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const bundle = loadReviewRunBundle(req.params.runId);
    const requestedFilters = {
      dept: req.query.dept,
      document: req.query.document,
      type: req.query.type
    };
    const departmentName = await currentInputBaselineReviewDepartmentName(req);
    const filters = scopedInputBaselineReviewFilters(requestedFilters, departmentName);
    const repo = await inputBaselineReviewRepositoryOrNull();
    if (repo) {
      try {
        const runDir = reviewRunDir(req.params.runId);
        const itemsPath = runDir && path.join(runDir, 'mapping_diff_items.json');
        if (itemsPath && fs.existsSync(itemsPath)) {
          await repo.upsertBundle(loadProcessReviewRunBundle(runDir));
        }
        const stored = await repo.getReviewItems(req.params.runId, filters);
        if (stored.items.length || !bundle) {
          return res.json({
            run: bundle ? bundle.run : { run_id: req.params.runId, issue_count: stored.items.length },
            ...stored
          });
        }
      } catch (error) {
        if (!bundle) throw error;
        if (process.env.MDM_DB_QUIET !== '1') {
          console.warn(`input baseline review MySQL read failed; falling back to artifact run ${req.params.runId}: ${error.message}`);
        }
      }
    }
    if (!bundle) return res.status(404).json({ error: '问题识别批次不存在' });
    res.json(inputBaselineReviewPayloadFromBundle(bundle, filters));
  });
});

router.put('/input-baseline-review/runs/:runId/review-items/:stableKey/review', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const safeId = safeRunId(req.params.runId);
    if (!safeId) return res.status(400).json({ error: '问题识别批次编号无效' });
    const stableKey = String(req.params.stableKey || '').trim();
    if (!stableKey) return res.status(400).json({ error: '待确认问题编号无效' });

    const runDir = reviewRunDir(safeId);
    const itemsPath = path.join(runDir, 'mapping_diff_items.json');
    if (!fs.existsSync(itemsPath)) return res.status(404).json({ error: '问题识别批次不存在' });

    let repo;
    try {
      repo = await inputBaselineReviewRepository();
    } catch (error) {
      console.error(error);
      return res.status(503).json({ error: '输入基线问题复核 MySQL 不可用' });
    }

    const bundle = loadProcessReviewRunBundle(runDir);
    const reviewItem = bundle.items.find(item => item.stable_key === stableKey);
    if (!reviewItem) return res.status(404).json({ error: '待确认问题不存在' });
    const departmentName = await currentInputBaselineReviewDepartmentName(req);
    if (!await canAccessInputBaselineReviewItemAsync(req, reviewItem, departmentName)) {
      return res.status(403).json({ error: '只能处理本部门待确认问题' });
    }

    await repo.upsertBundle(bundle);
    const review = await repo.saveDecision(safeId, stableKey, normalizeReviewPayload({
      ...req.body,
      reviewer: req.session.userName || String(req.session.userId || '') || req.body.reviewer
    }));

    return res.json({
      run: bundle.run,
      reviewItem: {
        stable_key: reviewItem.stable_key,
        department: reviewItem.department,
        document_name: reviewItem.document_name,
        issue_type: reviewItem.issue_type,
        content: reviewItem.content,
        source_label: reviewItem.source_label
      },
      review
    });
  });
});

router.get('/chains', requireAuth, (req, res) => {
  if (useMysqlProcessGovernanceReadModel()) {
    return runAsyncAction(res, async () => {
      const repo = await processGovernanceRepository();
      const items = await repo.getInteractionChains();
      return res.json({ items });
    });
  }
  return runDbAction(res, () => {
    const snapshot = activeSnapshot();
    if (!snapshot) return res.json({ items: [] });
    const items = db.prepare(`
      SELECT *
      FROM process_interaction_chains
      WHERE snapshot_id=?
      ORDER BY id
    `).all(snapshot.id).map(row => ({
      ...row,
      breaks: parseJsonArray(row.breaks_json)
    }));
    res.json({ items });
  });
});

router.setInputBaselineReviewRepositoryFactory = setInputBaselineReviewRepositoryFactory;
router.resetInputBaselineReviewRepositoryFactory = resetInputBaselineReviewRepositoryFactory;
router.setProcessGovernanceRepositoryFactory = setProcessGovernanceRepositoryFactory;
router.resetProcessGovernanceRepositoryFactory = resetProcessGovernanceRepositoryFactory;
router.setIssuePoolRepositoryFactory = setIssuePoolRepositoryFactory;
router.resetIssuePoolRepositoryFactory = resetIssuePoolRepositoryFactory;

module.exports = router;
