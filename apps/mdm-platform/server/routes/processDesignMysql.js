const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getDepartmentByIdAsync
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');

const PROJECT_WIDE_ROLES = new Set(['admin', 'it_lead']);
const REVIEW_ROLES = new Set(['admin', 'it_lead', 'reviewer', 'owner', 'data_quality', 'decision_group']);
const DEPT_CREATE_ROLES = new Set(['submitter', 'business_contact']);
const FIELD_STATUSES = new Set(['suggested', 'business_confirmed', 'data_governed', 'published', 'retired']);
const DRAFT_STATUSES = new Set(['draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'published', 'rejected']);
const CLASSIFICATION_STATUSES = new Set(['unclassified', 'needs_review', 'confirmed']);
const TABLE_KINDS = new Set(['main', 'detail']);
const HANDOFF_STATUSES = new Set(['pending_return', 'returned', 'pending_review', 'confirmed']);
const PROCESS_TYPES = new Set(['new', 'inherit', 'handoff', 'adjustment']);
const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'needs_changes']);
const BASIS_TYPES = new Set(['现场实际', '制度 / 规程', '表单 / 台账', '会议 / 访谈', '暂无证据']);
const FIELD_TYPES = new Set(['文本', '数字', '日期', '金额', '枚举', '布尔', '部门', '人员', '附件']);
const EVIDENCE_TYPES = new Set(['制度条款', '表单样例', '访谈记录', '会议纪要', '流程图', '台账记录', '暂无证据']);
const REPO_ROOT = path.resolve(__dirname, '../../../..');

let repositoryFactory = null;
let repositoryPromise = null;

function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function httpError(statusCode, message, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload || { error: message };
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function optionalText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function hasWhitespace(value) {
  return /\s/.test(String(value || ''));
}

function enumDetail(field, message) {
  return { field, message };
}

function assertNoManualNumber(body, field, label) {
  if (Object.prototype.hasOwnProperty.call(body || {}, field) && text(body[field])) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [enumDetail(field, `${label}由系统自动生成，不能手填`)] });
  }
}

function assertNoWhitespaceFields(body, fields) {
  const details = fields
    .filter(field => Object.prototype.hasOwnProperty.call(body || {}, field) && hasWhitespace(body[field]))
    .map(field => enumDetail(field, '字段内容不能包含空格'));
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
}

function assertEnum(body, field, allowed, label, options = {}) {
  const value = text(body && body[field]);
  if (!value && options.optional) return null;
  if (!allowed.has(value)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [enumDetail(field, `${label}必须从系统选项中选择`)] });
  }
  return value;
}

function boolInt(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => text(item)).filter(Boolean));
  const single = text(value);
  return single ? JSON.stringify([single]) : JSON.stringify([]);
}

function splitMarkdownRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isMarkdownSeparator(cells) {
  return (cells || []).length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(String(cell || '').replace(/\s/g, '')));
}

function headerIndex(header, names) {
  return header.findIndex(cell => names.some(name => String(cell || '').includes(name)));
}

function parseProcessTaxonomyMarkdown(markdown, sourceFile) {
  const rows = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let header = null;
  let indexes = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (header && rows.length) break;
      continue;
    }
    const cells = splitMarkdownRow(trimmed);
    if (!header && cells.some(cell => cell.includes('能力域')) && cells.some(cell => cell.includes('业务能力'))) {
      header = cells;
      indexes = {
        dept: headerIndex(header, ['部门（D1）', '部门']),
        l1: headerIndex(header, ['能力域（L1）', '能力域']),
        l2: headerIndex(header, ['业务能力（L2）', '业务能力']),
        l3: headerIndex(header, ['业务流程（L3）', '业务流程'])
      };
      continue;
    }
    if (!header || !indexes) continue;
    if (isMarkdownSeparator(cells)) continue;
    const l1Name = text(cells[indexes.l1]);
    const l2Name = text(cells[indexes.l2]);
    if (!l1Name || !l2Name || l1Name.includes('能力域') || l2Name.includes('业务能力')) continue;
    rows.push({
      l1_name: l1Name,
      l2_name: l2Name,
      l3_name: text(cells[indexes.l3]),
      department_name: text(cells[indexes.dept]),
      source_file: sourceFile || null
    });
  }
  return rows;
}

function buildProcessTaxonomyPayload(rows) {
  const byPair = new Map();
  for (const row of rows || []) {
    const l1Name = text(row.l1_name);
    const l2Name = text(row.l2_name);
    if (!l1Name || !l2Name) continue;
    const key = `${l1Name}\n${l2Name}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        l1_name: l1Name,
        l2_name: l2Name,
        l3_count: 0,
        departments: new Set(),
        source_files: new Set()
      });
    }
    const item = byPair.get(key);
    if (text(row.l3_name)) item.l3_count += 1;
    if (text(row.department_name)) item.departments.add(text(row.department_name));
    if (text(row.source_file)) item.source_files.add(text(row.source_file));
  }
  const items = [...byPair.values()]
    .map(item => ({
      l1_name: item.l1_name,
      l2_name: item.l2_name,
      l3_count: item.l3_count,
      departments: [...item.departments].sort((left, right) => left.localeCompare(right, 'zh-CN')),
      source_files: [...item.source_files].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    }))
    .sort((left, right) => (left.l1_name + left.l2_name).localeCompare(right.l1_name + right.l2_name, 'zh-CN'));
  const l1Options = [...new Set(items.map(item => item.l1_name))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return { items, l1Options };
}

function readProcessTaxonomyFromNorms() {
  const normsDir = path.join(REPO_ROOT, 'docs', 'norms');
  if (!fs.existsSync(normsDir)) return buildProcessTaxonomyPayload([]);
  const rows = [];
  for (const entry of fs.readdirSync(normsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('部门-能力-流程-系统映射关系.md')) continue;
    const relativePath = path.posix.join('docs/norms', entry.name);
    const fullPath = path.join(normsDir, entry.name);
    rows.push(...parseProcessTaxonomyMarkdown(fs.readFileSync(fullPath, 'utf8'), relativePath));
  }
  return buildProcessTaxonomyPayload(rows);
}

async function appendProcessTaxonomyValidation(repo, body, details) {
  const l1Name = text(body && body.l1_name);
  const l2Name = text(body && body.l2_name);
  if (!l1Name || !l2Name) return;
  const taxonomy = typeof repo.listProcessTaxonomy === 'function'
    ? await repo.listProcessTaxonomy()
    : buildProcessTaxonomyPayload([]);
  const items = taxonomy.items || [];
  if (!items.length) {
    details.push({ field: 'l1_name', message: '请先导入已有流程映射关系后再选择 L1/L2' });
    return;
  }
  const matched = items.some(item => text(item.l1_name) === l1Name && text(item.l2_name) === l2Name);
  if (!matched) {
    details.push({ field: 'l2_name', message: 'L1/L2 必须从已有映射关系中选择，暂不开放新增能力域或业务能力' });
  }
}

function publicDraft(row) {
  if (!row) return null;
  return {
    ...row,
    related_departments: parseJsonArray(row.related_departments_json),
    involves_other_departments: Boolean(row.involves_other_departments)
  };
}

function publicBehaviorDetail(row) {
  if (!row) return null;
  return {
    ...row,
    requires_approval: Boolean(row.requires_approval),
    is_cross_department: Boolean(row.is_cross_department)
  };
}

function publicProcess(row) {
  return row || null;
}

function publicHandoff(row) {
  return row || null;
}

function activeSteps(steps) {
  return (steps || []).filter(step => (step.status || 'active') === 'active');
}

function behaviorDetailHasContent(detail) {
  if (!detail) return false;
  if (detail.requires_approval || detail.is_cross_department) return true;
  return ['precondition', 'trigger_scene', 'execution_standard', 'delivery_object', 'approval_note']
    .some(field => Boolean(text(detail[field])));
}

function objectEventPayload(objectType, objectId, objectName, action) {
  return {
    metadata: {
      object_type: objectType,
      object_id: objectId,
      object_name: objectName || null,
      action
    }
  };
}

function publicFormTableField(row) {
  if (!row) return null;
  return {
    ...row,
    required: Boolean(row.is_required)
  };
}

function markdownList(items, renderItem) {
  if (!items || !items.length) return '- 暂未填写';
  return items.map(renderItem).join('\n');
}

function processDesignMarkdown(detail) {
  const draft = detail.draft || {};
  const profile = detail.documentProfile || {};
  const title = text(profile.document_title) || text(draft.process_name) || '未命名制度';
  const lines = [
    `# ${title}`,
    '',
    `- 制度编号：${text(profile.document_no) || '待定'}`,
    `- 对应流程数：${(detail.processes || []).length || 0}`,
    '',
    '## 目的',
    text(profile.purpose) || '待填写',
    '',
    '## 范围',
    text(profile.scope) || '待填写',
    '',
    '## 承继关系',
    text(profile.inheritance_relation) || '待填写',
    '',
    '## 术语',
    markdownList(detail.terms || [], term => `- ${text(term.term_name)}：${text(term.definition)}${text(term.applies_to) ? `（适用：${text(term.applies_to)}）` : ''}`),
    '',
    '## 流程',
    markdownList(detail.processes || [], process => `- ${text(process.process_code) || '未编号'} ${text(process.l1_name)} / ${text(process.l2_name)} / ${text(process.l3_name)}`),
    '',
    '## 业务行为',
    markdownList(activeSteps(detail.steps), step => {
      const process = (detail.processes || []).find(item => Number(item.id) === Number(step.process_id)) || {};
      const behavior = step.behaviorDetail || {};
      const handoffs = markdownList(step.handoffs || [], handoff => `  - 承接部门：${text(handoff.target_department)}；流程编号：${text(handoff.target_process_code) || '待定'}；流程：${text(handoff.target_process_name)}；业务行为：${text(handoff.target_behavior_name)}`);
      return [
        `### ${text(step.a1_code) || `A1-${step.id}`} ${text(step.step_name)}`,
        `- 所属流程：${text(process.l3_name) || '待确认'}`,
        `- 执行角色：${text(step.actor_role) || '待填写'}`,
        `- 前置条件：${text(behavior.precondition) || text(step.input_materials) || '待填写'}`,
        `- 触发场景：${text(behavior.trigger_scene) || '待填写'}`,
        `- 执行标准：${text(behavior.execution_standard) || '待填写'}`,
        `- 交付对象：${text(behavior.delivery_object) || text(step.output_result) || '待填写'}`,
        `- 是否需要审批：${behavior.requires_approval ? '是' : '否'}`,
        `- 是否跨部门：${behavior.is_cross_department ? '是' : '否'}`,
        '- 跨部门承接：',
        handoffs
      ].join('\n');
    }),
    '',
    '## 附表结构',
    markdownList(detail.forms || [], form => {
      const tables = markdownList(form.tables || [], table => {
        const fields = markdownList(table.fields || [], field => `    - ${text(field.field_no) || '未编号'} ${text(field.field_name)}：${text(field.field_type) || '待定'}${field.required ? '，必填' : ''}${text(field.description) ? `，${text(field.description)}` : ''}`);
        return [
          `  - ${table.table_kind === 'detail' ? '明细表' : '主表'}：${text(table.table_no) || '未编号'} ${text(table.table_name)}`,
          fields
        ].join('\n');
      });
      return [
        `### ${text(form.form_name)}`,
        `- 归档规则：${text(form.archive_rule) || '待填写'}`,
        tables
      ].join('\n');
    })
  ];
  return lines.join('\n');
}

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

