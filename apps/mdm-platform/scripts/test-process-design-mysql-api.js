const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processDesignRouter = require('../server/routes/processDesignMysql');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function sessionForUser(key) {
  const sessions = {
    submitter: { personId: 10, userId: 10, userName: '经营部门主对接人', departmentId: 1 },
    targetDept: { personId: 30, userId: 30, userName: '工程部门主对接人', departmentId: 2 },
    reviewer: { personId: 20, userId: 20, userName: '部门MDM审核员', departmentId: 1 },
    mdmLead: { personId: 99, userId: 99, userName: 'MDM工作组组长', departmentId: 2 }
  };
  return sessions[key] || sessions.submitter;
}

async function request(baseUrl, userKey, routePath, options = {}) {
  const headers = {
    'X-Test-User': userKey,
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const res = await fetch(`${baseUrl}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

function makeFakeRepository() {
  const state = {
    draft: null,
    drafts: new Map(),
    document: null,
    versions: [],
    documentProfile: null,
    terms: [],
    processes: [],
    steps: [],
    stepTransitions: [],
    behaviorDetails: new Map(),
    handoffs: [],
    form: null,
    table: null,
    tableField: null,
    field: null,
    evidence: null,
    reviewTask: null,
    version: null,
    taxonomy: [
      { department_name: '经营发展部', l1_name: '市场开发与客户合同治理', l2_name: '客户合同评审管理', l3_count: 3 },
      { department_name: '经营发展部', l1_name: '产品设计全生命周期管理', l2_name: '设计更改管理', l3_count: 2 }
    ]
  };
  const calls = [];
  function outcome() {
    const activeSteps = state.steps.filter(step => step.status !== 'voided');
    return {
      formed: '已形成 1 条制度结构草稿',
      current: '当前内容可以保存制度说明或提交部门内审',
      missing: [],
      next: '提交审核或发布',
      counts: {
        steps: activeSteps.length,
        processes: state.processes.length,
        forms: state.form ? 1 : 0,
        fields: (state.mainField ? 1 : 0) + (state.detailField ? 1 : 0),
        evidence: state.evidence ? 1 : 0,
        publishableEvidence: state.evidence ? 1 : 0,
        risks: 0
      }
    };
  }
  return {
    calls,
    state,
    setDraftStatus(status) {
      state.draft = { ...state.draft, status };
      if (state.draft && state.draft.id) state.drafts.set(Number(state.draft.id), state.draft);
    },
    async summary(departmentIds, documentNo) {
      calls.push('summary');
      const documentFilter = String(documentNo || '').trim();
      const activeDrafts = Array.from(state.drafts.values()).filter(draft =>
        draft && draft.status !== 'published' && (!documentFilter || draft.document_no === documentFilter)
      );
      const versions = state.versions.filter(version => !documentFilter || version.document_no === documentFilter);
      return {
        summary: {
          totalDrafts: activeDrafts.length,
          publishedVersions: versions.length,
          byStatus: activeDrafts.reduce((result, draft) => {
            result[draft.status] = (result[draft.status] || 0) + 1;
            return result;
          }, {})
        },
        drafts: activeDrafts.map(draft => ({
          id: draft.id,
          process_name: draft.process_name,
          document_no: draft.document_no,
          document_title: draft.document_title,
          planned_edition: draft.planned_edition,
            status: draft.status
          })),
        versions: versions.slice().reverse()
      };
    },
    async lookupDocument(documentNo) {
      calls.push('lookupDocument');
      if (!state.document || state.document.document_no !== documentNo) {
        return {
          exists: false,
          document_no: documentNo,
          next_edition: 'A',
          can_create: true,
          message: '该制度编号可用，可创建 A版草稿'
        };
      }
      const activeDraft = Array.from(state.drafts.values()).find(draft => draft.document_no === documentNo && ['draft', 'needs_changes', 'submitted', 'under_review', 'approved'].includes(draft.status));
      const currentVersion = state.versions.find(version => version.status === 'published' && version.document_no === documentNo) || null;
      return {
        exists: true,
        document: state.document,
        current_version: currentVersion,
        current_edition: state.document.current_edition || null,
        next_edition: currentVersion ? 'B' : 'A',
        active_draft: activeDraft || null,
        can_create: !activeDraft,
        can_create_next: Boolean(currentVersion && !activeDraft),
        message: activeDraft ? '该制度编号已有进行中草稿' : '该制度编号可创建下一版次'
      };
    },
    async getDocumentById(documentId) {
      calls.push('getDocumentById');
      return state.document && Number(state.document.id) === Number(documentId) ? state.document : null;
    },
    async departmentExists(departmentId) {
      calls.push('departmentExists');
      return [1, 2].includes(Number(departmentId));
    },
    async listProcessTaxonomy(scope = {}) {
      calls.push('listProcessTaxonomy');
      const departmentNames = Array.isArray(scope.departmentNames)
        ? scope.departmentNames.map(name => String(name || '').trim()).filter(Boolean)
        : [];
      const scopedTaxonomy = departmentNames.length
        ? state.taxonomy.filter(item => departmentNames.includes(item.department_name))
        : state.taxonomy;
      return {
        items: scopedTaxonomy,
        l1Options: [...new Set(scopedTaxonomy.map(item => item.l1_name))]
      };
    },
    async listFieldTypes() {
      calls.push('listFieldTypes');
      return [
        { code: 'text', name: '文本' },
        { code: 'qrcode', name: '二维码' }
      ];
    },
    async listRosterRolesByDepartment(departmentId) {
      calls.push('listRosterRolesByDepartment');
      return {
        department_id: Number(departmentId),
        department_name: Number(departmentId) === 2 ? '工程技术部' : '经营发展部',
        roles: Number(departmentId) === 2 ? ['资料管理员', '工艺员'] : ['销售内勤']
      };
    },
    async createDraft(body, actorUserId, targetDeptId) {
      calls.push('createDraft');
      state.document = state.document || {
        id: 801,
        document_no: body.document_no,
        document_title: body.document_title || body.process_name,
        owning_department_id: targetDeptId,
        status: 'active',
        current_edition: null,
        current_version_id: null,
        created_by: actorUserId
      };
      state.draft = {
        id: 101,
        process_name: body.process_name,
        document_id: state.document.id,
        document_no: body.document_no,
        document_title: body.document_title || body.process_name,
        planned_edition: 'A',
        current_edition: null,
        base_version_id: null,
        reason: body.reason,
        basis_type: body.basis_type,
        basis_description: body.basis_description,
        involves_other_departments: Boolean(body.involves_other_departments),
        related_departments: body.related_departments || [],
        related_departments_json: JSON.stringify(body.related_departments || []),
        department_id: targetDeptId,
        department_name: '经营发展部',
        l1_status: 'unclassified',
        l2_status: 'unclassified',
        status: 'draft',
        created_by: actorUserId
      };
      state.drafts.set(state.draft.id, state.draft);
      return { ...state.draft, outcome: outcome() };
    },
    async createNextEditionDraft(documentId, actorUserId, targetDeptId) {
      calls.push('createNextEditionDraft');
      if (!state.document || Number(state.document.id) !== Number(documentId)) {
        const error = new Error('制度不存在');
        error.statusCode = 404;
        throw error;
      }
      const currentVersion = state.versions.find(version => version.status === 'published' && Number(version.document_id) === Number(documentId));
      state.draft = {
        id: 102,
        process_name: state.document.document_title,
        document_id: state.document.id,
        document_no: state.document.document_no,
        document_title: state.document.document_title,
        planned_edition: 'B',
        current_edition: state.document.current_edition,
        base_version_id: currentVersion && currentVersion.id,
        reason: '',
        basis_type: '现场实际',
        basis_description: '',
        involves_other_departments: false,
        related_departments: [],
        related_departments_json: JSON.stringify([]),
        department_id: targetDeptId || state.document.owning_department_id,
        department_name: '经营发展部',
        l1_status: 'unclassified',
        l2_status: 'unclassified',
        status: 'draft',
        created_by: actorUserId
      };
      state.drafts.set(state.draft.id, state.draft);
      state.documentProfile = null;
      return { ...state.draft, outcome: outcome() };
    },
    async getDraft(id) {
      calls.push(`getDraft:${id}`);
      return state.drafts.get(Number(id)) || null;
    },
    async getDraftByStep() {
      calls.push('getDraftByStep');
      return state.draft;
    },
    async getDraftByTerm() {
      calls.push('getDraftByTerm');
      return state.draft;
    },
    async getDraftByProcess() {
      calls.push('getDraftByProcess');
      return state.draft;
    },
    async getDraftByHandoff() {
      calls.push('getDraftByHandoff');
      return state.draft;
    },
    async getDraftByForm() {
      calls.push('getDraftByForm');
      return state.draft;
    },
    async getDraftByFormTable() {
      calls.push('getDraftByFormTable');
      return state.draft;
    },
    async getDraftByFormTableField() {
      calls.push('getDraftByFormTableField');
      return state.draft;
    },
    async getDraftByField() {
      calls.push('getDraftByField');
      return state.draft;
    },
    async getDraftByEvidence() {
      calls.push('getDraftByEvidence');
      return state.draft;
    },
    async detail(draftArg = state.draft) {
      calls.push('detail');
      const draft = typeof draftArg === 'number' ? state.drafts.get(Number(draftArg)) : draftArg;
      const draftId = Number((draft || state.draft || {}).id);
      const terms = state.terms.filter(item => Number(item.draft_id) === draftId);
      const processes = state.processes.filter(item => Number(item.draft_id) === draftId);
      const steps = state.steps.filter(item => Number(item.draft_id) === draftId);
      return {
        draft: state.drafts.get(draftId) || state.draft,
        document: state.document,
        documentProfile: state.documentProfile && Number(state.documentProfile.draft_id) === draftId ? state.documentProfile : null,
        versions: state.versions,
        terms,
        processes,
        steps: steps.map(step => ({
          ...step,
          behaviorDetail: state.behaviorDetails.get(step.id) || null,
          handoffs: state.handoffs.filter(handoff => handoff.step_id === step.id)
        })),
        stepTransitions: state.stepTransitions.filter(item => Number(item.draft_id) === draftId),
        forms: state.form && Number(state.form.draft_id) === draftId ? [{
          ...state.form,
          fields: state.mainField ? [state.mainField] : [],
          main_fields: state.mainField ? [state.mainField] : [],
          tables: state.table ? [{ ...state.table, fields: state.detailField ? [state.detailField] : [] }] : []
        }] : [],
        evidence: state.evidence && Number(state.evidence.draft_id) === draftId ? [state.evidence] : [],
        risks: [],
        reviewTasks: state.reviewTask ? [state.reviewTask] : [],
        events: [],
        outcome: outcome()
      };
    },
    async updateDraft(draft, body) {
      calls.push('updateDraft');
      state.draft = { ...draft, ...body };
      state.drafts.set(Number(state.draft.id), state.draft);
      return { ...state.draft, outcome: outcome() };
    },
    async deleteDraft(draft) {
      calls.push('deleteDraft');
      const deletedId = Number(draft.id);
      state.drafts.delete(deletedId);
      state.draft = null;
      if (state.document && !state.document.current_version_id) state.document = null;
      state.documentProfile = null;
      state.terms = [];
      state.processes = [];
      state.steps = [];
      state.stepTransitions = [];
      state.behaviorDetails.clear();
      state.handoffs = [];
      state.form = null;
      state.table = null;
      state.tableField = null;
      state.mainField = null;
      state.detailField = null;
      state.evidence = null;
      state.reviewTask = null;
      return { deleted: true, id: deletedId };
    },
    async saveDocumentProfile(draft, body, actorUserId) {
      calls.push('saveDocumentProfile');
      state.documentProfile = {
        id: 151,
        draft_id: draft.id,
        document_title: draft.document_title || body.document_title,
        document_no: draft.document_no || body.document_no || null,
        purpose: body.purpose,
        scope: body.scope,
        inheritance_relation: body.inheritance_relation,
        created_by: actorUserId
      };
      return state.documentProfile;
    },
    async createTerm(draft, body, actorUserId) {
      calls.push('createTerm');
      const term = {
        id: 161 + state.terms.length,
        draft_id: draft.id,
        term_name: body.term_name,
        definition: body.definition,
        applies_to: body.applies_to || null,
        created_by: actorUserId
      };
      state.terms.push(term);
      return term;
    },
    async updateTerm(draft, termId, body) {
      calls.push('updateTerm');
      const index = state.terms.findIndex(term => Number(term.id) === Number(termId));
      state.terms[index] = {
        ...state.terms[index],
        term_name: body.term_name,
        definition: body.definition,
        applies_to: body.applies_to || null
      };
      return state.terms[index];
    },
    async deleteTerm(draft, termId) {
      calls.push('deleteTerm');
      state.terms = state.terms.filter(term => Number(term.id) !== Number(termId));
      return { deleted: true, id: Number(termId) };
    },
    async createProcess(draft, body, actorUserId) {
      calls.push('createProcess');
      const draftProcesses = state.processes.filter(process => Number(process.draft_id) === Number(draft.id));
      const process = {
        id: 181 + state.processes.length,
        draft_id: draft.id,
        l1_name: body.l1_name,
        l2_name: body.l2_name,
        l3_name: body.l3_name,
        process_code: `PROCEDURE-${draft.id}-${String(draftProcesses.length + 1).padStart(3, '0')}`,
        process_type: body.process_type || 'new',
        created_by: actorUserId
      };
      state.processes.push(process);
      return process;
    },
    async updateProcess(draft, processId, body) {
      calls.push('updateProcess');
      const index = state.processes.findIndex(process => Number(process.id) === Number(processId));
      state.processes[index] = {
        ...state.processes[index],
        process_type: body.process_type || 'new',
        l1_name: body.l1_name,
        l2_name: body.l2_name,
        l3_name: body.l3_name,
        description: body.description || null
      };
      return state.processes[index];
    },
    async deleteProcess(draft, processId) {
      calls.push('deleteProcess');
      if (state.steps.some(step => Number(step.process_id) === Number(processId))) {
        const error = new Error('这个流程下面还有业务行为，请先改挂或处理行为');
        error.statusCode = 409;
        error.payload = { error: error.message };
        throw error;
      }
      state.processes = state.processes.filter(process => Number(process.id) !== Number(processId));
      return { deleted: true, id: Number(processId) };
    },
    async createStep(draft, body, actorUserId) {
      calls.push('createStep');
      const step = { id: 201 + state.steps.length, draft_id: draft.id, process_id: Number(body.process_id), step_type: body.step_type || 'action', step_name: body.step_name, actor_role: body.actor_role || null, input_materials: body.input_materials || null, output_result: body.output_result || null, status: 'active', created_by: actorUserId };
      state.steps.push(step);
      return step;
    },
    async createStepTransition(draft, body, actorUserId) {
      calls.push('createStepTransition');
      const transition = {
        id: 271 + state.stepTransitions.length,
        draft_id: draft.id,
        process_id: Number(body.process_id),
        from_step_id: Number(body.from_step_id),
        to_step_id: body.to_step_id == null ? null : Number(body.to_step_id),
        condition_text: body.condition_text,
        created_by: actorUserId
      };
      state.stepTransitions.push(transition);
      return transition;
    },
    async updateStep(draft, stepId, body) {
      calls.push('updateStep');
      const index = state.steps.findIndex(step => Number(step.id) === Number(stepId));
      state.steps[index] = { ...state.steps[index], id: stepId, ...body };
      if (Object.prototype.hasOwnProperty.call(body, 'process_id')) state.steps[index].process_id = Number(body.process_id);
      return state.steps[index];
    },
    async saveBehaviorDetail(draft, stepId, body, actorUserId) {
      calls.push('saveBehaviorDetail');
      const current = state.behaviorDetails.get(Number(stepId));
      if (current && current.is_cross_department && !Boolean(body.is_cross_department) && state.handoffs.some(handoff => Number(handoff.step_id) === Number(stepId))) {
        const error = new Error('已经存在跨部门承接记录，不能改为非跨部门');
        error.statusCode = 409;
        error.payload = { error: error.message };
        throw error;
      }
      const detail = {
        id: 251,
        step_id: stepId,
        precondition: body.precondition,
        trigger_scene: body.trigger_scene,
        execution_standard: body.execution_standard,
        delivery_object: body.delivery_object,
        requires_approval: Boolean(body.requires_approval),
        is_cross_department: Boolean(body.is_cross_department),
        created_by: actorUserId
      };
      state.behaviorDetails.set(Number(stepId), detail);
      return detail;
    },
    async deleteStep(draft, stepId, options = {}) {
      calls.push('deleteStep');
      const index = state.steps.findIndex(step => Number(step.id) === Number(stepId));
      const hasHandoff = state.handoffs.some(handoff => Number(handoff.step_id) === Number(stepId));
      const hasForm = state.form && Number(state.form.step_id || 0) === Number(stepId);
      const detail = state.behaviorDetails.get(Number(stepId));
      const hasDetail = detail && ['precondition', 'trigger_scene', 'execution_standard', 'delivery_object', 'approval_note']
        .some(field => detail[field]) || (detail && (detail.requires_approval || detail.is_cross_department));
      if (options.mode === 'delete') {
        if (hasHandoff || hasForm || hasDetail) {
          const error = new Error('这个业务行为已有承接、表单或详情，不能物理删除，请作废');
          error.statusCode = 409;
          error.payload = { error: error.message };
          throw error;
        }
        state.steps.splice(index, 1);
        return { deleted: true, id: Number(stepId) };
      }
      state.steps[index] = {
        ...state.steps[index],
        status: 'voided',
        void_reason: options.reason || '录入后作废',
        voided_by: options.actorUserId || null,
        voided_at: '2026-07-01T00:00:00.000Z'
      };
      return state.steps[index];
    },
    async createHandoff(draft, stepId, body, actorUserId) {
      calls.push('createHandoff');
      const handoff = {
        id: 261 + state.handoffs.length,
        step_id: stepId,
        target_department: body.target_department,
        target_process_code: null,
        target_process_name: null,
        target_behavior_code: null,
        target_behavior_name: null,
        handoff_standard: body.handoff_standard || null,
        status: 'pending_return',
        created_by: actorUserId
      };
      state.handoffs.push(handoff);
      return handoff;
    },
    async getHandoff(id) {
      calls.push('getHandoff');
      return state.handoffs.find(handoff => Number(handoff.id) === Number(id)) || null;
    },
    async acceptHandoffReturn(draft, handoffId, body, actorUserId) {
      calls.push('acceptHandoffReturn');
      const index = state.handoffs.findIndex(handoff => Number(handoff.id) === Number(handoffId));
      state.handoffs[index] = {
        ...state.handoffs[index],
        target_process_code: body.target_process_code,
        target_process_name: body.target_process_name,
        target_behavior_code: body.target_behavior_code,
        target_behavior_name: body.target_behavior_name,
        status: 'returned',
        returned_by: actorUserId
      };
      return state.handoffs[index];
    },
    async createForm(draft, body, actorUserId) {
      calls.push('createForm');
      state.form = {
        id: 301,
        draft_id: draft.id,
        step_id: body.step_id ? Number(body.step_id) : null,
        form_code: 'FM-CX-ZD-001-A-001',
        form_name: body.form_name,
        main_table_code: 'FM-CX-ZD-001-A-001-M',
        main_table_name: body.main_table_name || '主表',
        archive_location: body.archive_location || null,
        retention_period: body.retention_period || null,
        responsible_department_id: body.responsible_department_id || null,
        responsible_department_name: body.responsible_department_name || null,
        responsible_role: body.responsible_role || null,
        created_by: actorUserId
      };
      return state.form;
    },
    async updateForm(draft, formId, body) {
      calls.push('updateForm');
      state.form = { ...state.form, id: formId, ...body };
      return state.form;
    },
    async createFormTable(draft, formId, body, actorUserId) {
      calls.push('createFormTable');
      state.table = {
        id: 351,
        form_id: formId,
        table_kind: 'detail',
        table_no: 'FM-CX-ZD-001-A-001-D',
        table_code: 'FM-CX-ZD-001-A-001-D',
        table_name: body.table_name,
        created_by: actorUserId
      };
      return state.table;
    },
    async createFormTableField(draft, tableId, body, actorUserId) {
      calls.push('createFormTableField');
      const structureKind = body.structure_kind || 'detail';
      const field = {
        id: structureKind === 'main' ? 361 : 362,
        form_id: structureKind === 'main' ? tableId : state.form && state.form.id,
        form_table_id: structureKind === 'main' ? null : tableId,
        structure_kind: structureKind,
        field_name: body.field_name,
        field_no: structureKind === 'main' ? 'FM-CX-ZD-001-A-001-M-001' : 'FM-CX-ZD-001-A-001-D-001',
        field_code: structureKind === 'main' ? 'FM-CX-ZD-001-A-001-M-001' : 'FM-CX-ZD-001-A-001-D-001',
        field_type: body.field_type,
        required: Boolean(body.required),
        enum_options: body.enum_options || null,
        created_by: actorUserId
      };
      if (structureKind === 'main') state.mainField = field;
      else state.detailField = field;
      state.tableField = field;
      return field;
    },
    async updateFormTableField(draft, fieldId, body) {
      calls.push('updateFormTableField');
      const target = Number(fieldId) === Number(state.mainField && state.mainField.id) ? 'mainField' : 'detailField';
      state[target] = {
        ...state[target],
        id: Number(fieldId),
        ...body
      };
      state.tableField = state[target];
      return state.tableField;
    },
    async deleteFormTableField(draft, fieldId) {
      calls.push('deleteFormTableField');
      state.deletedFieldId = Number(fieldId);
      return { ok: true };
    },
    async createEvidence(draft, body, actorUserId) {
      calls.push('createEvidence');
      state.evidence = { id: 501, draft_id: draft.id, evidence_type: body.evidence_type, description: body.description, maturity: '可支撑发布', created_by: actorUserId };
      return state.evidence;
    },
    async updateEvidence(draft, evidenceId, body) {
      calls.push('updateEvidence');
      state.evidence = { ...state.evidence, id: evidenceId, ...body };
      return state.evidence;
    },
    async buildRisks() {
      calls.push('buildRisks');
      return [];
    },
    async outcomeForDraft() {
      calls.push('outcomeForDraft');
      return outcome();
    },
    async getCounts() {
      calls.push('getCounts');
      return outcome().counts;
    },
    async submitDraft(draft) {
      calls.push('submitDraft');
      state.draft = { ...draft, status: 'submitted' };
      state.reviewTask = { id: 601, draft_id: draft.id, status: 'pending', task_type: 'department_review' };
      return { draft: state.draft, reviewTask: state.reviewTask, outcome: outcome() };
    },
    async getReviewTask(id) {
      calls.push('getReviewTask');
      return Number(id) === 601 ? state.reviewTask : null;
    },
    async decideReviewTask(task, decision) {
      calls.push('decideReviewTask');
      state.reviewTask = { ...task, status: decision === 'approve' ? 'approved' : decision };
      state.draft = { ...state.draft, status: state.reviewTask.status };
      return { draft: state.draft, reviewTask: state.reviewTask };
    },
    async publishDraft(draft) {
      calls.push('publishDraft');
      const options = arguments[3] || {};
      if (draft.base_version_id && !options.confirm_complete_rewrite) {
        const error = new Error('发布下一版次前请确认新版已完整重写');
        error.statusCode = 409;
        error.payload = { error: error.message, edition_diff: await this.editionDiff(draft) };
        throw error;
      }
      if (draft.base_version_id) {
        state.versions = state.versions.map(version => Number(version.id) === Number(draft.base_version_id) ? { ...version, status: 'superseded' } : version);
      }
      const version = {
        id: 701 + state.versions.length,
        draft_id: draft.id,
        document_id: draft.document_id,
        document_no: draft.document_no,
        document_title: draft.document_title,
        edition: draft.planned_edition,
        version_no: `${draft.document_no}-${draft.planned_edition}`,
        status: 'published',
        supersedes_version_id: draft.base_version_id || null
      };
      state.versions.push(version);
      state.version = version;
      state.document = {
        ...state.document,
        current_edition: version.edition,
        current_version_id: version.id
      };
      state.draft = { ...draft, status: 'published' };
      state.drafts.set(Number(state.draft.id), state.draft);
      return { draft: state.draft, version: state.version, outcome: outcome() };
    },
    async editionDiff(draft) {
      calls.push('editionDiff');
      if (!draft.base_version_id) {
        return { base_edition: null, planned_edition: draft.planned_edition || 'A', missing: { processes: [], steps: [], forms: [] } };
      }
      return {
        base_edition: 'A',
        planned_edition: draft.planned_edition || 'B',
        missing: {
          processes: ['客户需求变更受理'],
          steps: ['确认技术影响'],
          forms: ['需求变更单']
        }
      };
    },
    async markdownForDraft() {
      calls.push('markdownForDraft');
      const draft = state.draft || {};
      return {
        filename: `${draft.document_no || 'CX-ZD-001'}-${draft.document_title || '客户需求变更管理制度'}-${draft.planned_edition || 'A'}版.md`,
        markdown: `# ${draft.document_no || 'CX-ZD-001'} ${draft.document_title || '客户需求变更管理制度'} ${draft.planned_edition || 'A'}版\n\n## 目的\n统一客户需求变更入口\n\n## 附表结构\n- 主表：需求变更主表`
      };
    }
  };
}

