function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exportMeta(version) {
  return {
    package_ref: `package_fixture_${version.slice(-2)}`,
    exported_at: '2026-08-26T00:00:00.000Z',
    initiating_department: '财务部',
    compiler: '自动测试'
  };
}

function processProfile(version) {
  return {
    process_ref: `process_fixture_${version.slice(-2)}`,
    process_name: '费用申请测试流程',
    owning_department: '财务部',
    purpose: '验证旧版文件能够无损迁移',
    scope: '仅用于自动测试',
    capability_domain: null,
    business_capability: null,
    classification_status: 'unclassified'
  };
}

function legacyBehavior() {
  return {
    behavior_ref: 'behavior_fixture_submit',
    node_type: 'action',
    behavior_name: '申请人提交费用申请',
    behavior_description: '申请人填写费用申请并提交。',
    current_actor_role: '财务部会计员',
    trigger: '需要申请费用时',
    precondition: '',
    input_description: '费用申请资料',
    timing: null,
    completion_standard: '费用申请已经提交',
    output_description: '费用申请',
    input_data_refs: [],
    output_data_refs: ['data_fixture_application'],
    work_role: null,
    countersign_all_required: false,
    countersign_target_departments: []
  };
}

function legacyDataObject() {
  return {
    data_ref: 'data_fixture_application',
    data_name: '费用申请',
    description: '申请人提交的费用申请',
    governance_status: 'candidate',
    produced_by_behavior_ref: 'behavior_fixture_submit',
    consumed_by_behavior_refs: []
  };
}

function createLegacyFixture(version) {
  const behavior = legacyBehavior();
  if (version === 'process-governance-v1') delete behavior.behavior_description;
  return {
    schema_version: version,
    export_meta: exportMeta(version),
    process: processProfile(version),
    reference_materials: [],
    behaviors: [behavior],
    flow_relations: [],
    data_objects: [legacyDataObject()],
    cross_department_handoffs: [],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function modernBehavior() {
  const behavior = legacyBehavior();
  delete behavior.input_data_refs;
  delete behavior.output_data_refs;
  return behavior;
}

function modernDataObject() {
  return {
    data_ref: 'data_fixture_application',
    data_name: '费用申请',
    description: '申请人提交的费用申请',
    governance_status: 'candidate',
    information_type: 'business_information',
    behavior_links: [{
      link_ref: 'data_link_fixture_create',
      behavior_ref: 'behavior_fixture_submit',
      operation: 'create'
    }],
    source_relations: []
  };
}

function createModernFixture(version) {
  return {
    schema_version: version,
    export_meta: exportMeta(version),
    process: processProfile(version),
    reference_materials: [],
    behaviors: [modernBehavior()],
    flow_relations: [],
    data_objects: [modernDataObject()],
    ...(version === 'process-governance-v4' ? { cross_department_handoffs: [] } : {}),
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function createV6Fixture() {
  const version = 'process-governance-v6';
  const behavior = modernBehavior();
  delete behavior.work_role;
  Object.assign(behavior, {
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: ''
  });
  const dataObject = modernDataObject();
  delete dataObject.governance_status;
  return {
    schema_version: version,
    export_meta: exportMeta(version),
    process: processProfile(version),
    behaviors: [behavior],
    flow_relations: [],
    data_objects: [dataObject],
    forms: [],
    terms: [],
    migration: {
      source_schema_version: version,
      source_process_ref: null,
      source_process_count: 1,
      legacy_cross_department_records: [],
      reference_materials: [],
      internal_process_calls: [],
      work_roles: [],
      unresolved_actor_roles: [],
      unresolved_join_modes: []
    }
  };
}

function createProcessVersionFixture(version) {
  if (['process-governance-v1', 'process-governance-v2', 'process-governance-v3'].includes(version)) {
    return clone(createLegacyFixture(version));
  }
  if (['process-governance-v4', 'process-governance-v5'].includes(version)) {
    return clone(createModernFixture(version));
  }
  if (version === 'process-governance-v6') return clone(createV6Fixture());
  throw new Error(`不支持的测试夹具版本：${version}`);
}

module.exports = { createProcessVersionFixture };
