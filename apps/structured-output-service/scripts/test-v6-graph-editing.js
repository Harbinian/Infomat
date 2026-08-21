const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const Ajv2020 = require('ajv/dist/2020');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const Migration = require(path.join(appRoot, 'public', 'process-governance-migration.js'));
const LegacyDiagnostics = require(path.join(appRoot, 'public', 'legacy-cross-department-diagnostics.js'));
const Commands = require(path.join(appRoot, 'public', 'graph-edit-commands.js'));
const EditorState = require(path.join(appRoot, 'public', 'graph-editor-state.js'));
const DataDiagram = require(path.join(appRoot, 'public', 'data-relation-diagram.js'));
const ProcessDiagram = require(path.join(appRoot, 'public', 'process-diagram.js'));

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'contracts', name), 'utf8'));
}

const v1Schema = readSchema('process-governance-v1.schema.json');
const v2Schema = readSchema('process-governance-v2.schema.json');
const v3Schema = readSchema('process-governance-v3.schema.json');
const v4Schema = readSchema('process-governance-v4.schema.json');
const v5Schema = readSchema('process-governance-v5.schema.json');
const v6Schema = readSchema('process-governance-v6.schema.json');
const v7Schema = readSchema('process-governance-v7.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(v1Schema);
ajv.addSchema(v2Schema);
ajv.addSchema(v3Schema);
ajv.addSchema(v4Schema);
ajv.addSchema(v5Schema);
ajv.addSchema(v6Schema);
const validateV7 = ajv.compile(v7Schema);

function behavior(ref, name, actor = '财务部会计员', nodeType = 'action') {
  return {
    behavior_ref: ref,
    node_type: nodeType,
    behavior_name: name,
    behavior_description: `${name}人员核对资料并记录处理结果。`,
    current_actor_role: actor,
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '',
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: '处理结果已记录',
    output_description: '',
    work_role: null,
    countersign_all_required: false,
    countersign_target_departments: []
  };
}

function v5Fixture(version = 'process-governance-v5') {
  const result = {
    schema_version: version,
    export_meta: {
      package_ref: 'package-v6-test',
      exported_at: '2026-08-18T00:00:00.000Z',
      initiating_department: '财务部',
      compiler: '测试编制人'
    },
    process: {
      process_ref: 'process-v6-test',
      process_name: '费用处理流程',
      owning_department: '财务部',
      purpose: '验证v6迁移',
      scope: '测试范围',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    reference_materials: [],
    behaviors: [behavior('behavior-apply', '提交申请'), behavior('behavior-review', '审核申请')],
    flow_relations: [{
      relation_ref: 'relation-apply-review',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-apply',
      to_behavior_ref: 'behavior-review',
      condition: '',
      join_mode: ''
    }],
    data_objects: [{
      data_ref: 'data-application',
      data_name: '费用申请',
      description: '申请信息',
      governance_status: 'candidate',
      information_type: 'business_information',
      behavior_links: [
        { link_ref: 'link-create', behavior_ref: 'behavior-apply', operation: 'create' },
        { link_ref: 'link-use', behavior_ref: 'behavior-review', operation: 'use' }
      ],
      source_relations: []
    }],
    internal_process_calls: [],
    forms: [{
      form_ref: 'form-application',
      form_name: '费用申请单',
      form_no: null,
      form_design_state: 'current_state',
      behavior_links: [{ link_ref: 'form-link', behavior_ref: 'behavior-apply', operations: ['fill'], notes: '' }],
      areas: [{
        area_ref: 'area-main',
        area_type: '基本信息',
        area_title: '',
        items: [{
          item_ref: 'item-amount',
          item_name: '金额',
          item_type: '金额',
          required: true,
          instructions: '',
          business_data_ref: 'data-application',
          value_origin_mode: 'depends_on_data',
          source_links: [{
            source_link_ref: 'source-amount',
            source_data_ref: 'data-application',
            source_role: 'provides_value'
          }]
        }]
      }]
    }],
    terms: []
  };
  if (version === 'process-governance-v4') return result;
  return result;
}

function assertV7(documentValue, message = 'v7 document should validate') {
  const valid = validateV7(documentValue);
  assert.equal(valid, true, `${message}: ${JSON.stringify(validateV7.errors)}`);
}

function legacyCrossDepartmentFixture() {
  const source = v5Fixture('process-governance-v3');
  source.process.owning_department = '项目管理部';
  source.export_meta.initiating_department = '项目管理部';
  source.behaviors.push(
    behavior('behavior-send-plan', '下发文件、排产计划', '项目管理部项目助理'),
    behavior('behavior-start-work', '车间开始制造', '复材车间班长'),
    behavior('behavior-delivery', '零件交付完成', '复材车间班长')
  );
  source.flow_relations.push(
    {
      relation_ref: 'relation-plan-work',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-send-plan',
      to_behavior_ref: 'behavior-start-work',
      condition: '',
      join_mode: ''
    },
    {
      relation_ref: 'relation-work-delivery',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior-start-work',
      to_behavior_ref: 'behavior-delivery',
      condition: '',
      join_mode: ''
    }
  );
  source.cross_department_handoffs = [
    {
      handoff_ref: 'handoff-work',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: 'behavior-send-plan',
      counterparty_resolution: 'identified',
      source_department: '项目管理部',
      target_department: '复材车间',
      transfer_data_ref: null,
      requested_matter: '文件以及对应排产计划',
      trigger_condition: '“下发文件、排产计划”完成后，系统生成跨部门待办',
      completion_standard: '',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: 'behavior-start-work',
      counterparty_behavior_name: '',
      requires_return: false,
      returned_data_ref: null,
      resume_behavior_ref: null
    },
    {
      handoff_ref: 'handoff-delivery',
      handoff_direction: 'outbound_followup',
      anchor_behavior_ref: null,
      counterparty_resolution: 'identified',
      source_department: '项目管理部',
      target_department: '复材车间',
      transfer_data_ref: null,
      requested_matter: '',
      trigger_condition: '“下发文件、排产计划”完成后，系统生成跨部门待办',
      completion_standard: '',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: 'behavior-delivery',
      counterparty_behavior_name: '',
      requires_return: false,
      returned_data_ref: null,
      resume_behavior_ref: null
    }
  ];
  return Migration.migrateDocument(source)[0];
}

function testLegacyCrossDepartmentDiagnostics() {
  const documentValue = legacyCrossDepartmentFixture();
  const snapshot = JSON.stringify(documentValue);
  const diagnostics = LegacyDiagnostics.diagnose(documentValue);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].recordIndex, 1);
  assert.ok(diagnostics[0].relatedBehaviorRefs.includes('behavior-delivery'));
  const conflict = diagnostics[0].issues.find(item => item.kind === 'flow_position_conflict');
  assert.ok(conflict);
  assert.equal(
    conflict.message,
    '旧版跨部门记录2对应复材车间的“零件交付完成”行为，交接方向为项目管理部发出、复材车间承接。旧记录的触发说明指向“下发文件、排产计划”之后，现有流程关系则为“车间开始制造” → “零件交付完成”，两个衔接位置不一致。请确认实际衔接位置。'
  );
  assert.equal(conflict.focusKind, 'relation');
  assert.equal(conflict.focusRef, 'relation-work-delivery');
  assert.match(conflict.suggestions[0], /无需新增流程关系/);
  assert.equal(JSON.stringify(documentValue), snapshot, 'legacy diagnostics must not change the document');

  const consistentDocument = JSON.parse(snapshot);
  consistentDocument.migration.legacy_cross_department_records[1].source_handoff.trigger_condition = '“车间开始制造”完成后，系统生成跨部门待办';
  const consistent = LegacyDiagnostics.diagnose(consistentDocument)[0].issues.find(item => item.kind === 'flow_position_consistent');
  assert.ok(consistent);
  assert.match(consistent.message, /都指向“车间开始制造”之后/);
  assert.match(consistent.suggestions[0], /无需新增流程关系/);

  const unparsedDocument = JSON.parse(snapshot);
  unparsedDocument.migration.legacy_cross_department_records[1].source_handoff.trigger_condition = '收到实物后办理';
  const single = LegacyDiagnostics.diagnose(unparsedDocument)[0].issues.find(item => item.kind === 'single_current_relation');
  assert.ok(single);
  assert.match(single.message, /旧记录的触发说明为“收到实物后办理”/);
  assert.match(single.message, /“车间开始制造” → “零件交付完成”/);

  const multipleDocument = JSON.parse(snapshot);
  multipleDocument.flow_relations.push({
    relation_ref: 'relation-plan-delivery', relation_type: 'sequence',
    from_behavior_ref: 'behavior-send-plan', to_behavior_ref: 'behavior-delivery', condition: ''
  });
  const multiple = LegacyDiagnostics.diagnose(multipleDocument)[0].issues.find(item => item.kind === 'multiple_current_relations');
  assert.ok(multiple);
  assert.match(multiple.message, /当前有2条相关流程关系/);
  assert.equal(multiple.focusPaths.length, 4);

  const missingRelationDocument = JSON.parse(snapshot);
  missingRelationDocument.flow_relations = missingRelationDocument.flow_relations.filter(item => item.to_behavior_ref !== 'behavior-delivery');
  const missingRelation = LegacyDiagnostics.diagnose(missingRelationDocument)[0].issues.find(item => item.kind === 'missing_current_relation');
  assert.ok(missingRelation);
  assert.match(missingRelation.message, /没有找到与“零件交付完成”相连的普通流程关系/);

  const missingBehaviorDocument = JSON.parse(snapshot);
  missingBehaviorDocument.behaviors = missingBehaviorDocument.behaviors.filter(item => item.behavior_ref !== 'behavior-delivery');
  missingBehaviorDocument.flow_relations = missingBehaviorDocument.flow_relations.filter(item =>
    item.from_behavior_ref !== 'behavior-delivery' && item.to_behavior_ref !== 'behavior-delivery'
  );
  const missingBehavior = LegacyDiagnostics.diagnose(missingBehaviorDocument)[0].issues.find(item => item.kind === 'missing_external_behavior');
  assert.ok(missingBehavior);
  assert.match(missingBehavior.message, /当前流程中没有找到对应的可编辑业务行为/);

  const dataDocument = JSON.parse(snapshot);
  dataDocument.migration.legacy_cross_department_records[1].source_handoff.transfer_data_ref = 'data-application';
  dataDocument.migration.legacy_cross_department_records[1].created_data_link_refs = [];
  const dataIssue = LegacyDiagnostics.diagnose(dataDocument)[0].issues.find(item => item.kind === 'missing_data_relation');
  assert.ok(dataIssue);
  assert.match(dataIssue.message, /“费用申请”作为本流程交给零件交付完成使用的数据/);
  assert.equal(dataIssue.focusRef, 'data-application');

  const inboundDocument = JSON.parse(snapshot);
  const inboundRecord = inboundDocument.migration.legacy_cross_department_records[1];
  inboundRecord.source_handoff.handoff_direction = 'inbound_prerequisite';
  inboundRecord.source_handoff.source_department = '复材车间';
  inboundRecord.source_handoff.target_department = '项目管理部';
  inboundRecord.source_handoff.trigger_condition = '“下发文件、排产计划”开始前';
  inboundDocument.flow_relations = inboundDocument.flow_relations.filter(item => item.to_behavior_ref !== 'behavior-delivery');
  inboundDocument.flow_relations.push({
    relation_ref: 'relation-delivery-plan', relation_type: 'sequence',
    from_behavior_ref: 'behavior-delivery', to_behavior_ref: 'behavior-send-plan', condition: ''
  });
  const inbound = LegacyDiagnostics.diagnose(inboundDocument)[0].issues.find(item => item.kind === 'flow_position_consistent');
  assert.ok(inbound);
  assert.match(inbound.message, /交接方向为复材车间提供、项目管理部接收/);
}

