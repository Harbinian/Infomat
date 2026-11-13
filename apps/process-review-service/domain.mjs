import { createHash, randomUUID } from 'node:crypto';
import { themes, departments, suggestTheme } from './topics.mjs';
import { materialWalkEdits, nextWalkIndex, projectWalkDocument, walkEditFields, walkEditText, walkElement, walkRemovalBlockers } from './public/walk-edits.js';
import { actorSelectionError } from './public/actor-selection.js';
import organizationCatalog from './config/organization-catalog.json' with { type: 'json' };

export class ReviewError extends Error {
  constructor(message, code = 'VALIDATION', status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (message, code, status) => { throw new ReviewError(message, code, status); };
const assert = (condition, message, code, status) => { if (!condition) fail(message, code, status); };
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID()}`;
const clone = value => structuredClone(value);
const text = (value, label, required = false, max = 100000) => {
  assert(value === undefined || value === null || typeof value === 'string', `${label}必须为文本`);
  const result = value ?? '';
  assert(result.length <= max, `${label}过长`);
  assert(!required || result.trim().length > 0, `请填写${label}`);
  return result;
};
const list = (value, label, minimum = 0) => {
  assert(Array.isArray(value) && value.length >= minimum && value.length <= 1000, `${label}必须为有效列表`);
  assert(value.every(item => typeof item === 'string' && item.length > 0 && item.length < 1000), `${label}包含无效标识`);
  assert(new Set(value).size === value.length, `${label}不可重复`);
  return [...value];
};
const record = (state, key, value) => {
  assert(typeof value === 'string' && value, '缺少有效记录标识');
  const item = state[key].find(item => item.id === value);
  assert(item, '引用的记录不存在', 'NOT_FOUND', 404);
  return item;
};
const role = (actor, capability) => assert(actor.roles.includes(capability), '当前演练身份无权执行此操作', 'FORBIDDEN', 403);
const oneOf = (value, values, label) => { assert(values.includes(value), `${label}无效`); return value; };
const optionalUser = (state, value) => {
  const userId = text(value, '人员标识', false, 1000);
  return userId ? record(state, 'users', userId).id : '';
};
const checkDate = value => {
  if (value === undefined || value === null || value === '') return '';
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '期限应为 YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  assert(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value, '期限不是有效日期');
  return value;
};
const history = (item, actor, operation, before, detail = {}) => {
  item.history ??= [];
  item.history.push({ id: id('history'), at: now(), actorId: actor.id, operation, before, ...detail });
};
const snapshot = item => { const { history: ignored, ...value } = item; return clone(value); };

export function createInitialState() {
  return {
    storageVersion: 1, revision: 0, mode: 'local-isolated', themes: clone(themes), departments: [...departments],
    users: [
      { id: 'local-pmo', name: 'PMO协调员（演练）', department: 'PMO', roles: ['participant', 'pmo'] },
      { id: 'local-recorder', name: '会议记录员（演练）', department: 'PMO', roles: ['participant', 'recorder'] },
      ...departments.map((department, index) => ({ id: `local-dept-${String(index + 1).padStart(2, '0')}`, name: `${department}代表（演练）`, department, roles: ['participant', 'representative'] })),
      { id: 'local-authority', name: '制度决定人（演练）', department: '制度决定', roles: ['participant', 'authority'] }
    ], materials: [], batches: themes.map(theme => ({ id: `batch-${theme.id}`, title: theme.name, themeId: theme.id, materialIds: [], memberIds: [], leadId: '', recorderId: '', requiredDepartments: [], status: 'planned', coverage: {}, presenter: { materialId: '', nodeRef: '' }, createdBy: 'system', createdAt: now(), history: [], initialization: true })), opinions: [], issues: [], observations: [], audit: []
  };
}
export const initialState = createInitialState();

export function getPublicState(state, actorId) {
  const actor = record(state, 'users', actorId);
  const result = clone(state);
  result.currentUser = clone(actor);
  result.organizationCatalog = clone(organizationCatalog);
  result.opinions = result.opinions.filter(opinion => opinion.status === 'submitted' || opinion.authorId === actorId);
  return result;
}

function readMaterialFile(file) {
  assert(file && typeof file === 'object' && !Array.isArray(file), '材料格式无效');
  const sourcePath = text(file.sourcePath, '材料来源路径', true, 4096);
  const rawText = text(file.content, '材料内容', true, 8 * 1024 * 1024);
  assert(rawText.isWellFormed(), '材料内容包含无法无损保存的 Unicode 字符');
  let document;
  try { document = JSON.parse(rawText.replace(/^\uFEFF/, '')); } catch { fail('材料不是有效 JSON'); }
  assert(document && typeof document === 'object' && !Array.isArray(document), '材料根对象无效');
  assert(document.schema_version === 'process-governance-v8', '仅支持 process-governance-v8；原文件未被修改', 'UNSUPPORTED_SCHEMA');
  assert(document.process && typeof document.process === 'object' && !Array.isArray(document.process), '材料缺少 process 对象');
  for (const key of ['behaviors', 'flow_relations', 'data_objects', 'forms', 'terms']) {
    assert(document[key] === undefined || Array.isArray(document[key]), `${key}应为数组`);
  }
  const parts = sourcePath.split(/[\\/]/);
  const sourceDepartment = [...parts.slice(0, -1)].reverse().find(part => departments.includes(part)) || '';
  const declaredDepartment = typeof document.process.owning_department === 'string' ? document.process.owning_department : '';
  const name = typeof document.process.process_name === 'string' && document.process.process_name.trim() ? document.process.process_name : parts.at(-1);
  const warnings = [];
  if (!sourceDepartment) warnings.push('来源目录部门尚未识别，需要部门代表明确确认');
  if (declaredDepartment && declaredDepartment !== sourceDepartment) warnings.push('来源目录与材料内声明部门不一致，尚未确认责任归属');
  if (!document.process.process_name) warnings.push('材料未提供流程名称，当前以文件名展示');
  if (!document.process.process_ref) warnings.push('材料未提供流程标识');
  const nodeRefs = (document.behaviors || []).map(node => node?.behavior_ref).filter(Boolean);
  if (new Set(nodeRefs).size !== nodeRefs.length) warnings.push('材料含重复行为标识，请核对后再定位意见');
  if ((document.flow_relations || []).some(relation => !nodeRefs.includes(relation?.from_behavior_ref) || !nodeRefs.includes(relation?.to_behavior_ref))) warnings.push('材料含无法匹配的流程连线端点，原内容已保留');
  const suggestion = suggestTheme(name, sourcePath) || '';
  return {
    id: id('material'), name, sourcePath, sourceDepartment, declaredDepartment,
    sourceRef: typeof document.process.process_ref === 'string' ? document.process.process_ref : '',
    sha256: createHash('sha256').update(rawText, 'utf8').digest('hex'), schemaVersion: document.schema_version,
    themeId: themes.some(theme => theme.id === suggestion) ? suggestion : '', status: 'pending', confirmedBy: '', confirmationNote: '',
    predecessorId: '', changeNote: '', impactedIssueIds: [], warnings, createdAt: now(), rawText
  };
}

export function importMaterials(store, { files, expectedRevision, actorId = 'local-pmo' }) {
  assert(Array.isArray(files) && files.length > 0 && files.length <= 250, '每次应导入 1 至 250 份材料');
  const prepared = files.map(readMaterialFile);
  return store.transaction(expectedRevision, actorId, 'material.import', (state, transaction) => {
    const actor = record(state, 'users', actorId); role(actor, 'pmo');
    const addedIds = [];
    for (const file of prepared) {
      if (state.materials.some(item => item.sourcePath === file.sourcePath && item.sha256 === file.sha256)) continue;
      const { rawText, ...metadata } = file;
      if (state.materials.some(item => item.sourcePath === metadata.sourcePath)) metadata.warnings.push('同一来源路径已有不同内容快照，需要显式关联版本');
      if (metadata.sourceRef && state.materials.some(item => item.sourceRef === metadata.sourceRef)) metadata.warnings.push('源流程标识与另一材料重复；各文件快照独立保留');
      transaction.putMaterial(file);
      state.materials.push(metadata); addedIds.push(metadata.id);
    }
    return { unchanged: addedIds.length === 0, detail: { materialIds: addedIds, fileCount: files.length } };
  });
}

function materialReferences(state, ids, minimum = 1) { return list(ids, '材料', minimum).map(value => record(state, 'materials', value).id); }
function validateAnchor(store, state, materialId, nodeRef, relationRef, historical = false) {
  const original = store.material(materialId).document;
  const edits = materialWalkEdits(state.audit, materialId);
  const document = projectWalkDocument(original, edits);
  const archived = historical && projectWalkDocument(original, edits.filter(edit => edit.operation !== 'walk.remove'));
  const count = (entries, key, reference) => (entries || []).filter(entry => entry?.[key] === reference).length;
  if (nodeRef) assert(count(document.behaviors, 'behavior_ref', nodeRef) === 1 ||
    (historical && count(archived.behaviors, 'behavior_ref', nodeRef) === 1), '行为定位标识不存在或不唯一');
  if (relationRef) assert(count(document.flow_relations, 'relation_ref', relationRef) === 1 ||
    (historical && count(archived.flow_relations, 'relation_ref', relationRef) === 1), '连线定位标识不存在或不唯一');
}

function walkChanges(kind, element, changes) {
  assert(changes && typeof changes === 'object' && !Array.isArray(changes), '请提供修改字段');
  const before = {}, after = {};
  for (const [key, value] of Object.entries(changes)) {
    const field = walkEditFields[kind].find(item => item.name === key);
    assert(field, '该字段不支持走查修订');
    const previous = element[key];
    assert(previous == null || typeof previous === 'string', `${field.label}在原材料中为非文本值，需另行核对`);
    assert(typeof value === 'string', `${field.label}必须为文本`);
    if (walkEditText(previous) === walkEditText(value)) continue;
    const next = text(value, field.label, field.required, field.max);
    if (field.singleLine) assert(!/[\r\n]/.test(next), `${field.label}必须为单行文本`);
    if (field.choices && next) oneOf(next, field.choices.map(choice => choice.value), field.label);
    before[key] = previous ?? null;
    after[key] = next;
  }
  return { before, after };
}

function validateWalkRelation(document, relation, previous, validateEndpoints=true) {
  for (const key of validateEndpoints?['from_behavior_ref', 'to_behavior_ref']:[]) {
    const reference = relation[key];
    assert(typeof reference === 'string' && reference && (document.behaviors || []).filter(node => node?.behavior_ref === reference).length === 1,
      '连线的起点和终点须分别对应一个可明确定位的步骤');
  }
  const duplicate = (document.flow_relations || []).some(other => other && other !== previous &&
    other.from_behavior_ref === relation.from_behavior_ref && other.to_behavior_ref === relation.to_behavior_ref &&
    other.relation_type === relation.relation_type && (other.condition || '') === (relation.condition || ''));
  assert(!duplicate, '已有相同起点、终点、关系类型和条件的连线');
}

function changeWalk(store, state, payload, actor, operation) {
  role(actor, 'participant');
  const material = record(state, 'materials', payload.materialId);
  const batchId = text(payload.batchId, '批次标识', false, 1000);
  if (batchId) assert(record(state, 'batches', batchId).materialIds.includes(material.id), '修订引用的材料不属于该批次');
  const kind = oneOf(payload.kind, ['step', 'relation'], '元素类型');
  const original = store.material(material.id).document;
  const edits = materialWalkEdits(state.audit, material.id);
  const document = projectWalkDocument(original, edits);
  const reason = text(payload.reason, '修订原因', true, 4000);
  const index = operation === 'walk.create' ? nextWalkIndex(original, edits, kind) : payload.index;
  const detail = { materialId: material.id, batchId, kind, index, reason, rehearsal: true };
  const referenceField = kind === 'step' ? 'behavior_ref' : 'relation_ref';

  if (operation === 'walk.create') {
    const defaults = kind === 'step' ? { node_type: 'action' } : { relation_type: 'sequence', condition: '' };
    const { after } = walkChanges(kind, {}, payload.changes);
    const elementRef = id(`walk-${kind}`);
    const element = { ...defaults, ...after, [referenceField]: elementRef };
    if (kind === 'step') {
      text(element.behavior_name, '步骤名称', true, 300);
      assert(!actorSelectionError({},element,organizationCatalog.roles_by_department), '请先选择执行部门，再选择该部门的执行岗位');
    }
    else validateWalkRelation(document, element);
    return { detail: { ...detail, elementRef, before: null, after: element } };
  }

  assert(Number.isSafeInteger(index) && index >= 0, '元素位置无效');
  const element = walkElement(document, kind, index);
  assert(element && typeof element === 'object' && !Array.isArray(element), '该材料中找不到指定元素');
  const elementRef = typeof element[referenceField] === 'string' ? element[referenceField] : '';
  if (operation === 'walk.remove') {
    const presenters=state.batches.filter(batch=>batch.presenter?.materialId===material.id).map(batch=>batch.presenter);
    const blockers=walkRemovalBlockers(document,kind,index,presenters);
    assert(!blockers.length,blockers.join('\n'));
    return { detail: { ...detail, elementRef, before: element, after: null } };
  }

  const { before, after } = walkChanges(kind, element, payload.changes);
  if (!Object.keys(after).length) return { unchanged: true };
  if (kind === 'step') {
    const error=actorSelectionError(element,{...element,...after},organizationCatalog.roles_by_department);
    assert(!error,error);
  }
  if (kind === 'relation') {
    const endpointsChanged=Object.hasOwn(after,'from_behavior_ref')||Object.hasOwn(after,'to_behavior_ref');
    validateWalkRelation(document, { ...element, ...after }, element, endpointsChanged);
  }
  return { detail: { ...detail, elementRef, before, after } };
}
function batchPayload(state, payload, batchId) {
  const title = text(payload.title, '批次名称', true, 300);
  const materialIds = materialReferences(state, payload.materialIds, 0);
  for (const batch of state.batches) if (batch.id !== batchId) {
    assert(!materialIds.some(value => batch.materialIds.includes(value)), '同一材料快照只能进入一个主评审批次', 'DUPLICATE_BATCH');
  }
  const memberIds = list(payload.memberIds, '参会人员');
  memberIds.forEach(value => role(record(state, 'users', value), 'participant'));
  const leadId = optionalUser(state, payload.leadId);
  const recorderId = optionalUser(state, payload.recorderId);
  if (leadId) assert(memberIds.includes(leadId), '主持人必须在参会名单中');
  if (recorderId) { assert(memberIds.includes(recorderId), '记录员必须在参会名单中'); role(record(state, 'users', recorderId), 'recorder'); }
  const requiredDepartments = list(payload.requiredDepartments, '必需反馈部门');
  requiredDepartments.forEach(department => assert(departments.includes(department), '必需反馈部门不存在'));
  return { title, materialIds, memberIds, leadId, recorderId, requiredDepartments };
}
function validIssuePeople(state, issue, payload) {
  const assigneeId = optionalUser(state, payload.assigneeId);
  if (assigneeId) role(record(state, 'users', assigneeId), 'participant');
  const dueDate = checkDate(payload.dueDate);
  const reviewerIds = list(payload.reviewerIds, '指定复核人员', 1);
  reviewerIds.forEach(value => role(record(state, 'users', value), 'participant'));
  issue.affectedDepartments.forEach(department => assert(reviewerIds.some(value => {
    const reviewer = record(state, 'users', value);
    return reviewer.department === department && reviewer.roles.includes('representative');
  }), `缺少${department}的指定复核代表`));
  const authorityId = optionalUser(state, payload.authorityId);
  if (authorityId) role(record(state, 'users', authorityId), 'authority');
  if (issue.scope === 'policy') assert(authorityId, '制度问题必须指定有权决定身份');
  return { assigneeId, dueDate, reviewerIds, authorityId };
}
function tryClose(issue) {
  if (issue.status === 'awaiting_review' && issue.reviewerIds.every(value => issue.reviews.some(review => review.reviewerId === value && review.decision === 'approve')) && (issue.scope !== 'policy' || issue.authorityEvidence?.evidence?.trim())) {
    issue.status = 'closed'; issue.closedAt = now();
  }
}

export function executeCommand(store, { type, payload, expectedRevision, actorId }) {
  assert(typeof type === 'string', '缺少操作类型');
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), '操作内容必须为对象');
  return store.transaction(expectedRevision, actorId, type, state => {
    const actor = record(state, 'users', actorId);
    const p = payload;
    let targetId = '';
    switch (type) {
      case 'material.confirm': {
        role(actor, 'representative');
        const material = record(state, 'materials', p.materialId);
        const department = material.sourceDepartment || text(p.sourceDepartment, '来源部门', true, 100);
        assert(department === actor.department, '只能由该来源部门的代表确认', 'FORBIDDEN', 403);
        const themeId = record(state, 'themes', p.themeId).id;
        const note = text(p.note, '材料确认说明', true);
        assert(!state.batches.some(batch => batch.status === 'frozen' && batch.materialIds.includes(material.id)), '已冻结批次材料不能更改确认信息');
        const before = snapshot(material);
        Object.assign(material, { sourceDepartment: department, themeId, status: 'confirmed', confirmedBy: actor.id, confirmationNote: note, confirmedAt: now() });
        history(material, actor, type, before, { after: snapshot(material), rehearsal: true }); targetId = material.id;
        break;
      }
      case 'material.link_version': {
        role(actor, 'pmo');
        const material = record(state, 'materials', p.materialId);
        const predecessor = record(state, 'materials', p.predecessorId);
        const changeNote = text(p.changeNote, '版本变更说明', true);
        assert(material.id !== predecessor.id, '材料不能关联自身为前版');
        let cursor = predecessor; const seen = new Set([material.id]);
        while (cursor) {
          assert(!seen.has(cursor.id), '版本关系不能形成循环'); seen.add(cursor.id);
          cursor = cursor.predecessorId ? record(state, 'materials', cursor.predecessorId) : null;
        }
        const before = snapshot(material);
        Object.assign(material, { predecessorId: predecessor.id, changeNote, impactedIssueIds: state.issues.filter(issue => issue.materialIds.some(value => value === material.id || value === predecessor.id)).map(issue => issue.id) });
        history(material, actor, type, before, { after: snapshot(material) }); targetId = material.id;
        break;
      }
      case 'batch.create': {
        role(actor, 'pmo');
        const value = batchPayload(state, p);
        const themeId = record(state, 'themes', p.themeId).id;
        const batch = { id: id('batch'), ...value, themeId, status: 'planned', coverage: {}, presenter: { materialId: '', nodeRef: '' }, createdBy: actor.id, createdAt: now(), history: [] };
        value.materialIds.forEach(materialId => batch.coverage[materialId] = { status: 'pending', note: '', feedbackByDepartment: {} });
        state.batches.push(batch); targetId = batch.id; break;
      }
      case 'batch.update': {
        role(actor, 'pmo'); const batch = record(state, 'batches', p.batchId);
        assert(batch.status === 'planned', '冻结后不能调整批次材料或参会名单');
        const before = snapshot(batch); const value = batchPayload(state, { ...batch, ...p }, batch.id);
        Object.assign(batch, value);
        batch.coverage = Object.fromEntries(value.materialIds.map(materialId => [materialId, batch.coverage[materialId] || { status: 'pending', note: '', feedbackByDepartment: {} }]));
        history(batch, actor, type, before, { after: snapshot(batch) }); targetId = batch.id; break;
      }
      case 'batch.freeze': {
        role(actor, 'pmo'); const batch = record(state, 'batches', p.batchId);
        assert(batch.status === 'planned', '该批次已经冻结');
        assert(batch.materialIds.length && batch.memberIds.length && batch.leadId && batch.recorderId && batch.requiredDepartments.length, '冻结前必须明确材料、参会人、主持人、记录员和必需反馈部门');
        batch.materialIds.forEach(value => { const material = record(state, 'materials', value); assert(material.status === 'confirmed', '冻结前需要来源部门代表确认全部材料'); assert(material.themeId === batch.themeId, '材料确认主题与批次主题不一致'); });
        batch.requiredDepartments.forEach(department => assert(batch.memberIds.some(value => { const member = record(state, 'users', value); return member.department === department && member.roles.includes('representative'); }), `参会名单缺少${department}代表`));
        const before = snapshot(batch); batch.status = 'frozen'; batch.frozenAt = now(); batch.frozenBy = actor.id;
        history(batch, actor, type, before, { after: snapshot(batch) }); targetId = batch.id; break;
      }
      case 'batch.feedback': {
        role(actor, 'representative'); const batch = record(state, 'batches', p.batchId);
        assert(batch.status === 'frozen', '批次冻结后才能记录部门反馈');
        assert(batch.memberIds.includes(actor.id), '当前身份不在该批次参会名单中', 'FORBIDDEN', 403);
        assert(batch.materialIds.includes(p.materialId), '材料不属于该批次');
        const note = text(p.note, '部门反馈', true); const coverage = batch.coverage[p.materialId];
        const before = clone(coverage); coverage.feedbackByDepartment[actor.department] = { actorId: actor.id, note, at: now() };
        if (coverage.status === 'reviewed') coverage.status = 'needs_followup';
        history(batch, actor, type, before, { materialId: p.materialId, after: clone(coverage) }); targetId = batch.id; break;
      }
      case 'batch.coverage': {
        const batch = record(state, 'batches', p.batchId);
        assert(actor.id === batch.leadId || actor.id === batch.recorderId, '仅主持人或本批次记录员可记录评审覆盖', 'FORBIDDEN', 403);
        assert(batch.materialIds.includes(p.materialId), '材料不属于该批次');
        const status = oneOf(p.status, ['pending', 'needs_followup', 'reviewed'], '覆盖状态');
        const note = text(p.note, '逐项讲评记录', status === 'reviewed'); const coverage = batch.coverage[p.materialId];
        if (status === 'reviewed') {
          assert(batch.status === 'frozen', '只有冻结批次才能标记已评审');
          assert(batch.requiredDepartments.every(department => coverage.feedbackByDepartment[department]), '尚有必需部门未反馈');
        }
        const before = clone(coverage); Object.assign(coverage, { status, note, updatedAt: now(), updatedBy: actor.id });
        history(batch, actor, type, before, { materialId: p.materialId, after: clone(coverage) }); targetId = batch.id; break;
      }
      case 'batch.present': {
        const batch = record(state, 'batches', p.batchId);
        assert(actor.id === batch.leadId || actor.id === batch.recorderId, '仅主持人或本批次记录员可切换讲解位置', 'FORBIDDEN', 403);
        assert(batch.status === 'frozen' && batch.materialIds.includes(p.materialId), '讲解位置必须属于已冻结批次');
        const nodeRef = text(p.nodeRef, '节点标识', false, 1000); validateAnchor(store, state, p.materialId, nodeRef, '');
        batch.presenter = { materialId: p.materialId, nodeRef, actorId: actor.id, updatedAt: now() }; targetId = batch.id; break;
      }
      case 'walk.edit':
      case 'walk.create':
      case 'walk.remove':
        return changeWalk(store, state, p, actor, type);
      case 'opinion.save': {
        role(actor, 'participant');
        assert(typeof p.submit === 'boolean', '请明确是否提交意见');
        const material = record(state, 'materials', p.materialId);
        const batchId = text(p.batchId, '批次标识', false, 1000);
        if (batchId) assert(record(state, 'batches', batchId).materialIds.includes(material.id), '意见引用的材料不属于该批次');
        const nodeRef = text(p.nodeRef, '节点标识', false, 1000); const relationRef = text(p.relationRef, '连线标识', false, 1000);
        validateAnchor(store, state, material.id, nodeRef, relationRef, true);
        const body = text(p.text, '意见内容', true);
        let opinion;
        if (p.opinionId) {
          opinion = record(state, 'opinions', p.opinionId);
          assert(opinion.authorId === actor.id, '只能修改自己的意见', 'FORBIDDEN', 403);
          assert(opinion.status !== 'submitted' || p.submit, '已提交意见不能退回草稿');
          assert(opinion.materialId === material.id && opinion.batchId === batchId && opinion.nodeRef === nodeRef && opinion.relationRef === relationRef, '修改意见不能改变其材料和定位；请新增意见');
          const before = snapshot(opinion); opinion.text = body; opinion.status = p.submit ? 'submitted' : 'draft'; opinion.updatedAt = now();
          history(opinion, actor, type, before, { after: snapshot(opinion) });
        } else {
          opinion = { id: id('opinion'), materialId: material.id, batchId, nodeRef, relationRef, text: body, status: p.submit ? 'submitted' : 'draft', authorId: actor.id, history: [], createdAt: now() };
          state.opinions.push(opinion);
        }
        targetId = opinion.id; break;
      }
      case 'issue.create': {
        role(actor, 'recorder');
        const materialIds = materialReferences(state, p.materialIds);
        const opinionIds = list(p.opinionIds, '来源意见');
        opinionIds.forEach(value => { const opinion = record(state, 'opinions', value); assert(opinion.status === 'submitted', '问题只能引用已提交的意见'); assert(materialIds.includes(opinion.materialId), '来源意见对应材料未包含在问题中'); });
        const scope = oneOf(p.scope, ['department', 'cross_department', 'policy'], '问题范围');
        const affectedDepartments = list(p.affectedDepartments, '受影响部门', scope === 'cross_department' ? 2 : 1);
        affectedDepartments.forEach(department => assert(departments.includes(department), '受影响部门不存在'));
        if (scope === 'department') assert(affectedDepartments.length === 1, '部门问题应指定一个受影响部门');
        const issue = { id: id('issue'), title: text(p.title, '问题标题', true, 300), description: text(p.description, '问题描述', true), impact: text(p.impact, '问题影响', true), materialIds, opinionIds, scope, affectedDepartments, status: 'open', responses: [], reviews: [], authorityEvidence: null, history: [], createdBy: actor.id, createdAt: now() };
        Object.assign(issue, validIssuePeople(state, issue, p));
        state.issues.push(issue); targetId = issue.id; break;
      }
      case 'issue.assign': {
        role(actor, 'recorder'); const issue = record(state, 'issues', p.issueId);
        assert(issue.status !== 'closed', '已关闭问题需要先复开');
        const before = snapshot(issue); const people = validIssuePeople(state, issue, { ...issue, ...p });
        const reviewersChanged = JSON.stringify([...people.reviewerIds].sort()) !== JSON.stringify([...issue.reviewerIds].sort());
        const assigneeChanged = people.assigneeId !== issue.assigneeId;
        const authorityChanged = people.authorityId !== issue.authorityId;
        Object.assign(issue, people);
        if (reviewersChanged || assigneeChanged) { issue.reviews = []; if (issue.status === 'awaiting_review') issue.status = 'in_progress'; }
        if (authorityChanged || assigneeChanged) issue.authorityEvidence = null;
        history(issue, actor, type, before, { after: snapshot(issue) }); targetId = issue.id; break;
      }
      case 'issue.respond': {
        const issue = record(state, 'issues', p.issueId);
        assert(actor.id === issue.assigneeId, '仅指定处理人可以提交处理答复', 'FORBIDDEN', 403);
        assert(issue.status !== 'closed', '已关闭问题需要先复开');
        const body = text(p.text, '处理答复', true); const evidence = text(p.evidence, '处理证据', true);
        const before = snapshot(issue); issue.responses.push({ id: id('response'), actorId: actor.id, text: body, evidence, at: now() });
        issue.status = 'awaiting_review'; issue.reviews = []; issue.authorityEvidence = null;
        history(issue, actor, type, before, { after: snapshot(issue) }); targetId = issue.id; break;
      }
      case 'issue.review': {
        const issue = record(state, 'issues', p.issueId);
        assert(issue.reviewerIds.includes(actor.id), '仅指定复核人可以复核', 'FORBIDDEN', 403);
        assert(issue.status === 'awaiting_review', '问题尚未提交复核');
        const decision = oneOf(p.decision, ['approve', 'return'], '复核决定'); const note = text(p.note, '复核意见', true);
        const before = snapshot(issue); issue.reviews = issue.reviews.filter(review => review.reviewerId !== actor.id);
        issue.reviews.push({ reviewerId: actor.id, decision, note, at: now() });
        const decisionRecord = clone(issue.reviews.at(-1));
        if (decision === 'return') { issue.status = 'in_progress'; issue.reviews = []; issue.authorityEvidence = null; }
        else tryClose(issue);
        history(issue, actor, type, before, { decision: decisionRecord, after: snapshot(issue) }); targetId = issue.id; break;
      }
      case 'issue.authority': {
        const issue = record(state, 'issues', p.issueId); role(actor, 'authority');
        assert(issue.scope === 'policy' && actor.id === issue.authorityId, '仅该制度问题指定的决定人可记录依据', 'FORBIDDEN', 403);
        assert(issue.status === 'awaiting_review', '处理答复进入复核后才能记录决定依据');
        const evidence = text(p.evidence, '制度决定依据', true); const before = snapshot(issue);
        issue.authorityEvidence = { actorId: actor.id, evidence, at: now() }; tryClose(issue);
        history(issue, actor, type, before, { after: snapshot(issue) }); targetId = issue.id; break;
      }
      case 'issue.reopen': {
        const issue = record(state, 'issues', p.issueId);
        assert(issue.reviewerIds.includes(actor.id) || issue.authorityId === actor.id, '仅指定复核人或决定人可复开', 'FORBIDDEN', 403);
        assert(issue.status === 'closed', '只有已关闭问题可以复开');
        const reason = text(p.reason, '复开原因', true); const before = snapshot(issue);
        issue.status = 'in_progress'; issue.reviews = []; issue.authorityEvidence = null; issue.closedAt = '';
        history(issue, actor, type, before, { reason, after: snapshot(issue) }); targetId = issue.id; break;
      }
      case 'observation.save': {
        role(actor, 'participant');
        const values = { title: text(p.title, '观察标题', true, 300), materialIds: materialReferences(state, p.materialIds, 0), issueIds: list(p.issueIds, '关联问题') };
        values.issueIds.forEach(value => record(state, 'issues', value));
        for (const key of ['phenomenon', 'timePattern', 'variables', 'hypotheses', 'feedback', 'delays', 'evidence', 'counterEvidence', 'nextEvidence']) values[key] = text(p[key], key);
        let observation;
        if (p.observationId) {
          observation = record(state, 'observations', p.observationId);
          assert(observation.createdBy === actor.id, '只能修改自己创建的观察', 'FORBIDDEN', 403);
          const before = snapshot(observation); Object.assign(observation, values, { updatedAt: now() }); history(observation, actor, type, before, { after: snapshot(observation) });
        } else {
          observation = { id: id('observation'), ...values, history: [], createdBy: actor.id, createdAt: now() }; state.observations.push(observation);
        }
        targetId = observation.id; break;
      }
      default: fail('未知操作类型', 'UNKNOWN_COMMAND');
    }
    return { detail: { targetId, rehearsal: true } };
  });
}