async function main() {
  assert.doesNotThrow(() => processDesignRouter.assertWorkRoleBindingsSupported({ schema_version: 'document-structured-output-v2' }), 'legacy v2 without work_role_bindings should remain supported');
  assert.doesNotThrow(() => processDesignRouter.assertWorkRoleBindingsSupported({ schema_version: 'document-structured-output-v2', work_role_bindings: [] }), 'empty work_role_bindings should remain supported');
  assert.doesNotThrow(
    () => processDesignRouter.assertWorkRoleBindingsSupported({
      schema_version: 'document-structured-output-v2',
      structure_block_projection: { work_role_bindings: [] }
    }),
    'empty projected work_role_bindings should remain supported'
  );
  assert.throws(
    () => processDesignRouter.assertWorkRoleBindingsSupported({ schema_version: 'document-structured-output-v2', work_role_bindings: [{}] }),
    error => error && error.statusCode === 422 && error.payload?.code === 'WORK_ROLE_BINDINGS_UNSUPPORTED',
    'non-empty work_role_bindings should be rejected explicitly'
  );
  assert.throws(
    () => processDesignRouter.assertWorkRoleBindingsSupported({
      schema_version: 'document-structured-output-v2',
      structure_block_projection: { work_role_bindings: [{}] }
    }),
    error => error && error.statusCode === 422 && error.payload?.code === 'WORK_ROLE_BINDINGS_UNSUPPORTED',
    'non-empty projected work_role_bindings should be rejected explicitly'
  );
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/processDesignMysql.js'), 'utf8');
  assert.ok(!routeSource.includes("require('../db')"), 'process design MySQL route must not load server/db.js');
  assert.ok(!routeSource.includes('better-sqlite3'), 'process design MySQL route must not use better-sqlite3');
  const indexSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.ok(indexSource.includes("process.env.PROCESS_GOVERNANCE_READ_MODEL === 'mysql' ? 'processDesignMysql' : 'processDesign'"), 'server must select MySQL process design route under MySQL process governance mode');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_drafts'), 'MySQL schema must include process design drafts');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_documents'), 'MySQL schema must include process design documents');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_versions'), 'MySQL schema must include process design versions');
  assert.ok(mdmMysqlSchemaSql().includes('UNIQUE KEY uq_process_design_documents_no (document_no)'), '制度编号 must be company-wide unique');
  assert.ok(mdmMysqlSchemaSql().includes('document_no VARCHAR(128) NOT NULL'), 'drafts and versions must persist document_no from draft stage');
  assert.ok(mdmMysqlSchemaSql().includes('planned_edition VARCHAR(16) NOT NULL'), 'drafts must persist backend-generated planned edition');
  assert.ok(mdmMysqlSchemaSql().includes('edition VARCHAR(16) NOT NULL'), 'versions must persist backend-generated edition');
  assert.ok(mdmMysqlSchemaSql().includes('UNIQUE KEY uq_process_design_versions_document_edition (document_no, edition)'), 'document_no + edition must be unique');
  assert.ok(mdmMysqlSchemaSql().includes('document_edition VARCHAR(16) NULL'), 'process projections must carry document edition');
  assert.ok(
    mdmMysqlSchemaSql().includes("status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'"),
    'process_design_evidence must carry evidence status enum'
  );
  assert.ok(mdmMysqlSchemaSql().includes('process_code VARCHAR(128) NOT NULL'), 'process design procedure code must be required');
  assert.ok(mdmMysqlSchemaSql().includes('UNIQUE KEY uq_process_design_processes_code (process_code)'), 'process design procedure code must be unique');
  assert.ok(mdmMysqlSchemaSql().includes('form_code VARCHAR(160) NULL'), 'forms must persist system-generated form code');
  assert.ok(mdmMysqlSchemaSql().includes('main_table_code VARCHAR(180) NULL'), 'forms must persist hidden main table code');
  assert.ok(mdmMysqlSchemaSql().includes('main_table_name VARCHAR(255) NULL'), 'forms must persist editable main table name');
  assert.ok(mdmMysqlSchemaSql().includes("archive_location ENUM('部门自行保存','资料室') NULL"), 'forms must persist archive location enum');
  assert.ok(mdmMysqlSchemaSql().includes("retention_period ENUM('1年','3年','10年','永久') NULL"), 'forms must persist retention period enum');
  assert.ok(mdmMysqlSchemaSql().includes('responsible_department_id BIGINT NULL'), 'forms must persist archive responsible department');
  assert.ok(mdmMysqlSchemaSql().includes('responsible_role VARCHAR(255) NULL'), 'forms must persist archive responsible roster role');
  assert.ok(mdmMysqlSchemaSql().includes('CREATE TABLE IF NOT EXISTS process_design_field_types'), 'schema must include process design field type dictionary');
  assert.ok(mdmMysqlSchemaSql().includes('二维码'), 'field type dictionary seed must include QR code type');
  assert.ok(mdmMysqlSchemaSql().includes("structure_kind ENUM('main','detail') NOT NULL"), 'unified table fields must distinguish main/detail structures');
  assert.ok(mdmMysqlSchemaSql().includes('field_code VARCHAR(220) NULL'), 'fields must persist hidden generated field code');
  assert.ok(mdmMysqlSchemaSql().includes('enum_options TEXT NULL'), 'fields must persist enum options');
  assert.ok(routeSource.includes('FROM process_mapping_records r'), 'process taxonomy should read L1/L2 from MySQL process_mapping_records');
  assert.ok(routeSource.includes('currentDepartmentTaxonomyScope'), 'process taxonomy API should scope options to current department');
  assert.ok(routeSource.includes('PROCEDURE-'), 'process design route should generate Procedure business codes');
  assert.ok(routeSource.includes("assertNoManualNumber(body, 'process_code', '流程编号')"), 'process design route should reject manual process codes');
  assert.ok(routeSource.includes("router.delete('/drafts/:id'"), 'process design route should allow deleting editable drafts');
  assert.ok(routeSource.includes("status='verified'"), 'publish gate must check evidence.status=verified');
  assert.ok(routeSource.includes('verified_evidence_count'), 'publish event payload must include verified_evidence_count');
  assert.ok(routeSource.includes('ensureProcessDesignEvidenceStatusSchema'), 'schema init should expose evidence status migration');
  assert.ok(routeSource.includes('ensureProcessDesignFormStructureSchema'), 'schema init should expose form structure migration');
  assert.ok(routeSource.includes("router.get('/field-types'"), 'process design route should expose field type dictionary');
  assert.ok(routeSource.includes("router.get('/departments/:id/roster-roles'"), 'process design route should expose roster-derived department roles');
  assert.ok(routeSource.includes('FM-'), 'process design route should generate form and field codes with FM prefix');
  assert.ok(routeSource.includes('ENGINEERING_ARCHIVE_ROOM_DEPARTMENT_NAME'), 'archive room default department should be explicit');
  assert.ok(routeSource.includes("router.get('/documents/lookup'"), 'process design route should expose document number lookup');
  assert.ok(routeSource.includes("router.post('/documents/:id/drafts'"), 'process design route should expose next-edition draft creation');
  assert.ok(routeSource.includes("router.post('/import-structured-output'"), 'process design route should import 3001 structured-output JSON');
  assert.ok(routeSource.includes('document-structured-output-v2'), 'process design import should enforce the structured-output schema version');
  assert.ok(routeSource.includes('doc.current_edition'), 'draft summary should read current edition from document master');
  assert.ok(!routeSource.includes('d.current_edition'), 'draft table must not be queried for current edition');
  assert.ok(routeSource.includes('function nextEdition'), 'route should generate A/B/C/AA editions server-side');
  assert.ok(routeSource.includes('confirm_complete_rewrite'), 'B/C publish should require complete rewrite confirmation');
  assert.ok(routeSource.includes('superseded'), 'publishing a new edition should supersede the previous current edition');
  [
    'process_design_document_profiles',
    'process_design_processes',
    'process_design_terms',
    'process_design_behavior_details',
    'process_design_cross_dept_handoffs',
    'process_design_form_tables',
    'process_design_form_table_fields'
  ].forEach(tableName => {
    assert.ok(mdmMysqlSchemaSql().includes(`CREATE TABLE IF NOT EXISTS ${tableName}`), `MySQL schema must include ${tableName}`);
  });
  assert.ok(mdmMysqlSchemaSql().includes('status VARCHAR(32) NOT NULL DEFAULT'), 'process design steps must keep active/voided status');
  assert.ok(mdmMysqlSchemaSql().includes('void_reason TEXT NULL'), 'process design steps must keep void reason');

  const permissionsByUser = new Map([
    [10, ['governance:read-department', 'governance:draft-department', 'governance:submit-department']],
    [30, ['governance:read-department', 'governance:draft-department', 'governance:submit-department']],
    [20, ['governance:read-department', 'governance:review-department', 'governance:record-department-decision']],
    [99, ['governance:read-global', 'governance:assign-work', 'governance:structure-gate', 'governance:publish']]
  ]);
  const rolesByUser = new Map([
    [10, [{ code: 'department_contact' }]],
    [30, [{ code: 'department_contact' }]],
    [20, [{ code: 'department_mdm_reviewer' }]],
    [99, [{ code: 'mdm_lead' }]]
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      return { permSet: new Set(permissionsByUser.get(userId) || []), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return rolesByUser.get(userId) || [{ code: legacyRole }];
    },
    async getDepartmentById(departmentId) {
      return { id: departmentId, name: departmentId === 1 ? '经营发展部' : '工程技术部' };
    },
    async getDepartmentByName(departmentName) {
      if (departmentName === '经营发展部') return { id: 1, name: '经营发展部' };
      if (departmentName === '工程技术部') return { id: 2, name: '工程技术部' };
      return null;
    },
    async getUserById(userId) {
      return { id: userId, personId: userId, name: `用户${userId}` };
    }
  }));

  const fakeRepo = makeFakeRepository();
  let repositoryFactoryCalls = 0;
  processDesignRouter.setProcessDesignRepositoryFactory(() => {
    repositoryFactoryCalls += 1;
    return fakeRepo;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessionForUser(req.get('X-Test-User'));
    next();
  });
  app.use('/api/process-design', processDesignRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const summary = await request(baseUrl, 'submitter', '/api/process-design/summary');
    assert.strictEqual(summary.res.status, 200);

    const invalidStructuredImport = await request(baseUrl, 'submitter', '/api/process-design/import-structured-output', {
      method: 'POST',
      body: JSON.stringify({ schema_version: 'legacy-json', draft: {} })
    });
    assert.strictEqual(invalidStructuredImport.res.status, 422, JSON.stringify(invalidStructuredImport.body));
    assert.ok(JSON.stringify(invalidStructuredImport.body).includes('document-structured-output-v2'), 'import should reject non-standard structured-output JSON');

    const structuredImportPayload = {
      schema_version: 'document-structured-output-v2',
      draft: {
        document_no: 'CX-ZD-IMPORT',
        document_title: '结构化导入制度',
        process_name: '结构化导入制度',
        basis_type: '制度 / 规程',
        involves_other_departments: true,
        related_departments: ['工程技术部'],
        department: { department_id: 1, department_name: '经营发展部' }
      },
      document_profile: {
        document_no: 'CX-ZD-IMPORT',
        document_title: '结构化导入制度',
        purpose: '验证 3001 输出物可以导入 3000',
        scope: '适用于结构化输出联调',
        inheritance_relation: '承接文档结构化输出标准 Schema'
      },
      terms: [
        { term_ref: 'term_1', term_name: '结构化输出', definition: '按统一数据模型整理制度内容', applies_to: '结构化导入制度' }
      ],
      processes: [
        {
          process_ref: 'proc_1',
          process_type: 'new',
          l1_name: '市场开发与客户合同治理',
          l2_name: '客户合同评审管理',
          l3_name: '结构化导入流程',
          description: '从结构化文件导入制度流程'
        }
      ],
      steps: [
        {
          step_ref: 'step_1',
          process_ref: 'proc_1',
          step_type: 'action',
          step_name: '接收结构化文件',
          actor_role: '销售内勤',
          input_materials: '3001 导出的结构化 JSON',
          output_result: '形成 MDM 制度结构草稿'
        },
        {
          step_ref: 'step_2',
          process_ref: 'proc_1',
          step_type: 'decision',
          step_name: '判断结构化文件是否完整',
          actor_role: '销售内勤',
          input_materials: '结构化字段填报结果',
          output_result: '形成完整性判断结论'
        }
      ],
      behavior_details: [
        {
          step_ref: 'step_1',
          precondition: '已经从 3001 导出结构化文件',
          trigger_scene: '需要进入 MDM 平台继续治理',
          execution_standard: '导入后能看到制度、流程、行为、表单和字段',
          delivery_object: 'MDM 制度结构草稿',
          requires_approval: false,
          is_cross_department: false
        },
        {
          step_ref: 'step_2',
          precondition: '结构化文件已经接收',
          trigger_scene: '提交前需要判断内容完整性',
          execution_standard: '业务行为、执行角色、输入材料、输出结果、执行标准均已填写',
          delivery_object: '完整性判断结论',
          requires_approval: false,
          is_cross_department: false
        }
      ],
      step_transitions: [
        {
          transition_ref: 'trans_1',
          process_ref: 'proc_1',
          from_step_ref: 'step_2',
          condition: '完整',
          to_step_ref: 'step_1',
          evidence_refs: []
        },
        {
          transition_ref: 'trans_2',
          process_ref: 'proc_1',
          from_step_ref: 'step_2',
          condition: '不完整',
          to_step_ref: null,
          evidence_refs: []
        }
      ],
      forms: [
        {
          form_ref: 'form_1',
          step_ref: 'step_1',
          form_code: 'SOURCE-FORM-CODE-SHOULD-NOT-BE-USED',
          form_name: '结构化导入确认单',
          main_table_name: '结构化导入主表',
          archive_location: '资料室',
          retention_period: '10年',
          responsible_department_name: '工程技术部',
          responsible_role: '资料管理员'
        }
      ],
      form_tables: [
        { table_ref: 'table_1', form_ref: 'form_1', table_kind: 'main', table_name: '结构化导入主表' }
      ],
      form_table_fields: [
        {
          table_field_ref: 'table_field_1',
          table_ref: 'table_1',
          structure_kind: 'main',
          field_name: '客户名称',
          field_type: '文本',
          required: true,
          description: '来自 3001 结构化文件'
        }
      ],
      evidence_catalog: [
        {
          evidence_ref: 'EV-DOC-001',
          object_type: 'draft',
          evidence_type: '制度条款',
          description: '导入制度文件中的原文片段。',
          source_name: '结构化导入制度.docx',
          source_anchor: '导入文件',
          status: 'pending_review'
        }
      ],
      work_role_bindings: []
    };
    const repositoryCallsBeforeUnsupportedImport = fakeRepo.calls.length;
    const repositoryFactoryCallsBeforeUnsupportedImport = repositoryFactoryCalls;
    const unsupportedWorkRoleBindingsImport = await request(baseUrl, 'submitter', '/api/process-design/import-structured-output', {
      method: 'POST',
      body: JSON.stringify({
        ...structuredImportPayload,
        work_role_bindings: [
          {
            step_ref: 'step_1',
            source_role_text: '销售内勤',
            work_role_id: 'WR-SALES-001'
          }
        ]
      })
    });
    assert.strictEqual(unsupportedWorkRoleBindingsImport.res.status, 422, JSON.stringify(unsupportedWorkRoleBindingsImport.body));
    assert.strictEqual(unsupportedWorkRoleBindingsImport.body.code, 'WORK_ROLE_BINDINGS_UNSUPPORTED');
    assert.strictEqual(unsupportedWorkRoleBindingsImport.body.error, '校验失败');
    assert.ok(
      unsupportedWorkRoleBindingsImport.body.details.some(detail => detail.field === 'work_role_bindings' && /当前 MDM 尚不承接工作角色绑定/.test(detail.message)),
      'unsupported work role bindings should return a business-readable explanation'
    );
    assert.deepStrictEqual(
      fakeRepo.calls.slice(repositoryCallsBeforeUnsupportedImport),
      [],
      'unsupported work role bindings should be rejected before any repository read or write'
    );
    assert.strictEqual(
      repositoryFactoryCalls,
      repositoryFactoryCallsBeforeUnsupportedImport,
      'unsupported work role bindings should be rejected before repository initialization'
    );
    assert.strictEqual(fakeRepo.state.draft, null, 'unsupported work role bindings must not create a draft');

    const repositoryCallsBeforeUnsupportedProjectionImport = fakeRepo.calls.length;
    const repositoryFactoryCallsBeforeUnsupportedProjectionImport = repositoryFactoryCalls;
    const unsupportedProjectedWorkRoleBindingsImport = await request(baseUrl, 'submitter', '/api/process-design/import-structured-output', {
      method: 'POST',
      body: JSON.stringify({
        ...structuredImportPayload,
        work_role_bindings: [],
        structure_block_projection: {
          ...(structuredImportPayload.structure_block_projection || {}),
          work_role_bindings: [
            {
              binding_ref: 'WRB-PROJECTION-001',
              process_ref: 'proc_1',
              step_ref: 'step_1',
              work_role_code: 'WR-0001'
            }
          ]
        }
      })
    });
    assert.strictEqual(unsupportedProjectedWorkRoleBindingsImport.res.status, 422, JSON.stringify(unsupportedProjectedWorkRoleBindingsImport.body));
    assert.strictEqual(unsupportedProjectedWorkRoleBindingsImport.body.code, 'WORK_ROLE_BINDINGS_UNSUPPORTED');
    assert.deepStrictEqual(
      fakeRepo.calls.slice(repositoryCallsBeforeUnsupportedProjectionImport),
      [],
      'unsupported projected work role bindings should be rejected before any repository read or write'
    );
    assert.strictEqual(
      repositoryFactoryCalls,
      repositoryFactoryCallsBeforeUnsupportedProjectionImport,
      'unsupported projected work role bindings should be rejected before repository initialization'
    );
    assert.strictEqual(fakeRepo.state.draft, null, 'unsupported projected work role bindings must not create a draft');

    const structuredImport = await request(baseUrl, 'submitter', '/api/process-design/import-structured-output', {
      method: 'POST',
      body: JSON.stringify(structuredImportPayload)
    });
    assert.strictEqual(structuredImport.res.status, 201, JSON.stringify(structuredImport.body));
    assert.strictEqual(structuredImport.body.draft.document_no, 'CX-ZD-IMPORT');
    assert.strictEqual(structuredImport.body.imported.processes, 1);
    assert.strictEqual(structuredImport.body.imported.steps, 2);
    assert.strictEqual(structuredImport.body.imported.step_transitions, 2);
    assert.strictEqual(structuredImport.body.imported.forms, 1);
    assert.strictEqual(structuredImport.body.imported.form_table_fields, 1);
    assert.strictEqual(structuredImport.body.imported.evidence, 1);
    assert.ok(structuredImport.body.warnings.some(item => item.object_type === 'step_transitions' && /流向/.test(item.message)), 'empty branch targets should import with a clear warning');

    const importedDetail = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(importedDetail.res.status, 200, JSON.stringify(importedDetail.body));
    assert.strictEqual(importedDetail.body.documentProfile.purpose, '验证 3001 输出物可以导入 3000');
    assert.strictEqual(importedDetail.body.terms[0].term_name, '结构化输出');
    assert.strictEqual(importedDetail.body.processes[0].l3_name, '结构化导入流程');
    assert.strictEqual(importedDetail.body.steps[0].step_name, '接收结构化文件');
    assert.strictEqual(importedDetail.body.steps[1].step_type, 'decision');
    assert.strictEqual(importedDetail.body.steps[0].behaviorDetail.delivery_object, 'MDM 制度结构草稿');
    assert.strictEqual(importedDetail.body.stepTransitions.length, 2);
    assert.strictEqual(importedDetail.body.stepTransitions[0].condition_text, '完整');
    assert.strictEqual(importedDetail.body.stepTransitions[1].to_step_id, null);
    assert.strictEqual(importedDetail.body.forms[0].form_code, 'FM-CX-ZD-001-A-001', 'MDM should generate its own form code during import');
    assert.strictEqual(importedDetail.body.forms[0].main_fields[0].field_name, '客户名称');

    const deleteImportedDraft = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', { method: 'DELETE' });
    assert.strictEqual(deleteImportedDraft.res.status, 200, JSON.stringify(deleteImportedDraft.body));

    const structuredImportByDepartmentName = {
      schema_version: 'document-structured-output-v2',
      draft: {
        document_no: 'CX-ZD-IMPORT-BY-DEPT-NAME',
        document_title: '按部门名称导入制度',
        process_name: '按部门名称导入制度',
        basis_type: '制度 / 规程',
        department: { department_name: '经营发展部' }
      },
      document_profile: {
        purpose: '验证 3001 输出物只有部门名称时也能导入 3000',
        scope: '适用于结构化输出联调'
      },
      processes: [
        {
          process_ref: 'proc_1',
          process_type: 'new',
          l1_name: '市场开发与客户合同治理',
          l2_name: '客户合同评审管理',
          l3_name: '按部门名称导入流程'
        }
      ],
      steps: [],
      step_transitions: []
    };
    const importByDepartmentName = await request(baseUrl, 'submitter', '/api/process-design/import-structured-output', {
      method: 'POST',
      body: JSON.stringify(structuredImportByDepartmentName)
    });
    assert.strictEqual(importByDepartmentName.res.status, 201, JSON.stringify(importByDepartmentName.body));
    assert.strictEqual(importByDepartmentName.body.draft.department_id, 1, 'department_name from structured output should resolve to the owning department');
    assert.strictEqual(importByDepartmentName.body.imported.processes, 1);
    const deleteDepartmentNameDraft = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', { method: 'DELETE' });
    assert.strictEqual(deleteDepartmentNameDraft.res.status, 200, JSON.stringify(deleteDepartmentNameDraft.body));

    const lookupBeforeCreate = await request(baseUrl, 'submitter', '/api/process-design/documents/lookup?document_no=CX-ZD-001');
    assert.strictEqual(lookupBeforeCreate.res.status, 200, JSON.stringify(lookupBeforeCreate.body));
    assert.strictEqual(lookupBeforeCreate.body.exists, false);
    assert.strictEqual(lookupBeforeCreate.body.next_edition, 'A');
    assert.ok(lookupBeforeCreate.body.can_create, 'new document number should allow A edition draft creation');

    const invalidDraft = await request(baseUrl, 'submitter', '/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        reason: '业务需要形成统一入口',
        basis_type: '会议 / 访谈',
        basis_description: '项目例会提出',
        involves_other_departments: false
      })
    });
    assert.strictEqual(invalidDraft.res.status, 422);
    assert.ok(
      invalidDraft.body.details.some(detail => detail.field === 'process_name' && detail.message === '制度名称不能为空'),
      'draft title validation should use制度名称 copy'
    );
    assert.ok(
      invalidDraft.body.details.some(detail => detail.field === 'document_no' && detail.message === '制度编号不能为空'),
      'draft creation should require制度编号 from the draft stage'
    );

    const draftWithoutReasonAndBasisDescription = await request(baseUrl, 'submitter', '/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        document_no: 'CX-ZD-TDD',
        document_title: '制度说明精简字段验证',
        process_name: '制度说明精简字段验证',
        basis_type: '会议 / 访谈',
        involves_other_departments: false
      })
    });
    assert.strictEqual(
      draftWithoutReasonAndBasisDescription.res.status,
      201,
      '制度说明 should save without 为什么新增 or 依据说明'
    );
    const deleteDraft = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', { method: 'DELETE' });
    assert.strictEqual(deleteDraft.res.status, 200, JSON.stringify(deleteDraft.body));
    assert.deepStrictEqual(deleteDraft.body, { deleted: true, id: 101 });
    const summaryAfterDraftDelete = await request(baseUrl, 'submitter', '/api/process-design/summary');
    assert.strictEqual(summaryAfterDraftDelete.body.summary.totalDrafts, 0, 'deleted process design draft should leave the draft list');

    const draft = await request(baseUrl, 'submitter', '/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        document_no: 'CX-ZD-001',
        document_title: '客户需求变更管理制度',
        process_name: '客户需求变更管理制度',
        reason: '业务需要形成统一入口',
        basis_type: '会议 / 访谈',
        basis_description: '项目例会提出',
        involves_other_departments: true,
        related_departments: ['工程技术部']
      })
    });
    assert.strictEqual(draft.res.status, 201, JSON.stringify(draft.body));
    assert.strictEqual(draft.body.id, 101);
    assert.strictEqual(draft.body.document_no, 'CX-ZD-001');
    assert.strictEqual(draft.body.planned_edition, 'A');

    const lookupWithActiveDraft = await request(baseUrl, 'submitter', '/api/process-design/documents/lookup?document_no=CX-ZD-001');
    assert.strictEqual(lookupWithActiveDraft.res.status, 200, JSON.stringify(lookupWithActiveDraft.body));
    assert.strictEqual(lookupWithActiveDraft.body.active_draft.id, 101);
    assert.strictEqual(lookupWithActiveDraft.body.can_create, false);

    const detail = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detail.res.status, 200);

    const taxonomy = await request(baseUrl, 'submitter', '/api/process-design/process-taxonomy');
    assert.strictEqual(taxonomy.res.status, 200, JSON.stringify(taxonomy.body));
    assert.deepStrictEqual(
      taxonomy.body.items.map(item => `${item.l1_name}/${item.l2_name}`),
      ['市场开发与客户合同治理/客户合同评审管理', '产品设计全生命周期管理/设计更改管理']
    );

    const classification = await request(baseUrl, 'submitter', '/api/process-design/drafts/101', {
      method: 'PUT',
      body: JSON.stringify({ l1_name: '市场开发与客户合同治理', l1_status: 'confirmed', l2_name: '客户合同评审管理', l2_status: 'confirmed', l3_name: '客户需求变更处理' })
    });
    assert.strictEqual(classification.res.status, 200, JSON.stringify(classification.body));

    const profile = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/document-profile', {
      method: 'PUT',
      body: JSON.stringify({
        document_title: '客户需求变更管理制度',
        document_no: 'CX-ZD-001',
        purpose: '统一客户需求变更入口',
        scope: '适用于经营发展部接收的客户需求变更',
        inheritance_relation: '承接客户资料管理办法'
      })
    });
    assert.strictEqual(profile.res.status, 200, JSON.stringify(profile.body));
    assert.strictEqual(profile.body.purpose, '统一客户需求变更入口');

    const term = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/terms', {
      method: 'POST',
      body: JSON.stringify({ term_name: '需求变更', definition: '客户对已确认需求提出的调整', applies_to: '客户需求变更处理' })
    });
    assert.strictEqual(term.res.status, 201, JSON.stringify(term.body));

    const termUpdate = await request(baseUrl, 'submitter', '/api/process-design/terms/161', {
      method: 'PUT',
      body: JSON.stringify({ term_name: '需求变更申请', definition: '客户对已确认需求提出的调整申请', applies_to: '客户需求变更制度' })
    });
    assert.strictEqual(termUpdate.res.status, 200, JSON.stringify(termUpdate.body));
    assert.strictEqual(termUpdate.body.term_name, '需求变更申请');

    const termToDelete = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/terms', {
      method: 'POST',
      body: JSON.stringify({ term_name: '临时术语', definition: '录错的术语', applies_to: '临时' })
    });
    assert.strictEqual(termToDelete.res.status, 201, JSON.stringify(termToDelete.body));
    const termDelete = await request(baseUrl, 'submitter', '/api/process-design/terms/162', { method: 'DELETE' });
    assert.strictEqual(termDelete.res.status, 200, JSON.stringify(termDelete.body));
    assert.strictEqual(termDelete.body.deleted, true);

    const invalidProcess = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '自定义能力域', l2_name: '自定义业务能力', l3_name: '不应保存的流程', process_type: 'new' })
    });
    assert.strictEqual(invalidProcess.res.status, 422, JSON.stringify(invalidProcess.body));
    assert.ok(JSON.stringify(invalidProcess.body).includes('已有映射关系'), 'process L1/L2 must come from existing mapping relationships');

    const manualProcessCode = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({
        l1_name: '市场开发与客户合同治理',
        l2_name: '客户合同评审管理',
        l3_name: '客户需求变更处理',
        process_code: 'L3-SAL-001',
        process_type: 'new'
      })
    });
    assert.strictEqual(manualProcessCode.res.status, 422, JSON.stringify(manualProcessCode.body));
    assert.ok(JSON.stringify(manualProcessCode.body).includes('自动生成'), 'manual process code should be rejected');

    const processA = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '市场开发与客户合同治理', l2_name: '客户合同评审管理', l3_name: '客户需求变更处理', process_type: 'new' })
    });
    assert.strictEqual(processA.res.status, 201, JSON.stringify(processA.body));
    assert.strictEqual(processA.body.id, 181);
    assert.strictEqual(processA.body.process_code, 'PROCEDURE-101-001');
    assert.ok(!String(processA.body.process_code).startsWith('L3'), 'procedure code should not use the frontend L3 label');

    const manualProcessCodeUpdate = await request(baseUrl, 'submitter', '/api/process-design/processes/181', {
      method: 'PUT',
      body: JSON.stringify({
        l1_name: '市场开发与客户合同治理',
        l2_name: '客户合同评审管理',
        l3_name: '客户需求变更受理',
        process_code: 'L3-SAL-009',
        process_type: 'adjustment'
      })
    });
    assert.strictEqual(manualProcessCodeUpdate.res.status, 422, JSON.stringify(manualProcessCodeUpdate.body));
    assert.ok(JSON.stringify(manualProcessCodeUpdate.body).includes('自动生成'), 'manual process code update should be rejected');

    const invalidProcessUpdate = await request(baseUrl, 'submitter', '/api/process-design/processes/181', {
      method: 'PUT',
      body: JSON.stringify({
        l1_name: '市场开发与客户合同治理',
        l2_name: '新增业务能力',
        l3_name: '客户需求变更受理',
        process_type: 'adjustment'
      })
    });
    assert.strictEqual(invalidProcessUpdate.res.status, 422, JSON.stringify(invalidProcessUpdate.body));
    assert.ok(JSON.stringify(invalidProcessUpdate.body).includes('已有映射关系'), 'process update should reject new L1/L2 pairs');

    const processUpdate = await request(baseUrl, 'submitter', '/api/process-design/processes/181', {
      method: 'PUT',
      body: JSON.stringify({
        l1_name: '市场开发与客户合同治理',
        l2_name: '客户合同评审管理',
        l3_name: '客户需求变更受理',
        process_type: 'adjustment',
        description: '受理并登记客户需求变更'
      })
    });
    assert.strictEqual(processUpdate.res.status, 200, JSON.stringify(processUpdate.body));
    assert.strictEqual(processUpdate.body.l3_name, '客户需求变更受理');
    assert.strictEqual(processUpdate.body.process_code, 'PROCEDURE-101-001');

    const processB = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '产品设计全生命周期管理', l2_name: '设计更改管理', l3_name: '技术影响评估', process_type: 'handoff' })
    });
    assert.strictEqual(processB.res.status, 201, JSON.stringify(processB.body));
    assert.strictEqual(processB.body.process_code, 'PROCEDURE-101-002');

    const processC = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/processes', {
      method: 'POST',
      body: JSON.stringify({ l1_name: '市场开发与客户合同治理', l2_name: '客户合同评审管理', l3_name: '录错流程', process_type: 'new' })
    });
    assert.strictEqual(processC.res.status, 201, JSON.stringify(processC.body));
    const emptyProcessDelete = await request(baseUrl, 'submitter', '/api/process-design/processes/183', { method: 'DELETE' });
    assert.strictEqual(emptyProcessDelete.res.status, 200, JSON.stringify(emptyProcessDelete.body));
    assert.strictEqual(emptyProcessDelete.body.deleted, true);

    const stepWithoutProcess = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ step_name: '未归属流程的行为', output_result: '不应保存' })
    });
    assert.strictEqual(stepWithoutProcess.res.status, 422);
    assert.ok(JSON.stringify(stepWithoutProcess.body).includes('process_id'), 'behavior must belong to one process');

    const step = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ process_id: 181, step_name: '登记变更需求', output_result: '形成需求变更记录' })
    });
    assert.strictEqual(step.res.status, 201);
    assert.strictEqual(step.body.process_id, 181);

    const blockedProcessDelete = await request(baseUrl, 'submitter', '/api/process-design/processes/181', { method: 'DELETE' });
    assert.strictEqual(blockedProcessDelete.res.status, 409, JSON.stringify(blockedProcessDelete.body));
    assert.ok(JSON.stringify(blockedProcessDelete.body).includes('业务行为'), 'process with behavior must not be deleted');

    const stepUpdate = await request(baseUrl, 'submitter', '/api/process-design/steps/201', {
      method: 'PUT',
      body: JSON.stringify({ process_id: 182, actor_role: '业务联系人' })
    });
    assert.strictEqual(stepUpdate.res.status, 200);
    assert.strictEqual(Number(stepUpdate.body.process_id), 182);

    const behaviorDetail = await request(baseUrl, 'submitter', '/api/process-design/steps/201/behavior-detail', {
      method: 'PUT',
      body: JSON.stringify({
        precondition: '客户已提出变更诉求',
        trigger_scene: '客户电话、邮件或会议提出变更',
        execution_standard: '2 个工作日内登记并确认影响范围',
        delivery_object: '需求变更记录',
        requires_approval: true,
        approval_note: '部门负责人确认后流转',
        is_cross_department: true
      })
    });
    assert.strictEqual(behaviorDetail.res.status, 200, JSON.stringify(behaviorDetail.body));
    assert.strictEqual(behaviorDetail.body.delivery_object, '需求变更记录');

    const forbiddenHandoffManualResult = await request(baseUrl, 'submitter', '/api/process-design/steps/201/cross-dept-handoffs', {
      method: 'POST',
      body: JSON.stringify({
        target_department: '工程技术部',
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(forbiddenHandoffManualResult.res.status, 422, JSON.stringify(forbiddenHandoffManualResult.body));
    assert.ok(JSON.stringify(forbiddenHandoffManualResult.body).includes('回写'), 'source department must not edit returned handoff result');

    const handoff = await request(baseUrl, 'submitter', '/api/process-design/steps/201/cross-dept-handoffs', {
      method: 'POST',
      body: JSON.stringify({
        target_department: '工程技术部',
        handoff_standard: '提供需求变更记录和影响范围说明'
      })
    });
    assert.strictEqual(handoff.res.status, 201, JSON.stringify(handoff.body));
    assert.strictEqual(handoff.body.target_process_code, null);
    assert.strictEqual(handoff.body.status, 'pending_return');

    const sourceCannotReturn = await request(baseUrl, 'submitter', '/api/process-design/cross-dept-handoffs/261/returned-result', {
      method: 'PUT',
      body: JSON.stringify({
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(sourceCannotReturn.res.status, 403, JSON.stringify(sourceCannotReturn.body));

    const returnedHandoff = await request(baseUrl, 'targetDept', '/api/process-design/cross-dept-handoffs/261/returned-result', {
      method: 'PUT',
      body: JSON.stringify({
        target_process_code: 'L3-ENG-001',
        target_process_name: '技术方案评审',
        target_behavior_code: 'A1-ENG-001',
        target_behavior_name: '评估技术影响'
      })
    });
    assert.strictEqual(returnedHandoff.res.status, 200, JSON.stringify(returnedHandoff.body));
    assert.strictEqual(returnedHandoff.body.target_process_name, '技术方案评审');

    const forbiddenCrossDeptDowngrade = await request(baseUrl, 'submitter', '/api/process-design/steps/201/behavior-detail', {
      method: 'PUT',
      body: JSON.stringify({
        precondition: '客户已提出变更诉求',
        trigger_scene: '客户电话、邮件或会议提出变更',
        execution_standard: '2 个工作日内登记并确认影响范围',
        delivery_object: '需求变更记录',
        requires_approval: true,
        approval_note: '部门负责人确认后流转',
        is_cross_department: false
      })
    });
    assert.strictEqual(forbiddenCrossDeptDowngrade.res.status, 409, JSON.stringify(forbiddenCrossDeptDowngrade.body));

    const physicalDeleteLinkedStep = await request(baseUrl, 'submitter', '/api/process-design/steps/201?mode=delete', { method: 'DELETE' });
    assert.strictEqual(physicalDeleteLinkedStep.res.status, 409, JSON.stringify(physicalDeleteLinkedStep.body));

    const voidedStep = await request(baseUrl, 'submitter', '/api/process-design/steps/201', {
      method: 'DELETE',
      body: JSON.stringify({ reason: '跨部门承接后发现本部门记录需作废' })
    });
    assert.strictEqual(voidedStep.res.status, 200, JSON.stringify(voidedStep.body));
    assert.strictEqual(voidedStep.body.status, 'voided');

    const typoStep = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ process_id: 182, step_name: '录错的业务行为', output_result: '录错' })
    });
    assert.strictEqual(typoStep.res.status, 201, JSON.stringify(typoStep.body));
    const physicalDeleteTypoStep = await request(baseUrl, 'submitter', '/api/process-design/steps/202?mode=delete', { method: 'DELETE' });
    assert.strictEqual(physicalDeleteTypoStep.res.status, 200, JSON.stringify(physicalDeleteTypoStep.body));
    assert.strictEqual(physicalDeleteTypoStep.body.deleted, true);

    const activeStep = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/steps', {
      method: 'POST',
      body: JSON.stringify({ process_id: 182, step_name: '确认技术影响', actor_role: '工程接口人', output_result: '形成技术影响确认记录' })
    });
    assert.strictEqual(activeStep.res.status, 201, JSON.stringify(activeStep.body));
    const activeBehaviorDetail = await request(baseUrl, 'submitter', '/api/process-design/steps/202/behavior-detail', {
      method: 'PUT',
      body: JSON.stringify({
        precondition: '需求变更已登记',
        trigger_scene: '经营发展部提交技术评估请求',
        execution_standard: '3 个工作日内确认影响范围',
        delivery_object: '技术影响确认记录',
        requires_approval: false,
        is_cross_department: false
      })
    });
    assert.strictEqual(activeBehaviorDetail.res.status, 200, JSON.stringify(activeBehaviorDetail.body));

    const fieldTypes = await request(baseUrl, 'submitter', '/api/process-design/field-types');
    assert.strictEqual(fieldTypes.res.status, 200, JSON.stringify(fieldTypes.body));
    assert.ok(fieldTypes.body.items.some(item => item.name === '二维码'), 'field type dictionary should include QR code');

    const rosterRoles = await request(baseUrl, 'submitter', '/api/process-design/departments/2/roster-roles');
    assert.strictEqual(rosterRoles.res.status, 200, JSON.stringify(rosterRoles.body));
    assert.ok(rosterRoles.body.roles.includes('资料管理员'), 'roster roles should come from department roster positions');

    const formWithoutStep = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/forms', {
      method: 'POST',
      body: JSON.stringify({ form_name: '无业务行为表单', main_table_name: '主表' })
    });
    assert.strictEqual(formWithoutStep.res.status, 422, JSON.stringify(formWithoutStep.body));

    const form = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/forms', {
      method: 'POST',
      body: JSON.stringify({
        step_id: 202,
        form_name: '需求变更单',
        main_table_name: '需求变更主表',
        archive_location: '资料室',
        retention_period: '10年',
        responsible_department_id: 2,
        responsible_role: '资料管理员'
      })
    });
    assert.strictEqual(form.res.status, 201);
    assert.strictEqual(form.body.form_code, 'FM-CX-ZD-001-A-001');
    assert.strictEqual(form.body.main_table_code, 'FM-CX-ZD-001-A-001-M');
    assert.strictEqual(form.body.main_table_name, '需求变更主表');
    assert.strictEqual(form.body.archive_location, '资料室');

    const formUpdate = await request(baseUrl, 'submitter', '/api/process-design/forms/301', {
      method: 'PUT',
      body: JSON.stringify({ retention_period: '永久', responsible_role: '资料管理员' })
    });
    assert.strictEqual(formUpdate.res.status, 200);

    const mainField = await request(baseUrl, 'submitter', '/api/process-design/forms/301/fields', {
      method: 'POST',
      body: JSON.stringify({ structure_kind: 'main', field_name: '客户名称', field_type: '文本', required: true, description: '填写客户名称' })
    });
    assert.strictEqual(mainField.res.status, 201, JSON.stringify(mainField.body));
    assert.strictEqual(mainField.body.field_code, 'FM-CX-ZD-001-A-001-M-001');

    const manualTableNo = await request(baseUrl, 'submitter', '/api/process-design/forms/301/tables', {
      method: 'POST',
      body: JSON.stringify({ table_no: 'FM-CX-ZD-001-A-001-D', table_name: '需求变更明细表' })
    });
    assert.strictEqual(manualTableNo.res.status, 422, JSON.stringify(manualTableNo.body));

    const table = await request(baseUrl, 'submitter', '/api/process-design/forms/301/tables', {
      method: 'POST',
      body: JSON.stringify({ table_name: '变更字段明细' })
    });
    assert.strictEqual(table.res.status, 201, JSON.stringify(table.body));
    assert.strictEqual(table.body.table_name, '变更字段明细');
    assert.strictEqual(table.body.table_code, 'FM-CX-ZD-001-A-001-D');

    const manualFieldNo = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_no: 'FM-CX-ZD-001-A-001-D-001', field_name: '变更字段', field_type: '文本', required: true, description: '填写变更字段' })
    });
    assert.strictEqual(manualFieldNo.res.status, 422, JSON.stringify(manualFieldNo.body));

    const invalidFieldType = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name: '变更字段', field_type: '随便写', required: true, description: '填写变更字段' })
    });
    assert.strictEqual(invalidFieldType.res.status, 422, JSON.stringify(invalidFieldType.body));

    const whitespaceField = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ field_name: '变更 字段', field_type: '文本', required: true, description: '填写变更字段' })
    });
    assert.strictEqual(whitespaceField.res.status, 422, JSON.stringify(whitespaceField.body));

    const tableField = await request(baseUrl, 'submitter', '/api/process-design/form-tables/351/fields', {
      method: 'POST',
      body: JSON.stringify({ structure_kind: 'detail', field_name: '变更字段', field_type: '枚举', enum_options: '名称,地址', required: true, description: '填写变更字段' })
    });
    assert.strictEqual(tableField.res.status, 201, JSON.stringify(tableField.body));
    assert.strictEqual(tableField.body.field_code, 'FM-CX-ZD-001-A-001-D-001');

    const invalidEvidenceType = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/evidence', {
      method: 'POST',
      body: JSON.stringify({ evidence_type: '自由输入类型', description: '首次周例会确认' })
    });
    assert.strictEqual(invalidEvidenceType.res.status, 422, JSON.stringify(invalidEvidenceType.body));

    const fieldUpdate = await request(baseUrl, 'submitter', '/api/process-design/form-table-fields/362', {
      method: 'PUT',
      body: JSON.stringify({ description: '字段口径已确认' })
    });
    assert.strictEqual(fieldUpdate.res.status, 200, JSON.stringify(fieldUpdate.body));
    assert.strictEqual(fieldUpdate.body.description, '字段口径已确认');

    const evidence = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/evidence', {
      method: 'POST',
      body: JSON.stringify({ evidence_type: '会议纪要', description: '首次周例会确认', source_name: '周例会纪要', source_anchor: '第3项', confirmer: '业务联系人' })
    });
    assert.strictEqual(evidence.res.status, 201);

    const evidenceUpdate = await request(baseUrl, 'submitter', '/api/process-design/evidence/501', {
      method: 'PUT',
      body: JSON.stringify({ record_time: '2026-06-30' })
    });
    assert.strictEqual(evidenceUpdate.res.status, 200);

    const risks = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/risks');
    assert.strictEqual(risks.res.status, 200);

    const detailAfterStructure = await request(baseUrl, 'submitter', '/api/process-design/drafts/101');
    assert.strictEqual(detailAfterStructure.res.status, 200);
    assert.strictEqual(detailAfterStructure.body.documentProfile.document_title, '客户需求变更管理制度');
    assert.strictEqual(detailAfterStructure.body.terms[0].term_name, '需求变更申请');
    assert.strictEqual(detailAfterStructure.body.processes.length, 2);
    assert.ok(detailAfterStructure.body.steps.some(row => row.status === 'voided'), 'voided behavior should remain visible in draft detail');
    const activeStepDetail = detailAfterStructure.body.steps.find(row => row.status !== 'voided');
    assert.strictEqual(activeStepDetail.process_id, 182);
    assert.strictEqual(activeStepDetail.behaviorDetail.execution_standard, '3 个工作日内确认影响范围');
    assert.strictEqual(detailAfterStructure.body.forms[0].main_fields[0].field_name, '客户名称');
    assert.strictEqual(detailAfterStructure.body.forms[0].tables[0].fields[0].field_name, '变更字段');

    const fieldDelete = await request(baseUrl, 'submitter', '/api/process-design/form-table-fields/362', {
      method: 'DELETE'
    });
    assert.strictEqual(fieldDelete.res.status, 200, JSON.stringify(fieldDelete.body));

    fakeRepo.setDraftStatus('submitted');
    const readonlyTermUpdate = await request(baseUrl, 'submitter', '/api/process-design/terms/161', {
      method: 'PUT',
      body: JSON.stringify({ term_name: '已提交后不应修改', definition: '只读', applies_to: '只读' })
    });
    assert.strictEqual(readonlyTermUpdate.res.status, 409, JSON.stringify(readonlyTermUpdate.body));
    fakeRepo.setDraftStatus('draft');

    const markdown = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/markdown');
    assert.strictEqual(markdown.res.status, 200);
    assert.ok(String(markdown.body.markdown || '').includes('## 目的'), 'markdown export should include purpose section');
    assert.ok(String(markdown.body.markdown || '').includes('CX-ZD-001 客户需求变更管理制度 A版'), 'markdown title should include document number, title and edition');
    assert.strictEqual(markdown.body.filename, 'CX-ZD-001-客户需求变更管理制度-A版.md');

    const preview = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/outcome-preview');
    assert.strictEqual(preview.res.status, 200);

    const submit = await request(baseUrl, 'submitter', '/api/process-design/drafts/101/submit', {
      method: 'POST',
      body: JSON.stringify({ note: '请审核' })
    });
    assert.strictEqual(submit.res.status, 200);
    assert.strictEqual(submit.body.reviewTask.id, 601);

    const decision = await request(baseUrl, 'reviewer', '/api/process-design/review-tasks/601/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', note: '同意' })
    });
    assert.strictEqual(decision.res.status, 200);

    const publish = await request(baseUrl, 'mdmLead', '/api/process-design/drafts/101/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布' })
    });
    assert.strictEqual(publish.res.status, 200);
    assert.strictEqual(publish.body.version.version_no, 'CX-ZD-001-A');
    assert.strictEqual(publish.body.version.document_no, 'CX-ZD-001');
    assert.strictEqual(publish.body.version.document_title, '客户需求变更管理制度');
    assert.strictEqual(publish.body.version.edition, 'A');
    assert.strictEqual(publish.body.version.status, 'published');

    const lookupAfterPublish = await request(baseUrl, 'submitter', '/api/process-design/documents/lookup?document_no=CX-ZD-001');
    assert.strictEqual(lookupAfterPublish.res.status, 200, JSON.stringify(lookupAfterPublish.body));
    assert.strictEqual(lookupAfterPublish.body.current_version.edition, 'A');
    assert.strictEqual(lookupAfterPublish.body.next_edition, 'B');
    assert.ok(lookupAfterPublish.body.can_create_next, 'published A edition should allow B edition creation when no active draft exists');

    const nextDraft = await request(baseUrl, 'submitter', '/api/process-design/documents/801/drafts', {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.strictEqual(nextDraft.res.status, 201, JSON.stringify(nextDraft.body));
    assert.strictEqual(nextDraft.body.id, 102);
    assert.strictEqual(nextDraft.body.document_no, 'CX-ZD-001');
    assert.strictEqual(nextDraft.body.document_title, '客户需求变更管理制度');
    assert.strictEqual(nextDraft.body.planned_edition, 'B');
    assert.strictEqual(nextDraft.body.base_version_id, 701);

    const nextDetail = await request(baseUrl, 'submitter', '/api/process-design/drafts/102');
    assert.strictEqual(nextDetail.res.status, 200, JSON.stringify(nextDetail.body));
    assert.strictEqual(nextDetail.body.processes.length, 0, 'B edition draft should not copy A edition processes');
    assert.strictEqual(nextDetail.body.steps.length, 0, 'B edition draft should not copy A edition behaviors');
    assert.strictEqual(nextDetail.body.forms.length, 0, 'B edition draft should not copy A edition forms');

    const editionDiff = await request(baseUrl, 'submitter', '/api/process-design/drafts/102/edition-diff');
    assert.strictEqual(editionDiff.res.status, 200, JSON.stringify(editionDiff.body));
    assert.deepStrictEqual(editionDiff.body.missing.processes, ['客户需求变更受理']);

    const publishNextWithoutConfirm = await request(baseUrl, 'mdmLead', '/api/process-design/drafts/102/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布B版' })
    });
    assert.strictEqual(publishNextWithoutConfirm.res.status, 409, JSON.stringify(publishNextWithoutConfirm.body));
    assert.ok(JSON.stringify(publishNextWithoutConfirm.body).includes('完整重写'), 'B/C edition publish must ask the publisher to confirm complete rewrite');

    const publishNext = await request(baseUrl, 'mdmLead', '/api/process-design/drafts/102/publish', {
      method: 'POST',
      body: JSON.stringify({ note: '发布B版', confirm_complete_rewrite: true })
    });
    assert.strictEqual(publishNext.res.status, 200, JSON.stringify(publishNext.body));
    assert.strictEqual(publishNext.body.version.version_no, 'CX-ZD-001-B');
    assert.strictEqual(publishNext.body.version.edition, 'B');
    assert.strictEqual(publishNext.body.version.supersedes_version_id, 701);
    assert.strictEqual(fakeRepo.state.versions.find(version => version.edition === 'A').status, 'superseded');

    fakeRepo.state.versions.push({
      id: 999,
      draft_id: 199,
      document_id: 899,
      document_no: 'CX-ZD-OTHER',
      document_title: '其他制度',
      edition: 'A',
      version_no: 'CX-ZD-OTHER-A',
      status: 'published'
    });
    const filteredSummary = await request(baseUrl, 'submitter', '/api/process-design/summary?document_no=CX-ZD-001');
    assert.strictEqual(filteredSummary.res.status, 200, JSON.stringify(filteredSummary.body));
    assert.strictEqual(filteredSummary.body.summary.publishedVersions, 2, 'document summary should count only matching document versions');
    assert.ok(filteredSummary.body.versions.length >= 2, 'document summary should include matching history versions');
    assert.ok(filteredSummary.body.versions.every(version => version.document_no === 'CX-ZD-001'), 'document history should be filtered by document_no');

    [
      'createDraft',
      'deleteDraft',
      'lookupDocument',
      'createNextEditionDraft',
      'editionDiff',
      'saveDocumentProfile',
      'createTerm',
      'updateTerm',
      'deleteTerm',
      'createProcess',
      'updateProcess',
      'deleteProcess',
      'createStep',
      'updateStep',
      'saveBehaviorDetail',
      'deleteStep',
      'createHandoff',
      'acceptHandoffReturn',
      'createForm',
      'createFormTable',
      'createFormTableField',
      'updateFormTableField',
      'deleteFormTableField',
      'createEvidence',
      'markdownForDraft',
      'submitDraft',
      'decideReviewTask',
      'publishDraft'
    ].forEach(callName => {
      assert.ok(fakeRepo.calls.includes(callName), `expected ${callName} to be called`);
    });

    console.log('Process design MySQL API test passed');
  } finally {
    await closeServer(server);
    processDesignRouter.resetProcessDesignRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