function testMigration() {
  for (const version of ['process-governance-v1', 'process-governance-v2', 'process-governance-v3', 'process-governance-v4', 'process-governance-v5']) {
    const source = v5Fixture(version);
    if (!['process-governance-v4', 'process-governance-v5'].includes(version)) {
      source.data_objects = [{
        data_ref: 'data-application', data_name: '费用申请', description: '申请信息', governance_status: 'candidate',
        produced_by_behavior_ref: 'behavior-apply', consumed_by_behavior_refs: ['behavior-review']
      }];
      source.forms = source.forms.map(form => ({
        form_ref: form.form_ref,
        behavior_ref: 'behavior-apply',
        form_name: form.form_name,
        form_no: null,
        ...(version === 'process-governance-v3' ? { form_design_state: 'current_state' } : {}),
        areas: form.areas.map(area => ({
          area_ref: area.area_ref,
          area_type: area.area_type,
          area_title: area.area_title,
          items: area.items.map(item => ({
            item_ref: item.item_ref,
            item_name: item.item_name,
            item_type: item.item_type,
            required: item.required,
            instructions: item.instructions
          }))
        }))
      }));
    }
    const snapshot = JSON.stringify(source);
    const migrated = Migration.migrateDocument(source)[0];
    assert.equal(JSON.stringify(source), snapshot, `${version} source must not change`);
    assert.equal(migrated.schema_version, 'process-governance-v7');
    assert.equal(migrated.migration.source_schema_version, version);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated, 'reference_materials'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated.data_objects[0], 'governance_status'), false);
    assert.equal(migrated.forms[0].areas[0].items[0].source_links[0]?.source_type || 'process_data', 'process_data');
    assertV7(migrated, `${version} migration`);
    assert.deepEqual(Migration.migrateDocument(migrated)[0], migrated, `${version} repeated migration must be identical`);
  }

  const publicSamplePath = path.join(repoRoot, 'docs', 'samples', '3001-data-form-relationship-sample-v4.json');
  const publicSampleBytes = fs.readFileSync(publicSamplePath);
  const publicSampleHash = crypto.createHash('sha256').update(publicSampleBytes).digest('hex');
  const publicSample = JSON.parse(publicSampleBytes.toString('utf8'));
  const publicSampleSnapshot = JSON.stringify(publicSample);
  const migratedPublicSample = Migration.migrateDocument(publicSample)[0];
  assert.equal(JSON.stringify(publicSample), publicSampleSnapshot, 'the fixed public v4 sample must remain unchanged');
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(publicSamplePath)).digest('hex'),
    publicSampleHash,
    'migrating the fixed public v4 sample must not modify its source file'
  );
  assertV7(migratedPublicSample, 'fixed public v4 sample migration');
  assert.deepEqual(
    Migration.migrateDocument(JSON.parse(JSON.stringify(migratedPublicSample)))[0],
    migratedPublicSample,
    'the fixed public v4 sample must remain identical after v7 download and re-import simulation'
  );
  assert.deepEqual(
    Migration.migrateDocument(publicSample)[0],
    migratedPublicSample,
    'repeated fixed public v4 sample migration must be deterministic'
  );

  const special = v5Fixture();
  special.behaviors[0].work_role = {
    behavior_ref: 'behavior-apply', work_role_code: null, role_duty: '发起',
    work_role_name: '提交申请行为的发起角色', assignment_status: 'pending_assignment'
  };
  special.behaviors[1].current_actor_role = '无法识别的固定角色';
  special.flow_relations[0].join_mode = 'all';
  special.reference_materials.push({
    material_ref: 'material-history', material_type: '现有制度', material_name: '历史制度', document_no: null,
    version: null, file_sha256: null, readable_text: '', provider_department: '财务部', provider_name: '', as_of_date: null
  });
  const migrated = Migration.migrateDocument(special)[0];
  assert.equal(migrated.migration.work_roles[0].original_behavior_name, '提交申请');
  assert.equal(migrated.behaviors[0].work_role, undefined);
  assert.equal(migrated.behaviors[1].current_actor_role, '');
  assert.equal(migrated.migration.unresolved_actor_roles[0].raw_actor_role, '无法识别的固定角色');
  assert.equal(migrated.migration.unresolved_join_modes[0].relation_ref, 'relation-apply-review');
  assert.equal(migrated.migration.reference_materials[0].material_ref, 'material-history');
  assertV7(migrated, 'archive migration');

  const parallelJoin = v5Fixture();
  parallelJoin.behaviors[1].node_type = 'parallel_join';
  parallelJoin.flow_relations[0].join_mode = 'all';
  assert.equal(Migration.migrateDocument(parallelJoin)[0].migration.unresolved_join_modes.length, 0);

  const legacy = {
    schema_version: 'document-structured-output-v2',
    generated_at: '2026-08-18T00:00:00.000Z',
    draft: { draft_ref: 'draft-legacy', process_name: '', department: { department_name: '财务部' } },
    document_profile: { document_title: '历史流程', document_no: '', purpose: '', scope: '' },
    processes: [
      { process_ref: 'legacy-one', l1_name: '', l2_name: '', l3_name: '历史流程一' },
      { process_ref: 'legacy-two', l1_name: '', l2_name: '', l3_name: '历史流程二' }
    ],
    steps: [
      { step_ref: 'step-one', process_ref: 'legacy-one', step_name: '办理一', step_type: 'action', actor_role: '财务部会计员' },
      { step_ref: 'step-two', process_ref: 'legacy-two', step_name: '办理二', step_type: 'action', actor_role: '财务部会计员' }
    ],
    behavior_details: [], step_transitions: [], cross_dept_handoffs: [], forms: [], form_tables: [], form_table_fields: [],
    work_role_bindings: [], mdm_requirement_catalog: [], terms: [], markdown_draft: ''
  };
  const candidates = Migration.migrateDocument(legacy);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(item => item.process.process_name), ['历史流程一', '历史流程二']);
  candidates.forEach(item => {
    assert.equal(item.migration.source_process_count, 2);
    assertV7(item, 'legacy multi candidate');
  });

  assert.throws(() => Migration.migrateDocument(v5Fixture(), { validateSource: () => ({ valid: false, errors: [{ message: '固定失败' }] }) }), /固定失败/);
  assert.throws(() => Migration.migrateDocument(v5Fixture(), { validateTarget: () => ({ valid: false, errors: [{ message: '目标失败' }] }) }), /目标失败/);
}

