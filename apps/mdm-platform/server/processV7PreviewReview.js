const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { validateProcessGovernanceV7 } = require('../../../scripts/process-governance/v7-validator');

const V7 = 'process-governance-v7';
const CONTRACTS_DIR = path.resolve(__dirname, '../../../docs/contracts');
const V7_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'process-governance-v7.schema.json'), 'utf8'));
const validator = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
for (const version of [1, 2]) {
  validator.addSchema(JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, `process-governance-v${version}.schema.json`), 'utf8')));
}
const validateV7 = validator.compile(V7_SCHEMA);

const PARTY_STATUSES = new Set(['pending', 'confirmed', 'needs_changes', 'pending_evidence', 'disputed']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function actorDepartment(actorRole, departments) {
  const raw = text(actorRole);
  if (!raw || raw === '全公司') return null;
  return [...departments]
    .filter(item => text(item && item.name))
    .sort((left, right) => text(right.name).length - text(left.name).length)
    .find(item => raw === text(item.name) || raw.startsWith(text(item.name))) || null;
}

function actorPosition(actorRole, departmentName) {
  const raw = text(actorRole);
  const department = text(departmentName);
  return department && raw.startsWith(department) ? raw.slice(department.length).trim() : '';
}

function relationProjection(document, behaviorRef) {
  return list(document.flow_relations)
    .filter(item => text(item.from_behavior_ref) === behaviorRef || text(item.to_behavior_ref) === behaviorRef)
    .map(item => ({
      relation_ref: text(item.relation_ref),
      relation_type: text(item.relation_type),
      from_behavior_ref: text(item.from_behavior_ref),
      to_behavior_ref: item.to_behavior_ref == null ? null : text(item.to_behavior_ref),
      condition: text(item.condition)
    }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function dataProjection(document, behaviorRef) {
  return list(document.data_objects).flatMap(dataObject => {
    const fieldNames = new Map(list(dataObject.fields).map(field => [text(field.field_ref), text(field.field_name)]));
    return list(dataObject.behavior_links)
      .filter(link => text(link.behavior_ref) === behaviorRef)
      .map(link => ({
        data_ref: text(dataObject.data_ref),
        data_name: text(dataObject.data_name),
        operation: text(link.operation),
        updated_fields: list(link.updated_field_refs).map(ref => ({
          field_ref: text(ref),
          field_name: fieldNames.get(text(ref)) || ''
        }))
      }));
  }).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function formProjection(document, behaviorRef) {
  return list(document.forms).flatMap(form => list(form.behavior_links)
    .filter(link => text(link.behavior_ref) === behaviorRef)
    .map(link => ({
      form_ref: text(form.form_ref),
      form_name: text(form.form_name),
      operation: text(link.operation)
    })))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function itemStatus(item) {
  const statuses = [text(item.origin_status) || 'pending', text(item.counterparty_status) || 'pending'];
  if (statuses.includes('disputed')) return 'disputed';
  if (statuses.includes('needs_changes')) return 'needs_changes';
  if (statuses.includes('pending_evidence')) return 'pending_evidence';
  if (statuses.every(status => status === 'confirmed')) return 'confirmed';
  return 'pending';
}

function unresolvedBlockingIssues(blockingIssues, scopeDecision = '') {
  return list(blockingIssues).filter(issue => {
    const code = text(issue && issue.code);
    if (code === 'ZERO_CROSS_DEPARTMENT_SCOPE_PENDING') {
      return scopeDecision !== 'confirmed_no_cross_department';
    }
    if (code === 'OWNING_DEPARTMENT_CHANGE_PENDING') {
      return scopeDecision !== 'keep_current_owner';
    }
    return true;
  });
}

function caseStatusFromItems(items, hasOwner = true, blockingIssues = [], scopeDecision = '') {
  if (!hasOwner) return 'pending_owner';
  const statuses = list(items).map(itemStatus);
  if (statuses.includes('disputed')) return 'disputed';
  if (statuses.includes('needs_changes')) return 'needs_revision';
  if (unresolvedBlockingIssues(blockingIssues, scopeDecision).length) return 'under_review';
  if (!statuses.length && scopeDecision === 'confirmed_no_cross_department') return 'review_complete';
  if (statuses.length > 0 && statuses.every(status => status === 'confirmed')) return 'review_complete';
  return 'under_review';
}

function validateAndProjectV7(document, departments, options = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { errors: [{ field: 'document', message: 'V7文件内容必须是JSON对象' }], warnings: [], blockingIssues: [], items: [] };
  }
  const validation = validateProcessGovernanceV7(document, { schemaValidator: validateV7 });
  if (!validation.valid) {
    return {
      errors: validation.errors.map(error => ({
        ...error,
        field: String(error.path || '/').replace(/^\//, '').replace(/\//g, '.') || 'document'
      })),
      warnings: [],
      blockingIssues: [],
      items: []
    };
  }

  const process = document.process || {};
  const warnings = [];
  const blockingIssues = [];
  const declaredOwningName = text(process.owning_department);
  const assignedOwningName = text(options.owningDepartmentName);
  const owningName = assignedOwningName || declaredOwningName;
  const owningDepartment = list(departments).find(item => text(item.name) === owningName) || null;
  if (!owningName) {
    warnings.push({ code: 'OWNING_DEPARTMENT_PENDING', message: '归口部门尚未明确，需要由MDM工作组组长分派后再生成跨部门核对项。' });
  } else if (!owningDepartment) {
    return {
      errors: [{ field: 'process.owning_department', message: '归口部门不在3000当前有效部门中' }],
      warnings,
      blockingIssues,
      items: []
    };
  }
  if (assignedOwningName && declaredOwningName && assignedOwningName !== declaredOwningName) {
    const issue = {
      code: 'OWNING_DEPARTMENT_CHANGE_PENDING',
      current_department_name: assignedOwningName,
      declared_department_name: declaredOwningName,
      message: `当前修订中的归口部门为“${declaredOwningName}”，与案例当前归口部门“${assignedOwningName}”不同，需要由MDM工作组组长记录范围决定。`
    };
    warnings.push(issue);
    blockingIssues.push(issue);
  }

  const items = [];
  for (const behavior of list(document.behaviors)) {
    if (text(behavior.actor_assignment_mode) !== 'fixed_department') continue;
    const executionDepartment = actorDepartment(behavior.current_actor_role, departments);
    if (!text(behavior.current_actor_role) || text(behavior.current_actor_role) === '全公司') continue;
    if (!executionDepartment) {
      const issue = {
        code: 'ACTOR_DEPARTMENT_UNRESOLVED',
        behavior_ref: text(behavior.behavior_ref),
        message: `业务行为“${text(behavior.behavior_name) || text(behavior.behavior_ref)}”的执行部门无法与3000有效部门对应。`
      };
      warnings.push(issue);
      blockingIssues.push(issue);
      continue;
    }
    if (!owningDepartment || Number(executionDepartment.id) === Number(owningDepartment.id)) continue;

    const snapshot = {
      departments: {
        origin_department_code: text(owningDepartment.code),
        origin_department_name: text(owningDepartment.name),
        target_department_code: text(executionDepartment.code),
        target_department_name: text(executionDepartment.name)
      },
      behavior: {
        behavior_ref: text(behavior.behavior_ref),
        node_type: text(behavior.node_type),
        behavior_name: text(behavior.behavior_name),
        behavior_description: text(behavior.behavior_description),
        current_actor_role: text(behavior.current_actor_role),
        actor_assignment_mode: text(behavior.actor_assignment_mode),
        trigger: text(behavior.trigger),
        precondition: text(behavior.precondition),
        timing: behavior.timing == null ? null : text(behavior.timing),
        completion_standard: text(behavior.completion_standard)
      },
      flow_relations: relationProjection(document, text(behavior.behavior_ref)),
      data_relations: dataProjection(document, text(behavior.behavior_ref)),
      form_relations: formProjection(document, text(behavior.behavior_ref))
    };
    items.push({
      stable_item_key: contentHash([text(behavior.behavior_ref), text(executionDepartment.code)]),
      behavior_ref: text(behavior.behavior_ref),
      behavior_name: text(behavior.behavior_name),
      origin_department_id: Number(owningDepartment.id),
      origin_department_name: text(owningDepartment.name),
      target_department_id: Number(executionDepartment.id),
      target_department_name: text(executionDepartment.name),
      actor_role: text(behavior.current_actor_role),
      actor_position: actorPosition(behavior.current_actor_role, executionDepartment.name),
      item_digest: contentHash(snapshot),
      item_snapshot: snapshot,
      origin_status: 'pending',
      counterparty_status: 'pending',
      status: 'pending',
      carry_state: 'new'
    });
  }
  if (owningDepartment && !items.length && !blockingIssues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED')) {
    const issue = {
      code: 'ZERO_CROSS_DEPARTMENT_SCOPE_PENDING',
      message: '当前V7没有识别到固定跨部门行为；这不等于业务上确认不涉及跨部门。'
    };
    warnings.push(issue);
    blockingIssues.push(issue);
  }
  return {
    errors: [],
    warnings,
    blockingIssues,
    items,
    document,
    contentHash: contentHash(document),
    processRef: text(process.process_ref),
    processName: text(process.process_name),
    owningDepartment,
    previewOnly: true
  };
}

function mergeReviewItems(previousItems, nextItems) {
  const previousByKey = new Map(list(previousItems).map(item => [text(item.stable_item_key), item]));
  return list(nextItems).map(next => {
    const previous = previousByKey.get(text(next.stable_item_key));
    if (!previous) return { ...next, carry_state: 'new' };
    if (text(previous.item_digest) !== text(next.item_digest)) {
      return {
        ...next,
        origin_status: 'pending',
        counterparty_status: 'pending',
        status: 'pending',
        carried_from_item_id: previous.id || null,
        carry_state: 'reopened'
      };
    }
    const merged = {
      ...next,
      origin_status: PARTY_STATUSES.has(text(previous.origin_status)) ? text(previous.origin_status) : 'pending',
      origin_basis: text(previous.origin_basis),
      origin_decided_by_user_id: previous.origin_decided_by_user_id || null,
      origin_decided_by_person_id: previous.origin_decided_by_person_id || null,
      origin_decided_at: previous.origin_decided_at || null,
      counterparty_status: PARTY_STATUSES.has(text(previous.counterparty_status)) ? text(previous.counterparty_status) : 'pending',
      counterparty_basis: text(previous.counterparty_basis),
      counterparty_decided_by_user_id: previous.counterparty_decided_by_user_id || null,
      counterparty_decided_by_person_id: previous.counterparty_decided_by_person_id || null,
      counterparty_decided_at: previous.counterparty_decided_at || null,
      carried_from_item_id: previous.id || null,
      carry_state: 'carried_forward'
    };
    merged.status = itemStatus(merged);
    return merged;
  });
}

function compareReviewItems(previousItems, nextItems) {
  const previous = list(previousItems);
  const merged = mergeReviewItems(previous, nextItems);
  const nextKeys = new Set(merged.map(item => text(item.stable_item_key)));
  const removed = previous
    .filter(item => !nextKeys.has(text(item.stable_item_key)))
    .map(item => ({
      stable_item_key: text(item.stable_item_key),
      behavior_ref: text(item.behavior_ref),
      behavior_name: text(item.behavior_name),
      origin_department_name: text(item.origin_department_name),
      target_department_name: text(item.target_department_name)
    }));
  const summarize = item => ({
    stable_item_key: text(item.stable_item_key),
    behavior_ref: text(item.behavior_ref),
    behavior_name: text(item.behavior_name),
    origin_department_name: text(item.origin_department_name),
    target_department_name: text(item.target_department_name)
  });
  const added = merged.filter(item => item.carry_state === 'new').map(summarize);
  const carriedForward = merged.filter(item => item.carry_state === 'carried_forward').map(summarize);
  const reopened = merged.filter(item => item.carry_state === 'reopened').map(summarize);
  const affectedDepartments = new Set();
  for (const item of [...added, ...reopened, ...removed]) {
    if (item.origin_department_name) affectedDepartments.add(item.origin_department_name);
    if (item.target_department_name) affectedDepartments.add(item.target_department_name);
  }
  return {
    counts: {
      added: added.length,
      carried_forward: carriedForward.length,
      reopened: reopened.length,
      removed: removed.length
    },
    added,
    carried_forward: carriedForward,
    reopened,
    removed,
    affected_departments: [...affectedDepartments].sort((left, right) => left.localeCompare(right))
  };
}

module.exports = {
  PARTY_STATUSES,
  V7,
  caseStatusFromItems,
  compareReviewItems,
  contentHash,
  itemStatus,
  mergeReviewItems,
  unresolvedBlockingIssues,
  validateAndProjectV7
};
