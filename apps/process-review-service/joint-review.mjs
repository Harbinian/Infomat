import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ReviewError } from './domain.mjs';
import { materialWalkEdits, projectWalkDocument } from './public/walk-edits.js';

// Joint review is additive to legacy batches. No legacy status establishes these gates.
const need = (ok, message, code = 'JOINT_REVIEW_GATE', status = 400) => { if (!ok) throw new ReviewError(message, code, status); };
const text = (value, label) => { need(typeof value === 'string' && value.trim() && value.length <= 100000, `请填写${label}`); return value; };
const ids = (value, label, min = 0) => { need(Array.isArray(value) && value.length >= min && value.length <= 1000 && value.every(x => typeof x === 'string' && x) && new Set(value).size === value.length, `请明确${label}且不可重复`); return [...value]; };
const get = (items, id) => { const found = items.find(x => x.id === id); need(found, '引用的联合评审记录不存在', 'NOT_FOUND', 404); return found; };
const stamp = (actor, extra = {}) => ({ id: randomUUID(), actorId: actor.id, at: new Date().toISOString(), ...extra });
const hash = document => createHash('sha256').update(JSON.stringify(document)).digest('hex');
const unique = items => [...new Set(items)];
const current = item => get(item.versions, item.currentVersionId);
const pmo = actor => need(actor.roles.includes('pmo'), '仅PMO演练身份可组织此操作', 'FORBIDDEN', 403);
const member = (item, actor) => need(item.plan.requiredIds.includes(actor.id), '当前身份不在本事项规定人员范围内', 'FORBIDDEN', 403);
const stage = (item, ...values) => need(values.includes(item.stage), '当前事项阶段不允许此操作');
const sameVersion = (item, payload) => need(payload.versionId === item.currentVersionId, '请明确选择事项当前版本，旧版本记录不能代替当前确认');
const session = item => get(item.sessions, item.currentSessionId);
const prep = item => get(item.preparations, item.currentPreparationId);
const pathText = value => { need(typeof value === 'string' && (value === '' || /^\/(?:[^~]|~[01])*$/.test(value)), '范围必须为有效JSON Pointer'); return value; };
const paths = values => { need(Array.isArray(values) && values.length > 0 && values.length <= 1000 && new Set(values).size === values.length, '请明确范围位置且不可重复'); return values.map(pathText); };
const overlaps = (a, b) => a === '' || b === '' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const escapePointer = key => key.replace(/~/g, '~0').replace(/\//g, '~1');

export function changedPaths(before, after, pointer = '') {
  if (isDeepStrictEqual(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return [pointer];
  return unique([...Object.keys(before), ...Object.keys(after)]).flatMap(key => {
    const at = `${pointer}/${escapePointer(key)}`;
    return !Object.hasOwn(before, key) || !Object.hasOwn(after, key) ? [at] : changedPaths(before[key], after[key], at);
  });
}
const removedPaths = (before, after, pointer = '') => {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return before && typeof before === 'object' ? [pointer] : [];
  return Object.keys(before).flatMap(key => !Object.hasOwn(after, key) ? [`${pointer}/${escapePointer(key)}`] : removedPaths(before[key], after[key], `${pointer}/${escapePointer(key)}`));
};
function unaffected(item, fromId, scopePaths) {
  const changes = changedPaths(get(item.versions, fromId).document, current(item).document);
  return !changes.some(change => scopePaths.some(scope => overlaps(change, scope)));
}
function version(store, state, materialId, actor, parentId = '') {
  const material = get(state.materials, materialId);
  const edits = materialWalkEdits(state.audit, materialId);
  const document = structuredClone(projectWalkDocument(store.material(materialId).document, edits));
  return stamp(actor, { materialId, sourceSha256: material.sha256, walkEditIds: edits.map(x => x.id), parentId, document, digest: hash(document), reason: '明确选定材料及当前共享走查内容' });
}
const closed = (item, issue) => issue.resolutions.some(r => r.id === issue.activeResolutionId && r.versionId === item.currentVersionId);
const touch = item => { item.epoch += 1; };
function planPeople(state, values, label, min = 0) {
  return ids(values, label, min).map(id => { const user = get(state.users, id); need(user.roles.includes('participant'), `${label}须为演练参与人`); return id; });
}
function validateDocument(document, previous) {
  need(document && typeof document === 'object' && !Array.isArray(document), '修订材料必须为JSON对象');
  need(document.process && typeof document.process === 'object' && !Array.isArray(document.process), '修订材料缺少流程定义对象');
  need(document.schema_version === previous.schema_version && document.process?.process_ref === previous.process?.process_ref, '修订不得改变原schema或流程标识；不同材料须明确关联');
  for (const key of ['behaviors', 'flow_relations', 'data_objects', 'forms', 'terms']) need(document[key] === undefined || Array.isArray(document[key]), `${key}应为数组`);
  need(Buffer.byteLength(JSON.stringify(document)) <= 8 * 1024 * 1024, '修订材料过大');
}
function preparationGaps(item, selectedIds) {
  const selection = selectedIds.map(id => get(item.preparationRecords, id));
  const gaps = [];
  const has = (kind, actorId) => selection.some(r => r.kind === kind && r.subjectId === actorId && r.preparationId === item.currentPreparationId && r.versionId === item.currentVersionId);
  for (const [kind, people, label] of [['verification', item.plan.verifierIds, '内部核实'], ['preread', item.plan.receiverIds, '承接预读'], ['informed', item.plan.requiredIds, '知情准备']]) {
    people.forEach(id => { if (!has(kind, id)) gaps.push({ kind, subjectId: id, label }); });
  }
  if (!item.submissions.some(s => s.id === item.currentSubmissionId && s.versionId === item.currentVersionId && s.preparationId === item.currentPreparationId)) gaps.push({ kind: 'submission', subjectId: item.plan.ownerId, label: '归口汇总提交' });
  return gaps;
}
function presentationComplete(item) {
  const s = session(item);
  return s.cursor === s.sequence.length && s.summary?.versionId === item.currentVersionId && s.summary.epoch === item.epoch;
}
function voteReady(item) {
  need(presentationComplete(item), '请完成归口介绍、承接说明、顺时针质疑及PMO最后意见，并汇总当前内容');
  need(item.issues.every(issue => closed(item, issue)), '本轮仍有未闭合问题、冲突或认责事项，不能移到后续任务绕过');
  need(item.issues.every(issue => !issue.classificationRequired), '带入的未决事项须实际分类，不能用普通说明绕过实质冲突');
  need(item.issues.filter(issue => issue.kind === 'origin').every(issue => item.originReturns.some(r => r.decisionId === get(issue.resolutions, issue.activeResolutionId).decision.id)), '新确认起点归口变更须先完成受影响准备并重新到场核对');
  const required = unique([...item.plan.voterIds, item.plan.ownerId, ...item.plan.receiverIds, item.organizerId]);
  need(required.every(id => item.confirmations.some(c => c.actorId === id && c.versionId === item.currentVersionId && c.sessionId === item.currentSessionId && c.epoch === item.epoch)), '尚未取得各方对同一当前版本的实际确认');
}
function issueFor(item, p) { sameVersion(item, p); stage(item, 'reviewing'); return get(item.issues, p.issueId); }
function addIssue(item, actor, p, state) {
  const issue = stamp(actor, { title: text(p.title, '问题标题'), description: text(p.description, '问题及依据'), location: text(p.location, '问题位置'), kind: p.kind,
    responderIds: ids(p.responderIds, '回应主体', 1), decisionMakerId: p.decisionMakerId || '', authorityBasis: p.authorityBasis || '',
    scopePaths: paths(p.scopePaths), sourcePreparationRecordId: p.sourcePreparationRecordId || '', classificationRequired: Boolean(p.classificationRequired), sourceOpinionIds: ids(p.sourceOpinionIds || [], '原意见引用'), sourceLegacyIssueIds: ids(p.sourceLegacyIssueIds || [], '原问题引用'), versionId: item.currentVersionId, sessionId: item.currentSessionId, statements: [], decisions: [], syncs: [], confirmations: [], resolutions: [], activeDecisionId: '', activeSyncId: '', activeResolutionId: '' });
  issue.sourceOpinionIds.forEach(id => { const source = get(state.opinions, id); need(source.status === 'submitted' && item.materialIds.includes(source.materialId), '原意见须已提交且属于本事项明确材料'); });
  issue.sourceLegacyIssueIds.forEach(id => { const source = get(state.issues, id); need(source.materialIds.some(id => item.materialIds.includes(id)), '原问题须引用本事项材料；其异步状态不代替当前评审闭合'); });
  need(['definition', 'crud', 'raci', 'responsibility', 'origin'].includes(issue.kind), '问题类别无效');
  need(issue.responderIds.every(id => item.plan.requiredIds.includes(id)), '回应主体须在明确参评范围内');
  if (issue.kind !== 'definition') {
    need(item.plan.requiredIds.includes(issue.decisionMakerId), '须明确本问题的有权决定主体');
    text(issue.authorityBasis, '本问题有效权限依据');
  }
  item.issues.push(issue); touch(item); return issue;
}

export function validateJointState(state) {
  if (state.jointReviews === undefined) state.jointReviews = [];
  need(Array.isArray(state.jointReviews), '联合评审存储结构不受支持，原记录已保留', 'INVALID_STORAGE', 500);
  for (const item of state.jointReviews) need(item.formatVersion === 1 && item.plan && ['versions','preparations','preparationRecords','submissions','sessions','issues','confirmations','rounds','packages','handovers','originReturns','events'].every(key => Array.isArray(item[key])) && item.versions.some(v => v.id === item.currentVersionId), '联合评审记录版本不受支持，原记录已保留', 'INVALID_STORAGE', 500);
  return state;
}

export function executeJointCommand(store, state, actor, type, p) {
  validateJointState(state);
  if (type === 'joint.create') {
    pmo(actor);
    need(!state.jointReviews.some(x => x.materialIds.includes(p.materialId)), '该材料已有连续评审事项，请在原事项续办');
    const requiredIds = planPeople(state, p.requiredIds, '规定应到范围', 1), voterIds = planPeople(state, p.voterIds, '全员表决范围', 1);
    const verifierIds = planPeople(state, p.verifierIds, '内部核实经办人', 1), receiverIds = planPeople(state, p.receiverIds, '承接预读主体');
    need(unique([...voterIds, ...receiverIds, p.ownerId, actor.id]).every(id => requiredIds.includes(id)), '现场归口、承接、表决及PMO须纳入明确应到范围；内部核实经办单独安排');
    const v = version(store, state, p.materialId, actor), preparation = stamp(actor, { reason: '首次安排', affectedIds: [], checks: [] });
    const item = stamp(actor, { formatVersion: 1, title: text(p.title, '事项名称'), basis: text(p.basis, '启动及权限依据'), organizerId: actor.id, materialIds: [p.materialId],
      plan: { requiredIds, voterIds, verifierIds, receiverIds, ownerId: p.ownerId, scope: text(p.scope, '关联与接续范围'), schedule: text(p.schedule, '实际准备及评审时点安排'), requirements: text(p.requirements, '材料、预读及权限要求') },
      stage: 'preparing', epoch: 0, versions: [v], currentVersionId: v.id, preparations: [preparation], currentPreparationId: preparation.id, preparationRecords: [], submissions: [], currentSubmissionId: '',
      sessions: [], currentSessionId: '', issues: [], confirmations: [], rounds: [], currentRoundId: '', packages: [], activePackageId: '', handovers: [], currentHandoverId: '', originReturns: [], events: [] });
    state.jointReviews.push(item);
    return { detail: { targetId: item.id, versionId: v.id, rehearsal: true } };
  }
  const item = get(state.jointReviews, p.reviewId);
  need(actor.roles.includes('pmo') || item.plan.requiredIds.includes(actor.id) || item.plan.verifierIds.includes(actor.id) || item.handovers.some(h => h.recipientIds.includes(actor.id)), '当前身份未参与此事项', 'FORBIDDEN', 403);
  const event = stamp(actor, { type, payload: structuredClone(p), beforeStage: item.stage });
  switch (type) {
    case 'joint.plan.amend': {
      pmo(actor); stage(item, 'preparing');
      event.previousPlan = structuredClone(item.plan);
      for (const key of ['scope', 'schedule', 'requirements']) item.plan[key] = text(p[key], '补明的范围、时点及准备要求');
      const affectedIds = planPeople(state, p.affectedIds, '受影响的准备主体', 1);
      need(affectedIds.every(id => [...item.plan.requiredIds,...item.plan.verifierIds].includes(id)), '受影响主体须属于本次明确安排');
      const preparation = stamp(actor, { reason: text(p.note, '安排补明及受影响准备依据'), affectedIds, checks: [] });
      item.preparations.push(preparation); item.currentPreparationId = preparation.id; item.currentSubmissionId = ''; touch(item); break;
    }
    case 'joint.preparation.reopen': {
      pmo(actor); stage(item, 'ready'); text(p.note, '发现的准备缺项及补齐要求'); item.stage = 'preparing'; delete prep(item).passedCheckId; break;
    }
    case 'joint.preparation.record': {
      stage(item, 'preparing'); sameVersion(item, p);
      const allowed = { verification: item.plan.verifierIds, preread: item.plan.receiverIds, informed: item.plan.requiredIds };
      need(allowed[p.kind]?.includes(actor.id), '当前身份不承担此项准备', 'FORBIDDEN', 403);
      if (p.kind === 'preread') need(item.submissions.some(s => s.id === item.currentSubmissionId && s.versionId === item.currentVersionId && s.preparationId === item.currentPreparationId), '归口尚未汇总提交本次明确材料');
      const unresolved = p.unresolved ? text(p.unresolved, '未决事项') : '';
      if (unresolved) { text(p.position, '未决事项位置'); need(item.plan.requiredIds.includes(p.responderId), '请明确未决事项回应主体'); }
      item.preparationRecords.push(stamp(actor, { kind: p.kind, subjectId: actor.id, preparationId: item.currentPreparationId, versionId: item.currentVersionId, scopePaths: paths(p.scopePaths), note: text(p.note, '实际核对内容及依据'), unresolved, position: p.position || '', responderId: p.responderId || '', reusedFromId: '' })); break;
    }
    case 'joint.preparation.reuse': {
      pmo(actor); stage(item, 'preparing'); sameVersion(item, p);
      const source = get(item.preparationRecords, p.recordId);
      need(!prep(item).affectedIds.includes(source.subjectId) && unaffected(item, source.versionId, source.scopePaths), '该记录的责任主体或内容受影响，须实际重新准备');
      need(({verification:item.plan.verifierIds,preread:item.plan.receiverIds,informed:item.plan.requiredIds})[source.kind].includes(source.subjectId), '原记录不再属于当前准备要求');
      item.preparationRecords.push(stamp(actor, { ...structuredClone(source), ...stamp(actor), subjectId: source.subjectId, preparationId: item.currentPreparationId, versionId: item.currentVersionId, reusedFromId: source.id, reuseBasis: text(p.note, '未受影响及有效复用依据') })); break;
    }
    case 'joint.submit': {
      stage(item, 'preparing'); sameVersion(item, p); need(actor.id === item.plan.ownerId, '仅明确归口主体可汇总提交', 'FORBIDDEN', 403);
      const selected = ids(p.recordIds, '选定内部核实记录', 1).map(id => get(item.preparationRecords, id));
      need(item.plan.verifierIds.every(id => selected.some(r => r.kind === 'verification' && r.subjectId === id && r.versionId === item.currentVersionId && r.preparationId === item.currentPreparationId)), '须实际取得全部规定经办人的本次内部核实说明');
      const submitted = stamp(actor, { versionId: item.currentVersionId, preparationId: item.currentPreparationId, recordIds: selected.map(r => r.id), note: text(p.note, '已核实内容与未决事项汇总') });
      item.submissions.push(submitted); item.currentSubmissionId = submitted.id; break;
    }
    case 'joint.preparation.check': {
      pmo(actor); stage(item, 'preparing'); sameVersion(item, p);
      const recordIds = ids(p.recordIds, '本次选定准备记录'), gaps = preparationGaps(item, recordIds);
      const check = stamp(actor, { recordIds, versionId: item.currentVersionId, gaps, note: text(p.note, '准备检查及缺项责任说明'), passed: gaps.length === 0 });
      prep(item).checks.push(check); if (check.passed) { item.stage = 'ready'; prep(item).passedCheckId = check.id; } break;
    }
    case 'joint.attendance': {
      pmo(actor); stage(item, 'ready'); sameVersion(item, p);
      const presentIds = ids(p.presentIds, '实际到场人员'); need(presentIds.every(id => item.plan.requiredIds.includes(id)), '不能以替代人员补齐应到范围');
      const questionerIds = ids(p.questionerIds, '现场座位顺时针质疑顺序');
      need(questionerIds.every(id => item.plan.requiredIds.includes(id) && id !== item.organizerId), '质疑顺序须选规定人员，PMO最后单列');
      const s = stamp(actor, { preparationId: item.currentPreparationId, versionId: item.currentVersionId, presentIds, questionerIds, note: text(p.note, '到场及现场座次核对依据'), started: item.plan.requiredIds.every(id => presentIds.includes(id)), cursor: 0, events: [], summary: null });
      if (s.started) {
        need(questionerIds.length, '须明确实际负责人的顺时针质疑顺序');
        s.sequence = [{ kind: 'introduction', actorId: item.plan.ownerId }, ...item.plan.receiverIds.map(actorId => ({ kind: 'receiving', actorId })), ...questionerIds.map(actorId => ({ kind: 'question', actorId })), { kind: 'pmo', actorId: item.organizerId }];
        item.currentSessionId = s.id; item.stage = 'reviewing';
        const check = get(prep(item).checks, prep(item).passedCheckId);
        for (const recordId of check.recordIds) {
          const record = get(item.preparationRecords, recordId);
          if (!record.unresolved) continue;
          let source = record;
          while (source.reusedFromId) source = get(item.preparationRecords, source.reusedFromId);
          if (!item.issues.some(issue => issue.sourcePreparationRecordId === source.id)) addIssue(item, actor, { title: '准备中带入的实际未决事项', description: `${record.unresolved}；依据：${record.note}`, location: record.position, kind: 'definition', responderIds: [record.responderId], scopePaths: record.scopePaths, sourcePreparationRecordId: source.id, classificationRequired: true }, state);
        }
      }
      item.sessions.push(s); break;
    }
    case 'joint.meeting.speak': {
      stage(item, 'reviewing'); sameVersion(item, p);
      const s = session(item), next = s.sequence[s.cursor];
      need(next?.actorId === actor.id && next.kind === p.kind, '须由当前环节实际主体按归口、承接、顺时针质疑、PMO最后的顺序办理', 'FORBIDDEN', 403);
      s.events.push(stamp(actor, { kind: p.kind, versionId: item.currentVersionId, note: text(p.note, '本环节实际说明；无质疑可据实记录') })); s.cursor += 1; break;
    }
    case 'joint.summary': {
      pmo(actor); stage(item, 'reviewing'); sameVersion(item, p); const s = session(item);
      need(s.cursor === s.sequence.length, '请先完成现场介绍、接续及意见顺序');
      s.summary = stamp(actor, { versionId: item.currentVersionId, epoch: item.epoch, note: text(p.note, '当前核对及关联影响汇总') }); break;
    }
    case 'joint.version.select':
    case 'joint.version.revise': {
      stage(item, 'preparing', 'reviewing'); sameVersion(item, p); member(item, actor);
      const previous = current(item); need(p.beforeDigest === previous.digest, '修订基线已改变，请核对当前版本');
      const selected = type === 'joint.version.select' ? version(store, state, p.materialId, actor, previous.id) : null;
      const document = selected?.document || p.document;
      if (selected) {
        pmo(actor); need(!state.jointReviews.some(x => x.id !== item.id && x.materialIds.includes(p.materialId)), '所选材料已属于其他连续事项，不能静默合并');
      } else validateDocument(document, previous.document);
      const changes = changedPaths(previous.document, document);
      if (!changes.length && (!selected || selected.materialId === previous.materialId)) return { unchanged: true };
      text(p.reason, '实际修订及关联影响说明');
      need(isDeepStrictEqual(ids(p.removedPaths, '明确删除的位置').sort(), removedPaths(previous.document, document).sort()), '须逐项核对实际删除的位置，不得静默丢弃未知字段');
      const v = selected ? { ...selected, changedPaths: changes, reason: p.reason } : stamp(actor, { materialId: previous.materialId, sourceSha256: previous.sourceSha256, walkEditIds: previous.walkEditIds, parentId: previous.id, document: structuredClone(document), digest: hash(document), changedPaths: changes, reason: p.reason });
      if (selected) item.materialIds = unique([...item.materialIds, selected.materialId]);
      item.versions.push(v); item.currentVersionId = v.id; item.currentSubmissionId = ''; item.issues.forEach(issue => { issue.activeResolutionId = ''; issue.activeSyncId = ''; }); touch(item);
      if (item.stage === 'preparing') prep(item).affectedIds = unique([...prep(item).affectedIds, ...ids(p.affectedIds, '受影响准备主体')]);
      break;
    }
    case 'joint.issue.register': {
      stage(item, 'reviewing'); sameVersion(item, p); member(item, actor); addIssue(item, actor, p, state); break;
    }
    case 'joint.issue.classify': {
      pmo(actor); const issue = issueFor(item, p);
      need(issue.classificationRequired && !issue.decisions.length, '仅带入且尚未处理的实际未决事项可分类');
      need(['definition','crud','raci','responsibility','origin'].includes(p.kind), '问题类别无效');
      issue.kind = p.kind; issue.responderIds = ids(p.responderIds, '相关业务回应主体', 1);
      need(issue.responderIds.every(id => item.plan.requiredIds.includes(id)), '回应主体须在规定范围');
      if (p.kind !== 'definition') { need(item.plan.requiredIds.includes(p.decisionMakerId), '请明确本问题有权决定主体'); issue.decisionMakerId = p.decisionMakerId; issue.authorityBasis = text(p.authorityBasis, '本问题有效权限依据'); }
      issue.classificationRequired = false; touch(item); break;
    }
    case 'joint.issue.statement': {
      const issue = issueFor(item, p); need(issue.responderIds.includes(actor.id), '仅本问题相关业务方可说明', 'FORBIDDEN', 403);
      issue.statements.push(stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, note: text(p.note, '业务事实及依据') })); break;
    }
    case 'joint.issue.decide': {
      const issue = issueFor(item, p);
      need(!issue.classificationRequired, '带入的未决事项须先实际分类');
      need(issue.kind === 'definition' ? issue.responderIds.includes(actor.id) : actor.id === issue.decisionMakerId, '须由本问题明确的业务或有权主体决定，不能从职务推定', 'FORBIDDEN', 403);
      need(issue.responderIds.every(id => issue.statements.some(s => s.actorId === id && s.versionId === item.currentVersionId && s.sessionId === item.currentSessionId)), '尚未取得相关业务方对本问题的当场说明');
      const decision = stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, note: text(p.note, '有效处理结论及依据'), authorityBasis: issue.authorityBasis, newOwnerId: issue.kind === 'origin' ? p.newOwnerId : '' });
      if (issue.kind === 'origin') need(item.plan.requiredIds.includes(p.newOwnerId) && p.newOwnerId !== item.plan.ownerId, '请明确有效决定中的新归口主体');
      issue.decisions.push(decision); issue.activeDecisionId = decision.id; issue.activeSyncId = ''; issue.activeResolutionId = ''; touch(item); break;
    }
    case 'joint.issue.sync': {
      pmo(actor); const issue = issueFor(item, p); need(issue.activeDecisionId, '尚未取得有效业务处理结论');
      const sync = stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, decisionId: issue.activeDecisionId, modelNote: text(p.modelNote, '处理结论与当前模型的对应位置'), impactNote: text(p.impactNote, '关联影响核对') });
      issue.syncs.push(sync); issue.activeSyncId = sync.id; issue.activeResolutionId = ''; touch(item); break;
    }
    case 'joint.issue.confirm': {
      const issue = issueFor(item, p), requiredIds = unique([...issue.responderIds, ...(issue.decisionMakerId ? [issue.decisionMakerId] : [])]);
      need(requiredIds.includes(actor.id), '仅本问题相关确认主体可即时确认', 'FORBIDDEN', 403);
      const sync = get(issue.syncs, issue.activeSyncId); need(sync.versionId === item.currentVersionId && sync.sessionId === item.currentSessionId, '请先将决定同步至本场次当前模型');
      issue.confirmations.push(stamp(actor, { syncId: sync.id, versionId: item.currentVersionId, note: text(p.note, '当前模型、业务及认责即时确认') }));
      if (requiredIds.every(id => issue.confirmations.some(c => c.actorId === id && c.syncId === sync.id))) {
        const resolution = stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, decision: structuredClone(get(issue.decisions, sync.decisionId)), sync: structuredClone(sync), confirmations: structuredClone(issue.confirmations.filter(c => c.syncId === sync.id)) });
        issue.resolutions.push(resolution); issue.activeResolutionId = resolution.id;
      }
      touch(item); break;
    }
    case 'joint.issue.reuse': {
      pmo(actor); const issue = issueFor(item, p), source = get(issue.resolutions, p.resolutionId);
      need(unaffected(item, source.versionId, issue.scopePaths), '问题处理范围受到实际修订影响，须重新同步及即时确认');
      const reused = stamp(actor, { ...structuredClone(source), ...stamp(actor), versionId: item.currentVersionId, reusedFromId: source.id, reuseBasis: text(p.note, '原结论、模型及确认未受影响的复用依据') });
      issue.resolutions.push(reused); issue.activeResolutionId = reused.id; touch(item); break;
    }
    case 'joint.origin.return': {
      pmo(actor); const issue = issueFor(item, p); need(issue.kind === 'origin' && closed(item, issue), '须先在当前评审取得归口变更的有效决定、同步及即时确认');
      const resolution = get(issue.resolutions, issue.activeResolutionId), decision = resolution.decision;
      need(!item.originReturns.some(r => r.decisionId === decision.id), '该历史归口变更已返回准备，不得重复触发');
      const affectedIds = planPeople(state, p.affectedIds, '受影响准备主体', 1), verifierIds = planPeople(state, p.verifierIds, '调整后的核实主体', 1), receiverIds = planPeople(state, p.receiverIds, '调整后的承接预读主体');
      need(receiverIds.every(id => item.plan.requiredIds.includes(id)) && affectedIds.every(id => [...item.plan.requiredIds,...item.plan.verifierIds,...verifierIds].includes(id)), '本次不提供人员替换或排除既定参评人员的通道；内部核实主体单独明确');
      need(affectedIds.includes(decision.newOwnerId), '新归口须重新落实受影响准备');
      const preparation = stamp(actor, { reason: text(p.note, '有效归口变更及受影响准备要求'), affectedIds, checks: [] });
      item.originReturns.push(stamp(actor, { issueId: issue.id, decisionId: decision.id, resolutionId: resolution.id, previousPlan: structuredClone(item.plan), preparationId: preparation.id }));
      Object.assign(item.plan, { ownerId: decision.newOwnerId, verifierIds, receiverIds }); item.preparations.push(preparation); item.currentPreparationId = preparation.id; item.currentSubmissionId = ''; item.currentSessionId = ''; item.stage = 'preparing'; touch(item); break;
    }
    case 'joint.confirm': {
      stage(item, 'reviewing'); sameVersion(item, p); member(item, actor);
      need(presentationComplete(item) && item.issues.every(issue => closed(item, issue)), '先完成当前汇总及问题、冲突闭合，再确认当前版本');
      item.confirmations.push(stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, epoch: item.epoch, scope: text(p.scope, '本方实际责任与确认范围'), note: text(p.note, '同一当前版本确认依据') })); break;
    }
    case 'joint.vote.open': {
      pmo(actor); stage(item, 'reviewing'); sameVersion(item, p); voteReady(item);
      const round = stamp(actor, { versionId: item.currentVersionId, sessionId: item.currentSessionId, epoch: item.epoch, voterIds: [...item.plan.voterIds], ballots: [], status: 'open' });
      item.rounds.push(round); item.currentRoundId = round.id; item.stage = 'voting'; break;
    }
    case 'joint.vote.cast': {
      stage(item, 'voting'); sameVersion(item, p); const round = get(item.rounds, p.roundId);
      need(round.id === item.currentRoundId && round.status === 'open' && round.versionId === item.currentVersionId && round.voterIds.includes(actor.id), '须对本轮同一版本由本人表态', 'FORBIDDEN', 403);
      need(!round.ballots.some(b => b.actorId === actor.id), '本轮已表态；重新表决须开启新轮，不覆盖旧票');
      need(['agree', 'oppose', 'abstain', 'conditional'].includes(p.choice), '请明确本轮表态');
      need(p.choice !== 'agree' || !p.condition, '仍附本轮未解条件不能记为赞成');
      const condition = p.condition ? text(p.condition, '仍未解决的条件') : '';
      const note = p.choice === 'agree' && !p.note ? '' : text(p.note, '本轮表态及理由');
      round.ballots.push(stamp(actor, { roundId: round.id, versionId: item.currentVersionId, choice: p.choice, note, condition })); break;
    }
    case 'joint.vote.finish': {
      pmo(actor); stage(item, 'voting'); sameVersion(item, p); const round = get(item.rounds, item.currentRoundId);
      const passed = round.voterIds.every(id => round.ballots.some(b => b.actorId === id && b.choice === 'agree' && !b.condition));
      Object.assign(round, { status: passed ? 'unanimous' : 'not_passed', endedAt: new Date().toISOString(), note: text(p.note, '本轮实际表决汇总'), missingIds: round.voterIds.filter(id => !round.ballots.some(b => b.actorId === id)) });
      item.stage = passed ? 'approved' : 'reviewing';
      if (!passed) {
        for (const ballot of round.ballots.filter(b => b.choice !== 'agree')) addIssue(item, actor, { title: '本轮未赞成意见', description: ballot.note + (ballot.condition ? `；条件：${ballot.condition}` : ''), location: `表决轮次 ${round.id}`, kind: 'definition', responderIds: [ballot.actorId], scopePaths: [''], classificationRequired: true }, state);
        touch(item);
      }
      break;
    }
    case 'joint.package.freeze': {
      pmo(actor); stage(item, 'approved'); sameVersion(item, p); voteReady(item);
      const round = get(item.rounds, item.currentRoundId); need(round.status === 'unanimous' && round.versionId === item.currentVersionId && round.epoch === item.epoch, '只有当前版本本轮全员明确赞成才能固化');
      const pack = stamp(actor, { versionId: item.currentVersionId, version: structuredClone(current(item)), round: structuredClone(round), plan: structuredClone(item.plan), basis: item.basis,
        preparation: structuredClone(prep(item)), preparationRecords: structuredClone(item.preparationRecords), submissions: structuredClone(item.submissions), sessions: structuredClone(item.sessions), issues: structuredClone(item.issues), confirmations: structuredClone(item.confirmations), originReturns: structuredClone(item.originReturns),
        storageLocation: text(p.storageLocation, '通过成果保存位置'), custodian: text(p.custodian, '保管责任'), note: text(p.note, '精确通过内容及引用材料说明') });
      item.packages.push(pack); item.activePackageId = pack.id; item.stage = 'passed'; break;
    }
    case 'joint.resume': {
      pmo(actor); stage(item, 'approved', 'passed', 'handover', 'completed'); sameVersion(item, p); text(p.note, '续评原因及原成果适用边界');
      item.stage = 'reviewing'; item.activePackageId = ''; item.currentHandoverId = ''; touch(item); break;
    }
    case 'joint.action.plan': {
      pmo(actor); stage(item, 'passed'); item.actionPlans ??= [];
      const responsibleIds = planPeople(state, p.responsibleIds, '后续执行主体', 1);
      item.actionPlans.push(stamp(actor, { packageId: item.activePackageId, responsibleIds, description: text(p.description, '后续事项'), expectedResult: text(p.expectedResult, '应形成结果'), authorityBasis: text(p.authorityBasis, '既有职责或有效决定依据'), followup: text(p.followup, '配合、核验及反馈安排') })); break;
    }
    case 'joint.handover.send': {
      pmo(actor); stage(item, 'passed'); const pack = get(item.packages, p.packageId); need(pack.id === item.activePackageId, '须交接当前固化通过包');
      const recipientIds = planPeople(state, p.recipientIds, '实际成果接收责任方', 1);
      need(Array.isArray(p.actions) && p.actions.length <= 1000, '后续事项须为列表，无事项保留空列表并据实说明');
      const actions = p.actions.map(a => { need(a && typeof a === 'object', '后续事项格式无效'); return { id: randomUUID(), description: text(a.description, '后续事项'), responsibleIds: planPeople(state, a.responsibleIds, '后续执行主体', 1), expectedResult: text(a.expectedResult, '应形成结果'), authorityBasis: text(a.authorityBasis, '既有职责或有效决定依据'), followup: text(a.followup, '配合、核验及反馈安排'), status: 'pending', completion: null }; });
      need(actions.every(a => a.responsibleIds.every(id => recipientIds.includes(id))), '后续责任方须实际接收相应事项');
      const handover = stamp(actor, { packageId: pack.id, recipientIds, actions, note: text(p.note, '成果、责任范围及实际发送说明'), receipts: [] });
      item.handovers.push(handover); item.currentHandoverId = handover.id; item.stage = 'handover'; break;
    }
    case 'joint.handover.receive': {
      stage(item, 'handover'); const handover = get(item.handovers, p.handoverId);
      need(handover.id === item.currentHandoverId && handover.recipientIds.includes(actor.id), '仅本次实际接收责任方可确认接收', 'FORBIDDEN', 403);
      need(!handover.receipts.some(r => r.actorId === actor.id), '本次接收已确认');
      handover.receipts.push(stamp(actor, { packageId: handover.packageId, note: text(p.note, '已实际接收的版本、承担内容及反馈关系') }));
      if (handover.recipientIds.every(id => handover.receipts.some(r => r.actorId === id))) item.stage = 'completed'; break;
    }
    case 'joint.action.complete': {
      const h = get(item.handovers, p.handoverId), action = get(h.actions, p.actionId);
      need(action.responsibleIds.includes(actor.id) && h.receipts.some(r => r.actorId === actor.id), '仅已实际接收的执行主体可记录本方后续完成', 'FORBIDDEN', 403);
      need(action.status === 'pending', '后续完成记录已存在');
      action.completion = stamp(actor, { note: text(p.note, '实际完成结果及证据') }); action.status = 'completed'; break;
    }
    default: throw new ReviewError('未知联合评审操作', 'UNKNOWN_COMMAND');
  }
  event.afterStage = item.stage; event.versionId = item.currentVersionId; item.events.push(event);
  return { detail: { targetId: item.id, versionId: item.currentVersionId, eventId: event.id, rehearsal: true } };
}
