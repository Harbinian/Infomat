const express = require('express');
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
const EVIDENCE_STATUSES = new Set(['verified', 'pending_review', 'source_missing', 'ocr_extracted_not_confirmed', 'review_only']);
const PROCESS_EVIDENCE_VERIFY_PERMISSION = 'process_evidence:verify';
const EVIDENCE_STATUS_MIGRATION_KEY = '2026-07-01-process-design-evidence-status';
const VERIFIED_EVIDENCE_MESSAGE = '发布需至少 1 条已核验(verified)证据。';

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

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => text(item)).filter(Boolean));
  const single = text(value);
  return single ? JSON.stringify([single]) : JSON.stringify([]);
}

function publicDraft(row) {
  if (!row) return null;
  return {
    ...row,
    related_departments: parseJsonArray(row.related_departments_json),
    involves_other_departments: Boolean(row.involves_other_departments)
  };
}

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function executeIgnoringDuplicateColumn(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(error.message || '')))) return;
    throw error;
  }
}

async function ensureProcessDesignEvidenceStatusSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, `ALTER TABLE process_design_evidence ADD COLUMN status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'`);
  const [migration] = await mysqlQuery(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [EVIDENCE_STATUS_MIGRATION_KEY]);
  if (migration) return;

  // Migration fallback only: old maturity='可支撑发布' records remain publishable after migration,
  // but this does not prove the evidence was manually verified under the new status model.
  await mysqlRun(pool, "UPDATE process_design_evidence SET status='verified' WHERE status='pending_review' AND maturity='可支撑发布'");
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EVIDENCE_STATUS_MIGRATION_KEY]);
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

  async function loadSteps(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_steps WHERE draft_id=? ORDER BY sort_order, id', [draftId]);
  }

  async function loadForms(draftId) {
    const forms = await mysqlQuery(pool, 'SELECT * FROM process_design_forms WHERE draft_id=? ORDER BY id', [draftId]);
    const result = [];
    for (const form of forms) {
      const fields = await mysqlQuery(pool, 'SELECT * FROM process_design_form_fields WHERE form_id=? ORDER BY sort_order, id', [form.id]);
      result.push({ ...form, fields });
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
      payload: row.payload_json ? JSON.parse(row.payload_json) : null
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

  async function getDraftByForm(formId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_forms f
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE f.id=?
    `, [formId]);
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
    const [[steps], [forms], [fields], [evidence], [publishableEvidence]] = await Promise.all([
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_steps WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_forms WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_form_fields ff
        JOIN process_design_forms f ON f.id=ff.form_id
        WHERE f.draft_id=?
      `, [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, "SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=? AND status='verified'", [draftId])
    ]);
    const risks = (await buildRisks(draftId)).length;
    return {
      steps: Number(steps.count || 0),
      forms: Number(forms.count || 0),
      fields: Number(fields.count || 0),
      evidence: Number(evidence.count || 0),
      publishableEvidence: Number(publishableEvidence.count || 0),
      verifiedEvidence: Number(publishableEvidence.count || 0),
      risks
    };
  }

  async function publishReadiness(draft) {
    const [steps, evidence] = await Promise.all([
      loadSteps(draft.id),
      loadEvidence(draft.id)
    ]);
    const l1l2l3Confirmed = Boolean(
      text(draft.l1_name) &&
      text(draft.l2_name) &&
      text(draft.l3_name) &&
      draft.l1_status === 'confirmed' &&
      draft.l2_status === 'confirmed'
    );
    const verifiedEvidenceCount = evidence.filter(item => item.status === 'verified').length;
    return {
      verifiedEvidenceCount,
      l1l2l3Confirmed,
      stepCount: steps.length,
      publishable: verifiedEvidenceCount >= 1 && l1l2l3Confirmed && steps.length >= 1
    };
  }

  async function buildRisks(draftId) {
    const risks = [];
    const draft = await getDraft(draftId);
    if (!draft) return risks;
    if (!text(draft.l1_name) || !text(draft.l2_name)) {
      risks.push({ object_type: 'process', object_id: draft.id, message: '还没说明这个流程属于哪类工作。', status: 'open' });
    }
    for (const step of await loadSteps(draftId)) {
      if (!text(step.output_result)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步做完后没有写清会产生什么结果。', status: 'open' });
      if (step.need_confirmation && !text(step.related_departments)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步需要别人确认，但还没有指定确认部门。', status: 'open' });
    }
    for (const form of await loadForms(draftId)) {
      if (!text(form.archive_rule)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有归档规则。', status: 'open' });
      form.fields.forEach(field => {
        if (field.field_type === '枚举' && !text(field.enum_options)) risks.push({ object_type: 'field', object_id: field.id, message: '这个字段要从固定选项里选，但选项还没列出来。', status: 'open' });
        if (!text(field.data_object)) risks.push({ object_type: 'field', object_id: field.id, message: '这个字段还没有说明属于哪个数据对象。', status: 'open' });
      });
    }
    for (const evidence of await loadEvidence(draftId)) {
      if (evidence.status !== 'verified') risks.push({ object_type: 'evidence', object_id: evidence.id, message: '这条证据还没有完成核验。', status: 'open' });
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
    if (!text(draft.l1_name)) details.push('发布前还需确认 L1。');
    if (!text(draft.l2_name)) details.push('发布前还需确认 L2。');
    if (!text(draft.l3_name)) details.push('发布前还需确认 L3。');
    if (draft.l1_status === 'needs_review' || draft.l2_status === 'needs_review') details.push('待确认 L1/L2 未复核前不能作为正式能力结构发布。');
    if (!options.relaxed) {
      if (draft.l1_status !== 'confirmed') details.push('L1 必须由审核人确认。');
      if (draft.l2_status !== 'confirmed') details.push('L2 必须由审核人确认。');
    }
    const steps = await loadSteps(draft.id);
    if (!steps.length) details.push('发布前至少需要 1 个实际步骤。');
    if (steps.some(step => !text(step.output_result))) details.push('发布前每个步骤都要写清输出结果。');
    const forms = await loadForms(draft.id);
    const fields = forms.flatMap(form => form.fields);
    if (!fields.length) details.push('发布前至少需要 1 个字段。');
    if (forms.some(form => !text(form.archive_rule))) details.push('发布前在线表单需要归档规则。');
    if (fields.some(field => field.field_type === '枚举' && !text(field.enum_options))) details.push('发布前枚举字段需要列出固定选项。');
    const evidence = await loadEvidence(draft.id);
    if (!evidence.length) details.push('发布前至少需要 1 条证据。');
    if (evidence.length > 0 && !evidence.some(item => text(item.source_anchor))) details.push('发布前还需补 1 条来源锚点。');
    if (!evidence.some(item => item.status === 'verified')) details.push(VERIFIED_EVIDENCE_MESSAGE);
    return Array.from(new Set(details));
  }

  async function outcomeForDraft(draft) {
    const counts = await getCounts(draft.id);
    const formed = [];
    if (draft.process_name) formed.push('1 条流程草稿');
    if (counts.steps) formed.push(`${counts.steps} 个实际步骤`);
    if (counts.forms) formed.push(`${counts.forms} 个在线表单`);
    if (counts.fields) formed.push(`${counts.fields} 个字段草稿`);
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
      steps: await loadSteps(draft.id),
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
    const steps = await loadSteps(draft.id);
    const sourceFile = `process_design_versions:${version.id}`;
    const l3Key = `process-design:${version.id}:l3`;
    await mysqlRun(pool, `
      INSERT INTO process_mapping_records
        (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l2_name, l3_name, source_file, status)
      VALUES (?, 'l3', ?, ?, ?, ?, ?, ?, 'published')
      ON DUPLICATE KEY UPDATE latest_snapshot_id=VALUES(latest_snapshot_id), status='published'
    `, [l3Key, snapshot.id, snapshot.id, draft.department_name, draft.l2_name, draft.l3_name, sourceFile]);
    const [l3Record] = await mysqlQuery(pool, 'SELECT id FROM process_mapping_records WHERE mapping_key=?', [l3Key]);
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const a1Code = text(step.a1_code) || `PD-${draft.id}-A1-${String(index + 1).padStart(3, '0')}`;
      await mysqlRun(pool, 'UPDATE process_design_steps SET a1_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [a1Code, step.id]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_a1_items
          (snapshot_id, a1_code, dept_name, l3_name, behavior, execution_role, approval_type,
           input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        snapshot.id, a1Code, draft.department_name, draft.l3_name, step.step_name,
        step.actor_role || null, step.need_confirmation ? '需确认' : '记录',
        step.input_materials || null, step.output_result || null, JSON.stringify([]),
        '由新增流程治理线发布', sourceFile
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
        draft.l2_name, draft.l3_name, a1Code, step.step_name, step.actor_role || null,
        step.need_confirmation ? '需确认' : '记录', step.input_materials || null,
        step.output_result || null, JSON.stringify([]), '由新增流程治理线发布', sourceFile
      ]);
    }
  }

  return {
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
    getDraftByStep,
    getDraftByForm,
    getDraftByField,
    getDraftByEvidence,
    loadSteps,
    loadForms,
    loadEvidence,
    loadEvents,
    loadReviewTasks,
    buildRisks,
    getCounts,
    publishReadiness,
    publishValidationDetails,
    outcomeForDraft,
    async detail(draftId) {
      const draft = await getDraft(draftId);
      if (!draft) return null;
      const readiness = await publishReadiness(draft);
      return {
        draft,
        steps: await loadSteps(draftId),
        forms: await loadForms(draftId),
        evidence: await loadEvidence(draftId),
        risks: await buildRisks(draftId),
        reviewTasks: await loadReviewTasks(draftId),
        events: await loadEvents(draftId),
        outcome: await outcomeForDraft(draft),
        publishable: readiness.publishable
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
    async createStep(draft, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_steps WHERE draft_id=?', [draft.id]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_steps
          (draft_id, step_name, actor_role, timing, input_materials, output_result, need_confirmation,
           related_departments, basis, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, text(body.step_name), optionalText(body.actor_role), optionalText(body.timing),
        optionalText(body.input_materials), optionalText(body.output_result), boolInt(body.need_confirmation),
        optionalText(body.related_departments), optionalText(body.basis),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'step_added', actorUserId, `已补充步骤：${text(body.step_name)}`);
      return await getById('process_design_steps', result.insertId);
    },
    async updateStep(draft, stepId, body, actorUserId) {
      const fields = ['step_name', 'actor_role', 'timing', 'input_materials', 'output_result', 'related_departments', 'basis'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'step_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'need_confirmation')) {
        sets.push('need_confirmation=?');
        params.push(boolInt(body.need_confirmation));
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_steps SET ${sets.join(', ')} WHERE id=?`, [...params, stepId]);
        await addEvent(draft.id, 'step_updated', actorUserId, '已更新实际步骤');
      }
      return await getById('process_design_steps', stepId);
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
           confirmer, record_time, missing_reason, expected_provider, expected_at, maturity, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, objectType, body.object_id ? Number(body.object_id) : draft.id,
        text(body.evidence_type), text(body.description), optionalText(body.source_name),
        optionalText(body.source_anchor), optionalText(body.confirmer), optionalText(body.record_time),
        optionalText(body.missing_reason), optionalText(body.expected_provider), optionalText(body.expected_at),
        maturity, 'pending_review', actorUserId
      ]);
      await addEvent(draft.id, 'evidence_added', actorUserId, `已补充证据说明：${text(body.evidence_type)}`);
      return await getById('process_design_evidence', result.insertId);
    },
    async updateEvidence(draft, evidenceId, body, actorUserId) {
      const current = await getById('process_design_evidence', evidenceId);
      if (!current) throw httpError(404, '证据不存在');
      const merged = { ...current, ...(body || {}) };
      const fields = ['object_type', 'object_id', 'evidence_type', 'description', 'source_name', 'source_anchor', 'confirmer', 'record_time', 'missing_reason', 'expected_provider', 'expected_at'];
      const sets = [];
      const params = [];
      let nextStatus = null;
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'object_id' ? (body[field] ? Number(body[field]) : null) : (field === 'object_type' || field === 'evidence_type' || field === 'description' ? text(body[field]) : optionalText(body[field])));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        nextStatus = text(body.status);
        if (!EVIDENCE_STATUSES.has(nextStatus)) {
          throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '证据状态无效' }] });
        }
        sets.push('status=?');
        params.push(nextStatus);
      }
      sets.push('maturity=?');
      params.push(evidenceMaturity(merged));
      sets.push('updated_at=CURRENT_TIMESTAMP');
      await mysqlRun(pool, `UPDATE process_design_evidence SET ${sets.join(', ')} WHERE id=?`, [...params, evidenceId]);
      await addEvent(draft.id, 'evidence_updated', actorUserId, '已更新证据说明');
      if (nextStatus && nextStatus !== current.status) {
        await addEvent(draft.id, 'evidence_status_change', actorUserId, '已更新证据核验状态', {
          from_status: current.status || 'pending_review',
          to_status: nextStatus
        });
      }
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
      if (details.length) {
        throw httpError(details.includes(VERIFIED_EVIDENCE_MESSAGE) ? 409 : 422, '校验失败', { error: '校验失败', details });
      }
      const readiness = await publishReadiness(draft);
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
      await addEvent(draft.id, 'publish', actorUserId, optionalText(note) || '已发布流程版本', {
        version_no: versionNo,
        verified_evidence_count: readiness.verifiedEvidenceCount,
        l1l2l3_confirmed: true,
        step_count: readiness.stepCount
      });
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

async function assertCanReview(req, repo, draft) {
  const roleCodes = await assertCanViewDraft(req, repo, draft);
  if (await canWorkAcrossDepartments(req, roleCodes) || hasRole(roleCodes, REVIEW_ROLES)) return roleCodes;
  throw httpError(403, '无权审核该流程草稿');
}

async function assertCanVerifyEvidenceStatus(req) {
  const perms = await currentPermSet(req);
  if (perms.has('*:*') || perms.has('admin:access') || perms.has(PROCESS_EVIDENCE_VERIFY_PERMISSION)) return;
  throw httpError(403, '无权核验证据状态');
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

router.post('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const roleCodes = await currentRoleCodes(req);
  const errors = draftRequiredErrors(req.body || {});
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
  await assertCanEditDraft(req, repo, draft);
  res.json(await repo.updateDraft(draft, req.body || {}, req.session.userId));
}));

router.post('/drafts/:id/steps', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  if (!text(req.body.step_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'step_name', message: '步骤名称不能为空' }] });
  res.status(201).json(await repo.createStep(draft, req.body || {}, req.session.userId));
}));

router.put('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  res.json(await repo.updateStep(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/drafts/:id/forms', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  if (!text(req.body.form_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'form_name', message: '表单名称不能为空' }] });
  res.status(201).json(await repo.createForm(draft, req.body || {}, req.session.userId));
}));

router.put('/forms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  res.json(await repo.updateForm(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/forms/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  if (!text(req.body.field_name_cn)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name_cn', message: '中文字段名不能为空' }] });
  res.status(201).json(await repo.createField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/form-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByField(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  res.json(await repo.updateField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/drafts/:id/evidence', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  if (!text(req.body.evidence_type) || !text(req.body.description)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'evidence', message: '证据类型和说明不能为空' }] });
  res.status(201).json(await repo.createEvidence(draft, req.body || {}, req.session.userId));
}));

router.put('/evidence/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByEvidence(req.params.id);
  await assertCanEditDraft(req, repo, draft);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status') && text(req.body.status) === 'verified') {
    await assertCanVerifyEvidenceStatus(req);
  }
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
  await assertCanEditDraft(req, repo, draft);
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
router.ensureProcessDesignEvidenceStatusSchema = ensureProcessDesignEvidenceStatusSchema;

module.exports = router;