function testCommandsAndState() {
  const documentValue = Migration.migrateDocument(v5Fixture())[0];
  const sourceSnapshot = JSON.stringify(documentValue);
  const selfLoop = Commands.applyCommand(documentValue, {
    type: 'upsert_flow_relation',
    relation: { relation_ref: 'relation-self', relation_type: 'sequence', from_behavior_ref: 'behavior-apply', to_behavior_ref: 'behavior-apply', condition: '' }
  });
  assert.equal(selfLoop.ok, false);
  assert.match(selfLoop.message, /起点和终点相同/);
  assert.equal(JSON.stringify(documentValue), sourceSnapshot);

  const oneToMany = Commands.applyCommand(documentValue, {
    type: 'add_behavior',
    behavior: { ...documentValue.behaviors[1], behavior_ref: 'behavior-archive', behavior_name: '归档申请' }
  });
  assert.equal(oneToMany.ok, true);
  const relationAdded = Commands.applyCommand(oneToMany.document, {
    type: 'upsert_flow_relation',
    relation: { relation_ref: 'relation-apply-archive', relation_type: 'sequence', from_behavior_ref: 'behavior-apply', to_behavior_ref: 'behavior-archive', condition: '' }
  });
  assert.equal(relationAdded.ok, true, 'one-to-many is represented by two independent relations');

  const pendingConflict = Commands.applyCommand(documentValue, {
    type: 'set_data_operations', dataRef: 'data-application', behaviorRef: 'behavior-review',
    operations: ['pending_confirmation', 'use'], refFactory: operation => `link-${operation}`
  });
  assert.equal(pendingConflict.ok, false);

  const deletion = Commands.analyzeDeletion(documentValue, 'behavior', 'behavior-apply');
  assert.ok(deletion.some(item => item.kind === 'flow_relation'));
  assert.ok(deletion.some(item => item.kind === 'data_relation'));
  assert.equal(Commands.deleteObject(documentValue, 'behavior', 'behavior-apply').code, 'DELETE_BLOCKED');

  const duplicateData = clone(documentValue);
  duplicateData.data_objects.push({
    ...clone(duplicateData.data_objects[0]),
    data_ref: 'data-application-duplicate',
    description: '另一段说明',
    behavior_links: [{ link_ref: 'link-update', behavior_ref: 'behavior-review', operation: 'update' }],
    source_relations: []
  });
  const preview = Commands.mergePreview(duplicateData, 'data-application', ['data-application-duplicate']);
  assert.equal(preview.ok, true);
  assert.equal(preview.details.valueConflicts[0].field, 'description');
  const merged = Commands.mergeDataObjects(duplicateData, 'data-application', ['data-application-duplicate'], { description: 'keep' });
  assert.equal(merged.ok, true);
  assert.equal(merged.document.data_objects.length, 1);
  assert.ok(merged.document.data_objects[0].behavior_links.some(link => link.link_ref === 'link-update'));

  const state = EditorState.createManager({ limit: 20 });
  state.register('candidate-1', documentValue);
  const commandResult = state.execute('candidate-1', documentValue, draft => Commands.applyCommand(draft, {
    type: 'add_behavior', behavior: { ...draft.behaviors[0], behavior_ref: 'behavior-third', behavior_name: '第三行为' }
  }));
  assert.equal(commandResult.ok, true);
  assert.equal(commandResult.state.canUndo, true);
  const undone = state.undo('candidate-1', commandResult.document);
  assert.equal(undone.document.behaviors.length, documentValue.behaviors.length);
  const redone = state.redo('candidate-1', undone.document);
  assert.equal(redone.document.behaviors.length, documentValue.behaviors.length + 1);
  assert.equal(state.isDirty('candidate-1', redone.document), true);
  state.markBaseline('candidate-1', redone.document);
  assert.equal(state.isDirty('candidate-1', redone.document), false);
  assert.equal(state.snapshot('candidate-2', documentValue).canUndo, false, 'candidate histories are isolated');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function medianDuration(run, samples = 3) {
  run();
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    run();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.floor(durations.length / 2)];
}