function makeProcessDesignMysqlRepository(pool) {
  async function getById(table, id) {
    const [row] = await mysqlQuery(pool, `SELECT * FROM ${table} WHERE id=?`, [id]);
    return row || null;
  }

  async function addEvent(draftId, eventType, actorUserId, note, payload) {
    await mysqlRun(pool, `
      INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `, [draftId, eventType, actorUserId || null, optionalText(note), payload ? JSON.stringify(payload) : null]);
  }

  async function loadDocumentProfile(draftId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_document_profiles WHERE draft_id=?', [draftId]);
    return row || null;
  }

  async function loadTerms(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_terms WHERE draft_id=? ORDER BY sort_order, id', [draftId]);
  }

  async function loadProcesses(draftId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_processes WHERE draft_id=? ORDER BY sort_order, id', [draftId]);
    return rows.map(publicProcess);
  }

  async function loadBehaviorDetail(stepId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_behavior_details WHERE step_id=?', [stepId]);
    return publicBehaviorDetail(row);
  }

  async function loadHandoffs(stepId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE step_id=? ORDER BY sort_order, id', [stepId]);
    return rows.map(publicHandoff);
  }

  async function loadSteps(draftId) {
    const steps = await mysqlQuery(pool, 'SELECT * FROM process_design_steps WHERE draft_id=? ORDER BY process_id, sort_order, id', [draftId]);
    const result = [];
    for (const step of steps) {
      result.push({
        ...step,
        behaviorDetail: await loadBehaviorDetail(step.id),
        handoffs: await loadHandoffs(step.id)
      });
    }
    return result;
  }

  async function loadFormTableFields(tableId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_form_table_fields WHERE form_table_id=? ORDER BY sort_order, id', [tableId]);
    return rows.map(publicFormTableField);
  }

  async function loadFormTables(formId) {
    const tables = await mysqlQuery(pool, 'SELECT * FROM process_design_form_tables WHERE form_id=? ORDER BY sort_order, id', [formId]);
    const result = [];
    for (const table of tables) {
      result.push({ ...table, fields: await loadFormTableFields(table.id) });
    }
    return result;
  }

  async function loadForms(draftId) {
    const forms = await mysqlQuery(pool, 'SELECT * FROM process_design_forms WHERE draft_id=? ORDER BY id', [draftId]);
    const result = [];
    for (const form of forms) {
      const fields = await mysqlQuery(pool, 'SELECT * FROM process_design_form_fields WHERE form_id=? ORDER BY sort_order, id', [form.id]);
      result.push({ ...form, fields, tables: await loadFormTables(form.id) });
    }
    return result;
  }

  async function loadEvidence(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_evidence WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function loadEvents(draftId) {
    const rows = await mysqlQuery(pool, `
      SELECT e.*, u.name AS actor_user_name
      FROM process_design_events e
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.draft_id=?
      ORDER BY e.id
    `, [draftId]);
    return rows.map(row => ({
      ...row,
      payload: parseJsonObject(row.payload_json)
    }));
  }

  async function loadReviewTasks(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_review_tasks WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function getDraft(id) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*, dept.name AS department_name, proxyDept.name AS proxy_department_name, creator.name AS created_by_name
      FROM process_design_drafts d
      LEFT JOIN departments dept ON dept.id=d.department_id
      LEFT JOIN departments proxyDept ON proxyDept.id=d.proxy_department_id
      LEFT JOIN users creator ON creator.id=d.created_by
      WHERE d.id=?
    `, [id]);
    return publicDraft(row);
  }

  async function getDraftByStep(stepId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_steps s
      JOIN process_design_drafts d ON d.id=s.draft_id
      WHERE s.id=?
    `, [stepId]);
    return publicDraft(row);
  }

  async function getDraftByTerm(termId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_terms t
      JOIN process_design_drafts d ON d.id=t.draft_id
      WHERE t.id=?
    `, [termId]);
    return publicDraft(row);
  }

  async function getDraftByProcess(processId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_processes p
      JOIN process_design_drafts d ON d.id=p.draft_id
      WHERE p.id=?
    `, [processId]);
    return publicDraft(row);
  }

  async function getDraftByHandoff(handoffId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_cross_dept_handoffs h
      JOIN process_design_steps s ON s.id=h.step_id
      JOIN process_design_drafts d ON d.id=s.draft_id
      WHERE h.id=?
    `, [handoffId]);
    return publicDraft(row);
  }

  async function getHandoff(handoffId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE id=?', [handoffId]);
    return publicHandoff(row);
  }

  async function getDraftByForm(formId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_forms f
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE f.id=?
    `, [formId]);
    return publicDraft(row);
  }

  async function getDraftByFormTable(tableId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_tables ft
      JOIN process_design_forms f ON f.id=ft.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ft.id=?
    `, [tableId]);
    return publicDraft(row);
  }

  async function getDraftByFormTableField(fieldId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_table_fields ftf
      JOIN process_design_form_tables ft ON ft.id=ftf.form_table_id
      JOIN process_design_forms f ON f.id=ft.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ftf.id=?
    `, [fieldId]);
    return publicDraft(row);
  }

  async function getDraftByField(fieldId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_fields ff
      JOIN process_design_forms f ON f.id=ff.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ff.id=?
    `, [fieldId]);
    return publicDraft(row);
  }

  async function getDraftByEvidence(evidenceId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_evidence e
      JOIN process_design_drafts d ON d.id=e.draft_id
      WHERE e.id=?
    `, [evidenceId]);
    return publicDraft(row);
  }

  async function getCounts(draftId) {
    const [[processes], [steps], [forms], [fields], [tableFields], [evidence], [publishableEvidence], [terms], [handoffs]] = await Promise.all([
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_processes WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, "SELECT COUNT(*) AS count FROM process_design_steps WHERE draft_id=? AND status='active'", [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_forms WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_form_fields ff
        JOIN process_design_forms f ON f.id=ff.form_id
        WHERE f.draft_id=?
      `, [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_form_table_fields ftf
        JOIN process_design_form_tables ft ON ft.id=ftf.form_table_id
        JOIN process_design_forms f ON f.id=ft.form_id
        WHERE f.draft_id=?
      `, [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, "SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=? AND maturity='可支撑发布'", [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_terms WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_cross_dept_handoffs h
        JOIN process_design_steps s ON s.id=h.step_id
        WHERE s.draft_id=? AND s.status='active'
      `, [draftId])
    ]);
    const risks = (await buildRisks(draftId)).length;
    const fieldCount = Number(fields.count || 0);
    const tableFieldCount = Number(tableFields.count || 0);
    return {
      processes: Number(processes.count || 0),
      steps: Number(steps.count || 0),
      forms: Number(forms.count || 0),
      fields: fieldCount + tableFieldCount,
      formFields: fieldCount,
      tableFields: tableFieldCount,
      evidence: Number(evidence.count || 0),
      publishableEvidence: Number(publishableEvidence.count || 0),
      terms: Number(terms.count || 0),
      handoffs: Number(handoffs.count || 0),
      risks
    };
  }

  async function buildRisks(draftId) {
    const risks = [];
    const draft = await getDraft(draftId);
    if (!draft) return risks;
    const processes = await loadProcesses(draftId);
    if (!processes.length) {
      risks.push({ object_type: 'process', object_id: draft.id, message: '还没有添加制度对应的流程明细。', status: 'open' });
    }
    for (const process of processes) {
      if (!text(process.l1_name) || !text(process.l2_name) || !text(process.l3_name)) {
        risks.push({ object_type: 'process', object_id: process.id, message: '流程明细还没有写清 L1、L2 和 L3。', status: 'open' });
      }
    }
    const profile = await loadDocumentProfile(draftId);
    if (!profile || !text(profile.purpose) || !text(profile.scope)) {
      risks.push({ object_type: 'document', object_id: draft.id, message: '制度文档还没有写清目的和范围。', status: 'open' });
    }
    for (const step of activeSteps(await loadSteps(draftId))) {
      if (!text(step.output_result)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步做完后没有写清会产生什么结果。', status: 'open' });
      if (step.need_confirmation && !text(step.related_departments)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步需要别人确认，但还没有指定确认部门。', status: 'open' });
      const detail = step.behaviorDetail || {};
      if (!text(detail.execution_standard)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为还没有写清执行标准。', status: 'open' });
      if (!text(detail.delivery_object)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为还没有写清交付对象。', status: 'open' });
      if (detail.requires_approval && !text(detail.approval_note)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为需要审批，但还没有说明审批要求。', status: 'open' });
      if (!step.process_id) risks.push({ object_type: 'step', object_id: step.id, message: '这个业务行为还没有归属到具体流程。', status: 'open' });
      if (detail.is_cross_department && !(step.handoffs || []).some(handoff => text(handoff.target_process_name) && text(handoff.target_behavior_name))) {
        risks.push({ object_type: 'handoff', object_id: step.id, message: '这个业务行为涉及跨部门，正在等待承接部门回写流程和业务行为。', status: 'open' });
      }
    }
    for (const form of await loadForms(draftId)) {
      if (!text(form.archive_rule)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有归档规则。', status: 'open' });
      if (!(form.tables || []).length) risks.push({ object_type: 'form_table', object_id: form.id, message: '这个表单还没有设置主表或明细表结构。', status: 'open' });
      (form.tables || []).forEach(table => {
        if (!(table.fields || []).length) risks.push({ object_type: 'form_table', object_id: table.id, message: '这个附表还没有设置字段。', status: 'open' });
      });
      form.fields.forEach(field => {
        if (field.field_type === '枚举' && !text(field.enum_options)) risks.push({ object_type: 'field', object_id: field.id, message: '这个字段要从固定选项里选，但选项还没列出来。', status: 'open' });
        if (!text(field.data_object)) risks.push({ object_type: 'field', object_id: field.id, message: '这个字段还没有说明属于哪个数据对象。', status: 'open' });
      });
    }
    for (const evidence of await loadEvidence(draftId)) {
      if (evidence.maturity !== '可支撑发布') risks.push({ object_type: 'evidence', object_id: evidence.id, message: '这个依据还不够支撑正式发布。', status: 'open' });
    }
    const stored = await mysqlQuery(pool, `
      SELECT object_type, object_id, message, status
      FROM process_design_risks
      WHERE draft_id=? AND status NOT IN ('confirmed','accepted')
      ORDER BY id
    `, [draftId]);
    return [...risks, ...stored];
  }

  async function publishValidationDetails(draft, options = {}) {
    const details = [];
    if (draft.l1_status === 'needs_review' || draft.l2_status === 'needs_review') details.push('待确认 L1/L2 未复核前不能作为正式能力结构发布。');
    if (!options.relaxed) {
      if (draft.l1_status !== 'confirmed') details.push('L1 必须由审核人确认。');
      if (draft.l2_status !== 'confirmed') details.push('L2 必须由审核人确认。');
    }
    const processes = await loadProcesses(draft.id);
    if (!processes.length) details.push('发布前至少需要 1 个制度流程。');
    if (processes.some(process => !text(process.l1_name) || !text(process.l2_name) || !text(process.l3_name))) details.push('发布前每个制度流程都要写清 L1、L2 和 L3。');
    const profile = await loadDocumentProfile(draft.id);
    if (!profile || !text(profile.document_title)) details.push('发布前还需填写制度名称。');
    if (!profile || !text(profile.purpose)) details.push('发布前还需填写制度目的。');
    if (!profile || !text(profile.scope)) details.push('发布前还需填写制度范围。');
    const steps = activeSteps(await loadSteps(draft.id));
    if (!steps.length) details.push('发布前至少需要 1 个业务行为。');
    if (steps.some(step => !step.process_id)) details.push('发布前每个业务行为都要归属到具体流程。');
    if (steps.some(step => !text(step.output_result))) details.push('发布前每个步骤都要写清输出结果。');
    if (steps.some(step => !step.behaviorDetail || !text(step.behaviorDetail.execution_standard))) details.push('发布前每个业务行为都要写清执行标准。');
    if (steps.some(step => !step.behaviorDetail || !text(step.behaviorDetail.delivery_object))) details.push('发布前每个业务行为都要写清交付对象。');
    if (steps.some(step => step.behaviorDetail && step.behaviorDetail.is_cross_department && !(step.handoffs || []).some(handoff => text(handoff.target_process_name) && text(handoff.target_behavior_name)))) {
      details.push('发布前跨部门业务行为需要由承接部门回写承接流程和承接行为。');
    }
    const forms = await loadForms(draft.id);
    const fields = forms.flatMap(form => [
      ...(form.fields || []),
      ...(form.tables || []).flatMap(table => table.fields || [])
    ]);
    if (!fields.length) details.push('发布前至少需要 1 个字段。');
    if (forms.some(form => !text(form.archive_rule))) details.push('发布前在线表单需要归档规则。');
    if (forms.some(form => !(form.tables || []).length)) details.push('发布前每个在线表单至少需要 1 个主表或明细表。');
    if (forms.some(form => (form.tables || []).some(table => !(table.fields || []).length))) details.push('发布前每个附表至少需要 1 个字段。');
    if (fields.some(field => field.field_type === '枚举' && !text(field.enum_options))) details.push('发布前枚举字段需要列出固定选项。');
    const evidence = await loadEvidence(draft.id);
    if (!evidence.length) details.push('发布前至少需要 1 条证据。');
    if (evidence.length > 0 && !evidence.some(item => text(item.source_anchor))) details.push('发布前还需补 1 条来源锚点。');
    if (!evidence.some(item => item.maturity === '可支撑发布')) details.push('发布前至少需要 1 条可支撑发布的证据。');
    return Array.from(new Set(details));
  }

  async function outcomeForDraft(draft) {
    const counts = await getCounts(draft.id);
    const formed = [];
    if (draft.process_name) formed.push('1 条流程草稿');
    if (counts.processes) formed.push(`${counts.processes} 个制度流程`);
    if (counts.steps) formed.push(`${counts.steps} 个业务行为`);
    if (counts.forms) formed.push(`${counts.forms} 个在线表单`);
    if (counts.fields) formed.push(`${counts.fields} 个字段草稿`);
    if (counts.terms) formed.push(`${counts.terms} 个术语`);
    if (counts.handoffs) formed.push(`${counts.handoffs} 个跨部门承接`);
    if (counts.evidence) formed.push(`${counts.evidence} 条证据说明`);
    if (draft.status === 'published') formed.push('1 个发布版本');
    const missing = await publishValidationDetails(draft, { relaxed: true });
    return {
      formed: formed.length ? `已形成 ${formed.join('、')}` : '已形成 0 条治理资产',
      current: draft.status === 'published'
        ? '当前内容已经发布为数据库流程地图版本'
        : draft.status === 'submitted'
          ? '当前内容可以等待审核或继续补充材料'
          : '当前内容可以保存草稿或提交部门内审',
      missing,
      next: draft.status === 'published' ? '查看成果预览' : missing.length ? '继续补齐发布前缺项' : '提交审核或发布',
      counts
    };
  }

  async function versionContent(draft) {
    return {
      draft,
      documentProfile: await loadDocumentProfile(draft.id),
      terms: await loadTerms(draft.id),
      processes: await loadProcesses(draft.id),
      steps: activeSteps(await loadSteps(draft.id)),
      forms: await loadForms(draft.id),
      evidence: await loadEvidence(draft.id)
    };
  }

  async function projectPublishedVersionToProcessMap(draft, version) {
    const [snapshot] = await mysqlQuery(pool, `
      SELECT *
      FROM process_governance_snapshots
      WHERE status='active'
      ORDER BY imported_at DESC, id DESC
      LIMIT 1
    `);
    if (!snapshot) return;
    const processes = await loadProcesses(draft.id);
    const steps = activeSteps(await loadSteps(draft.id));
    const sourceFile = `process_design_versions:${version.id}`;
    for (const process of processes) {
      const l3Key = `process-design:${version.id}:process:${process.id}`;
      await mysqlRun(pool, `
        INSERT INTO process_mapping_records
          (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l2_name, l3_name, source_file, status)
        VALUES (?, 'l3', ?, ?, ?, ?, ?, ?, 'published')
        ON DUPLICATE KEY UPDATE latest_snapshot_id=VALUES(latest_snapshot_id), status='published'
      `, [l3Key, snapshot.id, snapshot.id, draft.department_name, process.l2_name, process.l3_name, sourceFile]);
      const [l3Record] = await mysqlQuery(pool, 'SELECT id FROM process_mapping_records WHERE mapping_key=?', [l3Key]);
      const processSteps = steps.filter(step => Number(step.process_id) === Number(process.id));
      for (let index = 0; index < processSteps.length; index += 1) {
        const step = processSteps[index];
        const behaviorDetail = step.behaviorDetail || {};
        const a1Code = text(step.a1_code) || `PD-${draft.id}-P${process.id}-A1-${String(index + 1).padStart(3, '0')}`;
        const approvalType = behaviorDetail.requires_approval ? '需审批' : (step.need_confirmation ? '需确认' : '记录');
        const outputTarget = text(behaviorDetail.delivery_object) || step.output_result || null;
        await mysqlRun(pool, 'UPDATE process_design_steps SET a1_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [a1Code, step.id]);
        const result = await mysqlRun(pool, `
          INSERT INTO process_a1_items
            (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
             input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          snapshot.id, a1Code, draft.department_name, process.l3_name, step.step_name,
          step.actor_role || null, approvalType,
          step.input_materials || text(behaviorDetail.precondition) || null, outputTarget, JSON.stringify([]),
          '由文档结构化输出发布', sourceFile
        ]);
        await mysqlRun(pool, `
          INSERT INTO process_mapping_records
            (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, parent_record_id, latest_a1_item_id,
             dept_name, l2_name, l3_name, a1_code, behavior, execution_role, approval_type,
             input_source_dept, output_target_dept, suggested_systems, verification_note, source_file, status)
          VALUES (?, 'a1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
          ON DUPLICATE KEY UPDATE latest_snapshot_id=VALUES(latest_snapshot_id), status='published'
        `, [
          `process-design:${version.id}:step:${step.id}`, snapshot.id, snapshot.id,
          l3Record && l3Record.id || null, result.insertId, draft.department_name,
          process.l2_name, process.l3_name, a1Code, step.step_name, step.actor_role || null,
          approvalType, step.input_materials || text(behaviorDetail.precondition) || null,
          outputTarget, JSON.stringify([]), '由文档结构化输出发布', sourceFile
        ]);
      }
    }
  }

  async function detailForDraft(draftId) {
    const draft = await getDraft(draftId);
    if (!draft) return null;
    return {
      draft,
      documentProfile: await loadDocumentProfile(draftId),
      terms: await loadTerms(draftId),
      processes: await loadProcesses(draftId),
      steps: await loadSteps(draftId),
      forms: await loadForms(draftId),
      evidence: await loadEvidence(draftId),
      risks: await buildRisks(draftId),
      reviewTasks: await loadReviewTasks(draftId),
      events: await loadEvents(draftId),
      outcome: await outcomeForDraft(draft)
    };
  }

  return {
    async listProcessTaxonomy() {
      return readProcessTaxonomyFromNorms();
    },
    async summary(departmentIds) {
      const params = [];
      let whereSql = 'WHERE 1=1';
      let draftWhereSql = 'WHERE 1=1';
      if (departmentIds) {
        if (!departmentIds.length) return { summary: { totalDrafts: 0, publishedVersions: 0, byStatus: {} }, drafts: [] };
        const markers = departmentIds.map(() => '?').join(',');
        whereSql += ` AND department_id IN (${markers})`;
        draftWhereSql += ` AND d.department_id IN (${markers})`;
        params.push(...departmentIds);
      }
      const rows = await mysqlQuery(pool, `
        SELECT status, COUNT(*) AS count
        FROM process_design_drafts
        ${whereSql}
        GROUP BY status
      `, params);
      const byStatus = {};
      rows.forEach(row => { byStatus[row.status] = Number(row.count || 0); });
      const totalDrafts = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const [publishedRow] = await mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_versions v
        JOIN process_design_drafts d ON d.id=v.draft_id
        ${draftWhereSql}
      `, params);
      const drafts = await mysqlQuery(pool, `
        SELECT d.id, d.process_name, d.status, d.l1_name, d.l2_name, d.l3_name, dept.name AS department_name, d.updated_at
        FROM process_design_drafts d
        LEFT JOIN departments dept ON dept.id=d.department_id
        ${draftWhereSql}
        ORDER BY d.updated_at DESC, d.id DESC
        LIMIT 20
      `, params);
      return { summary: { totalDrafts, publishedVersions: Number(publishedRow.count || 0), byStatus }, drafts };
    },
    async departmentExists(departmentId) {
      if (!departmentId) return false;
      const [row] = await mysqlQuery(pool, 'SELECT id FROM departments WHERE id=?', [departmentId]);
      return Boolean(row);
    },
    getDraft,
    getDraftByTerm,
    getDraftByProcess,
    getDraftByStep,
    getDraftByHandoff,
    getHandoff,
    getDraftByForm,
    getDraftByFormTable,
    getDraftByFormTableField,
    getDraftByField,
    getDraftByEvidence,
    loadDocumentProfile,
    loadTerms,
    loadProcesses,
    loadSteps,
    loadForms,
    loadEvidence,
    loadEvents,
    loadReviewTasks,
    buildRisks,
    getCounts,
    publishValidationDetails,
    outcomeForDraft,
    detail: detailForDraft,
    async markdownForDraft(draftId) {
      const detail = await detailForDraft(draftId);
      if (!detail) return null;
      const draftTitle = text(detail.documentProfile && detail.documentProfile.document_title) || text(detail.draft.process_name) || `process-design-${draftId}`;
      return {
        filename: `${draftTitle.replace(/[\\/:*?"<>|]/g, '_')}.md`,
        markdown: processDesignMarkdown(detail)
      };
    },
    async createDraft(body, actorUserId, targetDeptId, proxyDeptId) {
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_drafts
          (process_name, reason, basis_type, basis_description, involves_other_departments,
           related_departments_json, department_id, proxy_department_id, proxy_reason, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        text(body.process_name), text(body.reason), text(body.basis_type), text(body.basis_description),
        boolInt(body.involves_other_departments), jsonArray(body.related_departments),
        targetDeptId, proxyDeptId || null, optionalText(body.proxy_reason), actorUserId
      ]);
      await addEvent(result.insertId, 'draft_created', actorUserId, '已创建流程草稿');
      const draft = await getDraft(result.insertId);
      return { ...draft, outcome: await outcomeForDraft(draft) };
    },
    async updateDraft(draft, body, actorUserId) {
      if (Object.prototype.hasOwnProperty.call(body, 'basis_type') && !BASIS_TYPES.has(text(body.basis_type))) {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'basis_type', message: '依据类型必须从系统选项中选择' }] });
      }
      const allowed = {
        process_name: text,
        reason: text,
        basis_type: text,
        basis_description: text,
        l1_name: optionalText,
        l2_name: optionalText,
        l3_name: optionalText,
        proxy_reason: optionalText
      };
      const sets = [];
      const params = [];
      Object.entries(allowed).forEach(([field, normalizer]) => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(normalizer(body[field]));
        }
      });
      ['l1_status', 'l2_status'].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          const status = text(body[field]) || 'unclassified';
          if (!CLASSIFICATION_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field, message: '能力层级状态无效' }] });
          sets.push(`${field}=?`);
          params.push(status);
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
        sets.push('involves_other_departments=?');
        params.push(boolInt(body.involves_other_departments));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'related_departments')) {
        sets.push('related_departments_json=?');
        params.push(jsonArray(body.related_departments));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!DRAFT_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '草稿状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_drafts SET ${sets.join(', ')} WHERE id=?`, [...params, draft.id]);
        await addEvent(draft.id, 'draft_updated', actorUserId, '已更新流程草稿');
      }
      const updated = await getDraft(draft.id);
      return { ...updated, outcome: await outcomeForDraft(updated) };
    },
    async saveDocumentProfile(draft, body, actorUserId) {
      await mysqlRun(pool, `
        INSERT INTO process_design_document_profiles
          (draft_id, document_title, document_no, purpose, scope, inheritance_relation, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          document_title=VALUES(document_title),
          document_no=VALUES(document_no),
          purpose=VALUES(purpose),
          scope=VALUES(scope),
          inheritance_relation=VALUES(inheritance_relation),
          updated_at=CURRENT_TIMESTAMP
      `, [
        draft.id, text(body.document_title), optionalText(body.document_no), text(body.purpose),
        text(body.scope), optionalText(body.inheritance_relation), actorUserId
      ]);
      await addEvent(draft.id, 'document_profile_saved', actorUserId, '已保存制度目的、范围和承继关系');
      return await loadDocumentProfile(draft.id);
    },
    async createTerm(draft, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_terms WHERE draft_id=?', [draft.id]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_terms
          (draft_id, term_name, definition, applies_to, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        draft.id, text(body.term_name), text(body.definition), optionalText(body.applies_to),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'term_added', actorUserId, `已补充术语：${text(body.term_name)}`, objectEventPayload('term', result.insertId, text(body.term_name), 'added'));
      return await getById('process_design_terms', result.insertId);
    },
    async updateTerm(draft, termId, body, actorUserId) {
      const current = await getById('process_design_terms', termId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '术语不存在');
      await mysqlRun(pool, `
        UPDATE process_design_terms
        SET term_name=?, definition=?, applies_to=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [text(body.term_name), text(body.definition), optionalText(body.applies_to), termId]);
      await addEvent(draft.id, 'term_updated', actorUserId, `已修改术语：${text(body.term_name)}`, objectEventPayload('term', termId, text(body.term_name), 'updated'));
      return await getById('process_design_terms', termId);
    },
    async deleteTerm(draft, termId, actorUserId) {
      const current = await getById('process_design_terms', termId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '术语不存在');
      await mysqlRun(pool, 'DELETE FROM process_design_terms WHERE id=?', [termId]);
      await addEvent(draft.id, 'term_deleted', actorUserId, `已删除术语：${text(current.term_name)}`, objectEventPayload('term', termId, text(current.term_name), 'deleted'));
      return { deleted: true, id: Number(termId) };
    },
    async createProcess(draft, body, actorUserId) {
      const processType = PROCESS_TYPES.has(text(body.process_type)) ? text(body.process_type) : 'new';
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_processes WHERE draft_id=?', [draft.id]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_processes
          (draft_id, process_code, process_type, l1_name, l2_name, l3_name, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, optionalText(body.process_code), processType,
        text(body.l1_name), text(body.l2_name), text(body.l3_name),
        optionalText(body.description), body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'process_added', actorUserId, `已补充流程：${text(body.l3_name)}`, objectEventPayload('process', result.insertId, text(body.l3_name), 'added'));
      return await getById('process_design_processes', result.insertId);
    },
    async updateProcess(draft, processId, body, actorUserId) {
      const current = await getById('process_design_processes', processId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '流程不存在');
      const processType = PROCESS_TYPES.has(text(body.process_type)) ? text(body.process_type) : 'new';
      await mysqlRun(pool, `
        UPDATE process_design_processes
        SET process_code=?, process_type=?, l1_name=?, l2_name=?, l3_name=?, description=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        optionalText(body.process_code), processType, text(body.l1_name), text(body.l2_name), text(body.l3_name),
        optionalText(body.description), processId
      ]);
      await addEvent(draft.id, 'process_updated', actorUserId, `已修改流程：${text(body.l3_name)}`, objectEventPayload('process', processId, text(body.l3_name), 'updated'));
      return await getById('process_design_processes', processId);
    },
    async deleteProcess(draft, processId, actorUserId) {
      const current = await getById('process_design_processes', processId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '流程不存在');
      const [stepCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_steps WHERE process_id=?', [processId]);
      if (Number(stepCount.count || 0) > 0) {
        throw httpError(409, '这个流程下面还有业务行为，不能直接删除。请先把这些行为改到其它流程，或逐条处理这些行为。');
      }
      await mysqlRun(pool, 'DELETE FROM process_design_processes WHERE id=?', [processId]);
      await addEvent(draft.id, 'process_deleted', actorUserId, `已删除流程：${text(current.l3_name)}`, objectEventPayload('process', processId, text(current.l3_name), 'deleted'));
      return { deleted: true, id: Number(processId) };
    },
    async createStep(draft, body, actorUserId) {
      const processId = Number(body.process_id || 0);
      const [processRow] = await mysqlQuery(pool, 'SELECT id FROM process_design_processes WHERE id=? AND draft_id=?', [processId, draft.id]);
      if (!processRow) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'process_id', message: '业务行为必须归属一个制度流程' }] });
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_steps WHERE draft_id=? AND process_id=?', [draft.id, processId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_steps
          (draft_id, process_id, step_name, actor_role, timing, input_materials, output_result, need_confirmation,
           related_departments, basis, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, processId, text(body.step_name), optionalText(body.actor_role), optionalText(body.timing),
        optionalText(body.input_materials), optionalText(body.output_result), boolInt(body.need_confirmation),
        optionalText(body.related_departments), optionalText(body.basis),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'step_added', actorUserId, `已补充步骤：${text(body.step_name)}`, objectEventPayload('step', result.insertId, text(body.step_name), 'added'));
      return await getById('process_design_steps', result.insertId);
    },
    async updateStep(draft, stepId, body, actorUserId) {
      const current = await getById('process_design_steps', stepId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      if ((current.status || 'active') === 'voided') throw httpError(409, '已作废业务行为不能直接修改');
      const fields = ['step_name', 'actor_role', 'timing', 'input_materials', 'output_result', 'related_departments', 'basis'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'step_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'process_id')) {
        const processId = Number(body.process_id || 0);
        const [processRow] = await mysqlQuery(pool, 'SELECT id FROM process_design_processes WHERE id=? AND draft_id=?', [processId, draft.id]);
        if (!processRow) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'process_id', message: '业务行为必须归属同一制度草稿下的流程' }] });
        sets.push('process_id=?');
        params.push(processId);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'need_confirmation')) {
        sets.push('need_confirmation=?');
        params.push(boolInt(body.need_confirmation));
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_steps SET ${sets.join(', ')} WHERE id=?`, [...params, stepId]);
        await addEvent(draft.id, 'step_updated', actorUserId, `已修改业务行为：${text(body.step_name) || text(current.step_name)}`, objectEventPayload('step', stepId, text(body.step_name) || text(current.step_name), 'updated'));
      }
      return await getById('process_design_steps', stepId);
    },
    async saveBehaviorDetail(draft, stepId, body, actorUserId) {
      const step = await getById('process_design_steps', stepId);
      if (!step || Number(step.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      if ((step.status || 'active') === 'voided') throw httpError(409, '已作废业务行为不能直接修改');
      const existing = await loadBehaviorDetail(stepId);
      if (existing && existing.is_cross_department && !boolInt(body.is_cross_department)) {
        const [handoffCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
        if (Number(handoffCount.count || 0) > 0) throw httpError(409, '已经存在跨部门承接记录，不能改为非跨部门');
      }
      await mysqlRun(pool, `
        INSERT INTO process_design_behavior_details
          (step_id, precondition, trigger_scene, execution_standard, delivery_object,
           requires_approval, approval_note, is_cross_department, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          precondition=VALUES(precondition),
          trigger_scene=VALUES(trigger_scene),
          execution_standard=VALUES(execution_standard),
          delivery_object=VALUES(delivery_object),
          requires_approval=VALUES(requires_approval),
          approval_note=VALUES(approval_note),
          is_cross_department=VALUES(is_cross_department),
          updated_at=CURRENT_TIMESTAMP
      `, [
        stepId, optionalText(body.precondition), optionalText(body.trigger_scene),
        optionalText(body.execution_standard), optionalText(body.delivery_object),
        boolInt(body.requires_approval), optionalText(body.approval_note),
        boolInt(body.is_cross_department), actorUserId
      ]);
      await addEvent(draft.id, 'step_updated', actorUserId, `已保存业务行为详情：${text(step.step_name)}`, objectEventPayload('step', stepId, text(step.step_name), 'updated'));
      return await loadBehaviorDetail(stepId);
    },
    async deleteStep(draft, stepId, options = {}) {
      const current = await getById('process_design_steps', stepId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      const [handoffCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
      const [formCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_forms WHERE step_id=?', [stepId]);
      const detail = await loadBehaviorDetail(stepId);
      const hasDependency = Number(handoffCount.count || 0) > 0 || Number(formCount.count || 0) > 0 || behaviorDetailHasContent(detail);
      if (options.mode === 'delete') {
        if (hasDependency) throw httpError(409, '这个业务行为已有跨部门承接、关联表单或行为详情，不能物理删除，请作废。');
        await mysqlRun(pool, 'DELETE FROM process_design_steps WHERE id=?', [stepId]);
        await addEvent(draft.id, 'step_deleted', options.actorUserId, `已删除业务行为：${text(current.step_name)}`, objectEventPayload('step', stepId, text(current.step_name), 'deleted'));
        return { deleted: true, id: Number(stepId) };
      }
      if ((current.status || 'active') !== 'voided') {
        await mysqlRun(pool, `
          UPDATE process_design_steps
          SET status='voided', void_reason=?, voided_by=?, voided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [optionalText(options.reason) || '由维护人作废', options.actorUserId || null, stepId]);
        await addEvent(draft.id, 'step_voided', options.actorUserId, `已作废业务行为：${text(current.step_name)}`, objectEventPayload('step', stepId, text(current.step_name), 'voided'));
      }
      return await getById('process_design_steps', stepId);
    },
    async createHandoff(draft, stepId, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_cross_dept_handoffs
          (step_id, target_department, target_process_code, target_process_name,
           target_behavior_code, target_behavior_name, handoff_standard, status, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        stepId, text(body.target_department), null, null, null, null,
        optionalText(body.handoff_standard), 'pending_return',
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'cross_dept_handoff_requested', actorUserId, `已发起跨部门承接：${text(body.target_department)}`);
      return await getById('process_design_cross_dept_handoffs', result.insertId);
    },
    async acceptHandoffReturn(draft, handoffId, body, actorUserId) {
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET target_process_code=?, target_process_name=?, target_behavior_code=?, target_behavior_name=?,
            status='returned', returned_by=?, returned_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        optionalText(body.target_process_code), text(body.target_process_name),
        optionalText(body.target_behavior_code), text(body.target_behavior_name),
        actorUserId, handoffId
      ]);
      await addEvent(draft.id, 'cross_dept_handoff_returned', actorUserId, `承接部门已回写：${text(body.target_process_name)} / ${text(body.target_behavior_name)}`);
      return await getById('process_design_cross_dept_handoffs', handoffId);
    },
    async updateHandoff(draft, handoffId, body, actorUserId) {
      const fields = ['target_department', 'target_process_code', 'target_process_name', 'target_behavior_code', 'target_behavior_name', 'handoff_standard'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'target_department' || field === 'target_process_name' || field === 'target_behavior_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!HANDOFF_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '承接状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_cross_dept_handoffs SET ${sets.join(', ')} WHERE id=?`, [...params, handoffId]);
        await addEvent(draft.id, 'cross_dept_handoff_updated', actorUserId, '已更新跨部门承接');
      }
      return await getById('process_design_cross_dept_handoffs', handoffId);
    },
    async createForm(draft, body, actorUserId) {
      const stepId = body.step_id ? Number(body.step_id) : null;
      if (stepId) {
        const [step] = await mysqlQuery(pool, 'SELECT id FROM process_design_steps WHERE id=? AND draft_id=?', [stepId, draft.id]);
        if (!step) throw httpError(400, '表单关联的步骤不存在');
      }
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_forms (draft_id, step_id, form_name, description, archive_rule, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [draft.id, stepId, text(body.form_name), optionalText(body.description), optionalText(body.archive_rule), actorUserId]);
      await addEvent(draft.id, 'form_added', actorUserId, `已补充在线表单：${text(body.form_name)}`);
      return await getById('process_design_forms', result.insertId);
    },
    async updateForm(draft, formId, body, actorUserId) {
      const fields = ['form_name', 'description', 'archive_rule', 'status'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'form_name' || field === 'status' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_forms SET ${sets.join(', ')} WHERE id=?`, [...params, formId]);
        await addEvent(draft.id, 'form_updated', actorUserId, '已更新在线表单');
      }
      return await getById('process_design_forms', formId);
    },
    async createFormTable(draft, formId, body, actorUserId) {
      const tableKind = TABLE_KINDS.has(text(body.table_kind)) ? text(body.table_kind) : 'main';
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_tables WHERE form_id=?', [formId]);
      const tableNo = `${tableKind === 'detail' ? 'MX' : 'ZB'}-${String(Number(orderRow.next_order || 1)).padStart(3, '0')}`;
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_tables
          (form_id, table_kind, table_no, table_name, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        formId, tableKind, tableNo, text(body.table_name),
        optionalText(body.description), body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'form_table_added', actorUserId, `已补充附表：${text(body.table_name)}`);
      return await getById('process_design_form_tables', result.insertId);
    },
    async updateFormTable(draft, tableId, body, actorUserId) {
      assertNoManualNumber(body || {}, 'table_no', '表编号');
      const fields = ['table_name', 'description'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'table_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'table_kind')) {
        const tableKind = text(body.table_kind);
        if (!TABLE_KINDS.has(tableKind)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'table_kind', message: '附表类型无效' }] });
        sets.push('table_kind=?');
        params.push(tableKind);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_tables SET ${sets.join(', ')} WHERE id=?`, [...params, tableId]);
        await addEvent(draft.id, 'form_table_updated', actorUserId, '已更新附表结构');
      }
      return await getById('process_design_form_tables', tableId);
    },
    async createFormTableField(draft, tableId, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_table_fields WHERE form_table_id=?', [tableId]);
      const fieldNo = `F-${String(Number(orderRow.next_order || 1)).padStart(3, '0')}`;
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_table_fields
          (form_table_id, field_no, field_name, field_type, is_required, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        tableId, fieldNo, text(body.field_name), text(body.field_type),
        boolInt(body.required), optionalText(body.description),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'form_table_field_added', actorUserId, `已补充附表字段：${text(body.field_name)}`);
      return publicFormTableField(await getById('process_design_form_table_fields', result.insertId));
    },
    async updateFormTableField(draft, fieldId, body, actorUserId) {
      assertNoManualNumber(body || {}, 'field_no', '字段编号');
      assertNoWhitespaceFields(body || {}, ['field_name']);
      if (Object.prototype.hasOwnProperty.call(body || {}, 'field_type')) assertEnum(body || {}, 'field_type', FIELD_TYPES, '字段类型');
      const fields = ['field_name', 'field_type', 'description'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'field_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'required')) {
        sets.push('is_required=?');
        params.push(boolInt(body.required));
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_table_fields SET ${sets.join(', ')} WHERE id=?`, [...params, fieldId]);
        await addEvent(draft.id, 'form_table_field_updated', actorUserId, '已更新附表字段');
      }
      return publicFormTableField(await getById('process_design_form_table_fields', fieldId));
    },
    async createField(draft, formId, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_fields WHERE form_id=?', [formId]);
      const status = FIELD_STATUSES.has(text(body.status)) ? text(body.status) : 'suggested';
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_fields
          (form_id, field_name_cn, field_name_en, data_object, field_type, enum_options,
           evidence_note, status, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        formId, text(body.field_name_cn), optionalText(body.field_name_en), optionalText(body.data_object),
        optionalText(body.field_type), optionalText(body.enum_options), optionalText(body.evidence_note),
        status, body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'field_added', actorUserId, `已补充字段：${text(body.field_name_cn)}`);
      return await getById('process_design_form_fields', result.insertId);
    },
    async updateField(draft, fieldId, body, actorUserId) {
      assertNoWhitespaceFields(body || {}, ['field_name_cn', 'field_name_en', 'data_object']);
      if (Object.prototype.hasOwnProperty.call(body || {}, 'field_type')) assertEnum(body || {}, 'field_type', FIELD_TYPES, '字段类型');
      const fields = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'enum_options', 'evidence_note'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'field_name_cn' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!FIELD_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '字段状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_fields SET ${sets.join(', ')} WHERE id=?`, [...params, fieldId]);
        await addEvent(draft.id, 'field_updated', actorUserId, '已更新字段草稿');
      }
      return await getById('process_design_form_fields', fieldId);
    },
    async createEvidence(draft, body, actorUserId) {
      const maturity = evidenceMaturity(body);
      const objectType = ['process', 'step', 'form', 'field'].includes(text(body.object_type)) ? text(body.object_type) : 'process';
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_evidence
          (draft_id, object_type, object_id, evidence_type, description, source_name, source_anchor,
           confirmer, record_time, missing_reason, expected_provider, expected_at, maturity, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, objectType, body.object_id ? Number(body.object_id) : draft.id,
        text(body.evidence_type), text(body.description), optionalText(body.source_name),
        optionalText(body.source_anchor), optionalText(body.confirmer), optionalText(body.record_time),
        optionalText(body.missing_reason), optionalText(body.expected_provider), optionalText(body.expected_at),
        maturity, actorUserId
      ]);
      await addEvent(draft.id, 'evidence_added', actorUserId, `已补充证据说明：${text(body.evidence_type)}`);
      return await getById('process_design_evidence', result.insertId);
    },
    async updateEvidence(draft, evidenceId, body, actorUserId) {
      if (Object.prototype.hasOwnProperty.call(body || {}, 'evidence_type')) assertEnum(body || {}, 'evidence_type', EVIDENCE_TYPES, '证据类型');
      const current = await getById('process_design_evidence', evidenceId);
      const merged = { ...current, ...(body || {}) };
      const fields = ['object_type', 'object_id', 'evidence_type', 'description', 'source_name', 'source_anchor', 'confirmer', 'record_time', 'missing_reason', 'expected_provider', 'expected_at'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'object_id' ? (body[field] ? Number(body[field]) : null) : (field === 'object_type' || field === 'evidence_type' || field === 'description' ? text(body[field]) : optionalText(body[field])));
        }
      });
      sets.push('maturity=?');
      params.push(evidenceMaturity(merged));
      sets.push('updated_at=CURRENT_TIMESTAMP');
      await mysqlRun(pool, `UPDATE process_design_evidence SET ${sets.join(', ')} WHERE id=?`, [...params, evidenceId]);
      await addEvent(draft.id, 'evidence_updated', actorUserId, '已更新证据说明');
      return await getById('process_design_evidence', evidenceId);
    },
    async submitDraft(draft, note, actorUserId) {
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [actorUserId, draft.id]);
      const taskResult = await mysqlRun(pool, `
        INSERT INTO process_design_review_tasks (draft_id, task_type, assignee_role, created_by)
        VALUES (?, 'department_review', 'reviewer', ?)
      `, [draft.id, actorUserId]);
      await addEvent(draft.id, 'submitted', actorUserId, optionalText(note) || '已提交审核');
      const updated = await getDraft(draft.id);
      return {
        draft: updated,
        reviewTask: await getById('process_design_review_tasks', taskResult.insertId),
        outcome: await outcomeForDraft(updated)
      };
    },
    async getReviewTask(taskId) {
      return await getById('process_design_review_tasks', taskId);
    },
    async decideReviewTask(task, decision, note, actorUserId) {
      const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
      const nextStatus = statusByDecision[decision];
      await mysqlRun(pool, `
        UPDATE process_design_review_tasks
        SET status=?, decision_note=?, decided_by=?, decided_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [nextStatus, optionalText(note), actorUserId, task.id]);
      await mysqlRun(pool, 'UPDATE process_design_drafts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [nextStatus, task.draft_id]);
      await addEvent(task.draft_id, `review_${decision}`, actorUserId, optionalText(note) || '已处理审核任务');
      return { draft: await getDraft(task.draft_id), reviewTask: await getById('process_design_review_tasks', task.id) };
    },
    async publishDraft(draft, note, actorUserId) {
      const details = await publishValidationDetails(draft);
      if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
      const [countRow] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_versions WHERE draft_id=?', [draft.id]);
      const versionNo = `PD-${draft.id}-v${Number(countRow.count || 0) + 1}`;
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_versions
          (draft_id, version_no, department_id, l1_name, l2_name, l3_name, content_json, published_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, versionNo, draft.department_id, draft.l1_name, draft.l2_name, draft.l3_name,
        JSON.stringify(await versionContent(draft)), actorUserId
      ]);
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET status='published', published_by=?, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [actorUserId, draft.id]);
      const version = await getById('process_design_versions', result.insertId);
      await projectPublishedVersionToProcessMap(await getDraft(draft.id), version);
      await addEvent(draft.id, 'published', actorUserId, optionalText(note) || '已发布流程版本', { version_no: versionNo });
      const publishedDraft = await getDraft(draft.id);
      return { draft: publishedDraft, version, outcome: await outcomeForDraft(publishedDraft) };
    }
  };
}

function evidenceMaturity(payload) {
  const evidenceType = text(payload.evidence_type);
  const description = text(payload.description);
  if (evidenceType === '暂无证据') {
    return text(payload.missing_reason) && text(payload.expected_provider) && text(payload.expected_at)
      ? '发布前需补'
      : '可保存草稿';
  }
  if (!evidenceType || !description) return '可保存草稿';
  if (!text(payload.source_name) && !text(payload.source_anchor)) return '可提交审核';
  if (text(payload.source_name) && text(payload.source_anchor) && (text(payload.confirmer) || text(payload.record_time))) {
    return '可支撑发布';
  }
  return '发布前需补';
}

async function repository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = Promise.resolve(makeProcessDesignMysqlRepository(mysql.createPool(mysqlConfigFromEnv())));
  }
  return await repositoryPromise;
}

function setProcessDesignRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessDesignRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

async function currentRoleCodes(req) {
  const rows = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  const codes = new Set((rows || []).map(row => row.code || row.role_code).filter(Boolean));
  if (req.session.userRole) codes.add(req.session.userRole);
  return codes;
}

async function currentPermSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet || new Set();
}

function hasRole(roleCodes, allowed) {
  return Array.from(roleCodes).some(code => allowed.has(code));
}

async function canWorkAcrossDepartments(req, roleCodes) {
  const perms = await currentPermSet(req);
  return perms.has('*:*') || perms.has('admin:access') || hasRole(roleCodes, PROJECT_WIDE_ROLES);
}

async function authorizedDepartmentIds(req, roleCodes) {
  if (await canWorkAcrossDepartments(req, roleCodes)) return null;
  const ids = new Set();
  if (req.session.departmentId) ids.add(Number(req.session.departmentId));
  return ids;
}

function draftRequiredErrors(body) {
  const required = [
    ['process_name', '流程名称不能为空'],
    ['reason', '为什么新增不能为空'],
    ['basis_type', '依据类型不能为空'],
    ['basis_description', '依据说明不能为空']
  ];
  const errors = required.filter(([field]) => !text(body[field])).map(([field, message]) => ({ field, message }));
  if (!Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
    errors.push({ field: 'involves_other_departments', message: '请说明是否涉及其他部门' });
  }
  return errors;
}

async function assertCanViewDraft(req, repo, draft) {
  if (!draft) throw httpError(404, '流程草稿不存在');
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  const deptIds = await authorizedDepartmentIds(req, roleCodes);
  if (deptIds && deptIds.has(Number(draft.department_id))) return roleCodes;
  throw httpError(403, '无权查看该流程草稿');
}

async function assertCanEditDraft(req, repo, draft) {
  const roleCodes = await assertCanViewDraft(req, repo, draft);
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  if (hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) return roleCodes;
  throw httpError(403, '无权维护该流程草稿');
}

async function assertCanEditDraftContent(req, repo, draft) {
  const roleCodes = await assertCanEditDraft(req, repo, draft);
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
    throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  }
  return roleCodes;
}

async function assertCanReview(req, repo, draft) {
  const roleCodes = await assertCanViewDraft(req, repo, draft);
  if (await canWorkAcrossDepartments(req, roleCodes) || hasRole(roleCodes, REVIEW_ROLES)) return roleCodes;
  throw httpError(403, '无权审核该流程草稿');
}

async function assertCanReturnHandoff(req, repo, draft, handoff) {
  if (!handoff) throw httpError(404, '跨部门承接不存在');
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  const department = req.session.departmentId ? await getDepartmentByIdAsync(req.session.departmentId) : null;
  const departmentName = department && (department.name || department.department_name);
  if (departmentName && text(departmentName) === text(handoff.target_department)) return roleCodes;
  throw httpError(403, '跨部门承接结果只能由承接部门回写');
}

router.get('/summary', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const roleCodes = await currentRoleCodes(req);
  let deptIds = null;
  if (!await canWorkAcrossDepartments(req, roleCodes)) {
    deptIds = Array.from(await authorizedDepartmentIds(req, roleCodes) || []);
  }
  res.json(await repo.summary(deptIds));
}));

router.get('/process-taxonomy', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  res.json(await repo.listProcessTaxonomy());
}));

router.post('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const roleCodes = await currentRoleCodes(req);
  const errors = draftRequiredErrors(req.body || {});
  if (text(req.body && req.body.basis_type) && !BASIS_TYPES.has(text(req.body.basis_type))) {
    errors.push({ field: 'basis_type', message: '依据类型必须从系统选项中选择' });
  }
  const canCrossDept = await canWorkAcrossDepartments(req, roleCodes);
  const requestedDeptId = req.body.department_id ? Number(req.body.department_id) : null;
  const sessionDeptId = req.session.departmentId ? Number(req.session.departmentId) : null;
  const targetDeptId = requestedDeptId || sessionDeptId;
  if (!targetDeptId && !canCrossDept) throw httpError(400, '请先维护人员组织信息后再创建流程草稿');
  if (!await repo.departmentExists(targetDeptId)) errors.push({ field: 'department_id', message: '所属部门不存在' });
  if (!canCrossDept) {
    if (requestedDeptId && requestedDeptId !== sessionDeptId) throw httpError(403, '普通填报人只能为本人部门创建流程');
    const allowed = await authorizedDepartmentIds(req, roleCodes);
    if (!allowed || !allowed.has(Number(targetDeptId))) throw httpError(403, '无权为该部门创建流程');
    if (!hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) throw httpError(403, '无权创建流程草稿');
  } else if (requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId && !text(req.body.proxy_reason)) {
    errors.push({ field: 'proxy_reason', message: '管理员或信息化负责人代建时必须填写代建原因' });
  }
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  await getDepartmentByIdAsync(targetDeptId);
  const draft = await repo.createDraft(req.body, req.session.userId, targetDeptId, requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId ? sessionDeptId : null);
  res.status(201).json(draft);
}));

router.get('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json(await repo.detail(draft.id));
}));

router.put('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateDraft(draft, req.body || {}, req.session.userId));
}));

router.put('/drafts/:id/document-profile', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.document_title)) details.push({ field: 'document_title', message: '制度名称不能为空' });
  if (!text(body.purpose)) details.push({ field: 'purpose', message: '目的不能为空' });
  if (!text(body.scope)) details.push({ field: 'scope', message: '范围不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.saveDocumentProfile(draft, body, req.session.userId));
}));

router.post('/drafts/:id/terms', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.term_name)) details.push({ field: 'term_name', message: '术语名称不能为空' });
  if (!text(body.definition)) details.push({ field: 'definition', message: '术语定义不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createTerm(draft, body, req.session.userId));
}));

router.put('/terms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByTerm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.term_name)) details.push({ field: 'term_name', message: '术语名称不能为空' });
  if (!text(body.definition)) details.push({ field: 'definition', message: '术语定义不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.updateTerm(draft, Number(req.params.id), body, req.session.userId));
}));

router.delete('/terms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByTerm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteTerm(draft, Number(req.params.id), req.session.userId));
}));

router.post('/drafts/:id/processes', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.l1_name)) details.push({ field: 'l1_name', message: 'L1 能力不能为空' });
  if (!text(body.l2_name)) details.push({ field: 'l2_name', message: 'L2 业务能力不能为空' });
  if (!text(body.l3_name)) details.push({ field: 'l3_name', message: 'L3 流程不能为空' });
  if (text(body.process_type) && !PROCESS_TYPES.has(text(body.process_type))) details.push({ field: 'process_type', message: '流程类型必须从系统选项中选择' });
  await appendProcessTaxonomyValidation(repo, body, details);
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createProcess(draft, body, req.session.userId));
}));

router.put('/processes/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByProcess(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.l1_name)) details.push({ field: 'l1_name', message: 'L1 能力不能为空' });
  if (!text(body.l2_name)) details.push({ field: 'l2_name', message: 'L2 业务能力不能为空' });
  if (!text(body.l3_name)) details.push({ field: 'l3_name', message: 'L3 流程不能为空' });
  if (text(body.process_type) && !PROCESS_TYPES.has(text(body.process_type))) details.push({ field: 'process_type', message: '流程类型必须从系统选项中选择' });
  await appendProcessTaxonomyValidation(repo, body, details);
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.updateProcess(draft, Number(req.params.id), body, req.session.userId));
}));

router.delete('/processes/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByProcess(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteProcess(draft, Number(req.params.id), req.session.userId));
}));

router.get('/drafts/:id/markdown', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const result = await repo.markdownForDraft(draft.id);
  if (!result) throw httpError(404, '流程草稿不存在');
  res.json(result);
}));

router.post('/drafts/:id/steps', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const details = [];
  if (!Number(req.body && req.body.process_id || 0)) details.push({ field: 'process_id', message: '业务行为必须归属一个制度流程' });
  if (!text(req.body.step_name)) details.push({ field: 'step_name', message: '步骤名称不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createStep(draft, req.body || {}, req.session.userId));
}));

router.put('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateStep(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/steps/:id/behavior-detail', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.saveBehaviorDetail(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.delete('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteStep(draft, Number(req.params.id), {
    mode: text(req.query && req.query.mode) === 'delete' ? 'delete' : 'void',
    reason: req.body && req.body.reason,
    actorUserId: req.session.userId
  }));
}));

router.post('/steps/:id/cross-dept-handoffs', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.target_department)) details.push({ field: 'target_department', message: '承接部门不能为空' });
  ['target_process_code', 'target_process_name', 'target_behavior_code', 'target_behavior_name'].forEach(field => {
    if (text(body[field])) details.push({ field, message: '承接流程和业务行为只能由承接部门回写' });
  });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createHandoff(draft, Number(req.params.id), body, req.session.userId));
}));

router.put('/cross-dept-handoffs/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByHandoff(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateHandoff(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/cross-dept-handoffs/:id/returned-result', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByHandoff(req.params.id);
  const handoff = await repo.getHandoff(req.params.id);
  await assertCanReturnHandoff(req, repo, draft, handoff);
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  const body = req.body || {};
  const details = [];
  if (!text(body.target_process_name)) details.push({ field: 'target_process_name', message: '承接流程不能为空' });
  if (!text(body.target_behavior_name)) details.push({ field: 'target_behavior_name', message: '承接业务行为不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.acceptHandoffReturn(draft, Number(req.params.id), body, req.session.userId));
}));

router.post('/drafts/:id/forms', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  if (!text(req.body.form_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'form_name', message: '表单名称不能为空' }] });
  res.status(201).json(await repo.createForm(draft, req.body || {}, req.session.userId));
}));

router.put('/forms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateForm(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/forms/:id/tables', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoManualNumber(req.body || {}, 'table_no', '表编号');
  assertEnum(req.body || {}, 'table_kind', TABLE_KINDS, '附表类型');
  if (!text(req.body && req.body.table_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'table_name', message: '附表名称不能为空' }] });
  res.status(201).json(await repo.createFormTable(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/form-tables/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTable(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateFormTable(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/form-tables/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTable(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoManualNumber(req.body || {}, 'field_no', '字段编号');
  assertNoWhitespaceFields(req.body || {}, ['field_name']);
  assertEnum(req.body || {}, 'field_type', FIELD_TYPES, '字段类型');
  if (!text(req.body && req.body.field_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name', message: '附表字段名称不能为空' }] });
  res.status(201).json(await repo.createFormTableField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/form-table-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTableField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateFormTableField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/forms/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoWhitespaceFields(req.body || {}, ['field_name_cn', 'field_name_en', 'data_object']);
  assertEnum(req.body || {}, 'field_type', FIELD_TYPES, '字段类型');
  if (!text(req.body.field_name_cn)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name_cn', message: '中文字段名不能为空' }] });
  res.status(201).json(await repo.createField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/form-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/drafts/:id/evidence', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertEnum(req.body || {}, 'evidence_type', EVIDENCE_TYPES, '证据类型');
  if (!text(req.body.evidence_type) || !text(req.body.description)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'evidence', message: '证据类型和说明不能为空' }] });
  res.status(201).json(await repo.createEvidence(draft, req.body || {}, req.session.userId));
}));

router.put('/evidence/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByEvidence(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateEvidence(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.get('/drafts/:id/risks', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const items = await repo.buildRisks(draft.id);
  res.json({ summary: { total: items.length }, items });
}));

router.get('/drafts/:id/outcome-preview', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json({ draft, outcome: await repo.outcomeForDraft(draft), counts: await repo.getCounts(draft.id), risks: await repo.buildRisks(draft.id) });
}));

router.post('/drafts/:id/submit', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const errors = draftRequiredErrors(draft);
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  res.json(await repo.submitDraft(draft, req.body && req.body.note, req.session.userId));
}));

router.post('/review-tasks/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const task = await repo.getReviewTask(req.params.id);
  if (!task) throw httpError(404, '审核任务不存在');
  const draft = await repo.getDraft(task.draft_id);
  await assertCanReview(req, repo, draft);
  const decision = text(req.body.decision);
  if (!{ approve: true, reject: true, needs_changes: true }[decision]) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '审核结论无效' }] });
  res.json(await repo.decideReviewTask(task, decision, req.body.note, req.session.userId));
}));

router.post('/drafts/:id/publish', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanReview(req, repo, draft);
  res.json(await repo.publishDraft(draft, req.body && req.body.note, req.session.userId));
}));

router.setProcessDesignRepositoryFactory = setProcessDesignRepositoryFactory;
router.resetProcessDesignRepositoryFactory = resetProcessDesignRepositoryFactory;
router.makeProcessDesignMysqlRepository = makeProcessDesignMysqlRepository;

module.exports = router;