function testDiagramModelsAndPerformance() {
  const documentValue = Migration.migrateDocument(v5Fixture())[0];
  const useOnlyModel = DataDiagram.buildModel(documentValue, 'data-application');
  const useOnlyDataNode = useOnlyModel.nodes.find(node => node.data.kind === 'data');
  const useOnlyBehaviorNode = useOnlyModel.nodes.find(node => node.data.ref === 'behavior-review');
  assert.ok(useOnlyBehaviorNode.position.x > useOnlyDataNode.position.x, 'a use-only behavior must be right of the data object');
  documentValue.data_objects[0].behavior_links.push({ link_ref: 'link-update', behavior_ref: 'behavior-review', operation: 'update' });
  const dataModel = DataDiagram.buildModel(documentValue, 'data-application');
  assert.equal(dataModel.edges.length, 2);
  const reviewEdge = dataModel.edges.find(edge => edge.data.behaviorRef === 'behavior-review');
  assert.equal(reviewEdge.data.arrowMode, 'both');
  assert.match(reviewEdge.data.label, /更新/);
  assert.match(reviewEdge.data.label, /使用/);
  const dataNode = dataModel.nodes.find(node => node.data.kind === 'data');
  const createBehaviorNode = dataModel.nodes.find(node => node.data.ref === 'behavior-apply');
  const useBehaviorNode = dataModel.nodes.find(node => node.data.ref === 'behavior-review');
  assert.ok(createBehaviorNode.position.x < dataNode.position.x, 'a behavior that creates data must be left of the data object');
  assert.ok(useBehaviorNode.position.x > dataNode.position.x, 'a mixed-operation behavior that uses data must be right of the data object');

  const fanOutDocument = clone(documentValue);
  fanOutDocument.behaviors.push(
    behavior('behavior-use-second', '整理未完成事项'),
    behavior('behavior-use-third', '整理月度绩效')
  );
  fanOutDocument.data_objects[0].behavior_links.push(
    { link_ref: 'link-use-second', behavior_ref: 'behavior-use-second', operation: 'use' },
    { link_ref: 'link-use-third', behavior_ref: 'behavior-use-third', operation: 'use' }
  );
  const fanOutModel = DataDiagram.buildModel(fanOutDocument, 'data-application');
  const useFanOutEdges = fanOutModel.edges.filter(edge => edge.data.operations.includes('use'));
  assert.equal(useFanOutEdges.length, 3);
  assert.ok(useFanOutEdges.every(edge => edge.data.curveStyle === 'straight'), 'one-to-many use edges must fan out directly instead of sharing a taxi turn through sibling nodes');
  const badgeModel = ProcessDiagram.buildGraphModel(documentValue);
  assert.ok(badgeModel.nodes.some(node => node.classes?.includes('data-aggregate-badge')), 'behavior data badge should be present');

  const representative = clone(documentValue);
  representative.behaviors = Array.from({ length: 40 }, (_, index) => ({
    ...clone(documentValue.behaviors[0]),
    behavior_ref: `behavior-perf-${index + 1}`,
    behavior_name: `包含较长名称的代表性业务行为${index + 1}`,
    current_actor_role: index % 5 === 0 ? '' : ['财务部会计员', '质量管理部检验员', '工程技术部研发员'][index % 3],
    node_type: index % 11 === 4 ? 'decision' : index % 13 === 6 ? 'parallel_split' : index % 13 === 9 ? 'parallel_join' : 'action'
  }));
  representative.flow_relations = [];
  for (let index = 0; index < 39; index += 1) {
    representative.flow_relations.push({
      relation_ref: `relation-perf-${index + 1}`,
      relation_type: 'sequence',
      from_behavior_ref: `behavior-perf-${index + 1}`,
      to_behavior_ref: `behavior-perf-${index + 2}`,
      condition: index % 7 === 0 ? '资料已经完成核对并形成明确处理结果' : ''
    });
  }
  for (let index = 0; index < 39; index += 1) {
    representative.flow_relations.push({
      relation_ref: `relation-perf-branch-${index + 1}`,
      relation_type: index % 4 === 0 ? 'loop' : 'condition',
      from_behavior_ref: `behavior-perf-${Math.min(40, index + 2)}`,
      to_behavior_ref: `behavior-perf-${index % 4 === 0 ? Math.max(1, index - 2) : Math.min(40, index + 3)}`,
      condition: `代表性条件${index + 1}`
    });
  }
  representative.flow_relations.push({
    relation_ref: 'relation-perf-final', relation_type: 'sequence',
    from_behavior_ref: 'behavior-perf-1', to_behavior_ref: 'behavior-perf-40', condition: ''
  });
  representative.flow_relations.push({
    relation_ref: 'relation-perf-final-2', relation_type: 'parallel',
    from_behavior_ref: 'behavior-perf-2', to_behavior_ref: 'behavior-perf-38', condition: ''
  });
  const start = performance.now();
  const model = ProcessDiagram.buildGraphModel(representative);
  const duration = performance.now() - start;
  assert.equal(model.layout.collisions.length, 0, `representative layout collisions: ${model.layout.collisions.join(', ')}`);
  assert.ok(model.layout.iterations <= 6);
  assert.ok(duration < 2000, `representative layout took ${duration.toFixed(1)}ms`);
  assert.ok(model.lanes[0].key === '__process_control__', 'control nodes use the top process-control band');

  representative.data_objects = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    const creatorIndex = (index * 2) % 40 + 1;
    const consumerIndex = (index * 2 + 1) % 40 + 1;
    return {
      data_ref: `data-perf-${number}`,
      data_name: number <= 2 ? '可归并的同名数据' : `代表性数据对象${number}`,
      description: `数据对象${number}说明`,
      information_type: 'business_information',
      behavior_links: [
        { link_ref: `data-link-${number}-create`, behavior_ref: `behavior-perf-${creatorIndex}`, operation: 'create' },
        { link_ref: `data-link-${number}-creator-update`, behavior_ref: `behavior-perf-${creatorIndex}`, operation: 'update' },
        { link_ref: `data-link-${number}-consumer-update`, behavior_ref: `behavior-perf-${consumerIndex}`, operation: 'update' },
        { link_ref: `data-link-${number}-use`, behavior_ref: `behavior-perf-${consumerIndex}`, operation: 'use' }
      ],
      source_relations: [],
      lifecycle: Migration.pendingLifecycle()
    };
  });
  representative.data_objects[1].behavior_links[0].behavior_ref = representative.data_objects[0].behavior_links[0].behavior_ref;
  representative.data_objects[1].behavior_links[1].behavior_ref = representative.data_objects[0].behavior_links[0].behavior_ref;
  representative.forms = Array.from({ length: 10 }, (_, formIndex) => ({
    form_ref: `form-perf-${formIndex + 1}`,
    form_name: `代表性表单${formIndex + 1}`,
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [{
      link_ref: `form-perf-link-${formIndex + 1}`,
      behavior_ref: `behavior-perf-${formIndex + 1}`,
      operations: ['fill'],
      notes: ''
    }],
    areas: [{
      area_ref: `form-perf-area-${formIndex + 1}`,
      area_type: '基本信息',
      area_title: '',
      items: Array.from({ length: 20 }, (_, fieldIndex) => {
        const fieldNumber = formIndex * 20 + fieldIndex + 1;
        const dataNumber = fieldNumber % 2 === 0 ? 2 : (fieldNumber % 30) + 1;
        return {
          item_ref: `field-perf-${fieldNumber}`,
          item_name: `代表性字段${fieldNumber}`,
          item_type: '文本',
          required: fieldNumber % 3 === 0,
          instructions: '',
          business_data_ref: `data-perf-${dataNumber}`,
          value_origin_mode: 'depends_on_data',
          source_links: [{
            source_link_ref: `field-source-perf-${fieldNumber}`,
            source_type: 'process_data',
            source_data_ref: `data-perf-${dataNumber}`,
            source_system_name: '',
            source_data_name: '',
            source_role: 'provides_value'
          }]
        };
      })
    }]
  }));

  assert.equal(representative.flow_relations.length, 80);
  assert.equal(representative.data_objects.length, 30);
  assert.equal(representative.data_objects.flatMap(data => data.behavior_links).length, 120);
  assert.equal(representative.forms.length, 10);
  assert.equal(representative.forms.flatMap(form => form.areas.flatMap(area => area.items)).length, 200);
  const visibleDataEdges = representative.data_objects.reduce(
    (count, data) => count + DataDiagram.buildModel(representative, data.data_ref).edges.length,
    0
  );
  assert.ok(visibleDataEdges >= 60, `expected at least 60 visible data edges, received ${visibleDataEdges}`);

  const flowDisplayMedian = medianDuration(() => ProcessDiagram.buildGraphModel(representative));
  const modeSwitchMedian = medianDuration(() => {
    ProcessDiagram.buildGraphModel(representative);
    DataDiagram.buildModel(representative, 'data-perf-1');
  });
  const graphCommandMedian = medianDuration(() => {
    const draft = clone(representative);
    const result = Commands.applyCommand(draft, {
      type: 'add_behavior',
      behavior: { ...clone(draft.behaviors[0]), behavior_ref: 'behavior-command-perf', behavior_name: '性能命令节点' }
    });
    assert.equal(result.ok, true);
  });
  const mergeMedian = medianDuration(() => {
    const mergeDocument = clone(representative);
    const result = Commands.mergeDataObjects(mergeDocument, 'data-perf-1', ['data-perf-2'], { description: 'keep' });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.document.data_objects.length, 29);
  });
  const roundTripMedian = medianDuration(() => {
    const serialized = JSON.stringify(representative);
    const reparsed = JSON.parse(serialized);
    const migrated = Migration.migrateDocument(reparsed)[0];
    assertV7(migrated, 'performance round trip');
  });

  assert.ok(flowDisplayMedian < 2000, `flow display median ${flowDisplayMedian.toFixed(1)}ms`);
  assert.ok(modeSwitchMedian < 2000, `mode switch median ${modeSwitchMedian.toFixed(1)}ms`);
  assert.ok(graphCommandMedian < 1000, `graph command median ${graphCommandMedian.toFixed(1)}ms`);
  assert.ok(mergeMedian < 2000, `200-field merge median ${mergeMedian.toFixed(1)}ms`);
  assert.ok(roundTripMedian < 3000, `round trip median ${roundTripMedian.toFixed(1)}ms`);
  console.log(
    `v7 performance medians: flow=${flowDisplayMedian.toFixed(1)}ms, switch=${modeSwitchMedian.toFixed(1)}ms, ` +
    `command=${graphCommandMedian.toFixed(1)}ms, merge=${mergeMedian.toFixed(1)}ms, roundtrip=${roundTripMedian.toFixed(1)}ms`
  );
}

function main() {
  testMigration();
  testLegacyCrossDepartmentDiagnostics();
  testCommandsAndState();
  testDiagramModelsAndPerformance();
  console.log('structured-output-service v7 graph editing regression tests passed');
}

main();
