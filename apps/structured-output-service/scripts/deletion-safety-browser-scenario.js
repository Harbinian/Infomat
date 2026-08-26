async page => {
  const results = [];
  const baseOrigin = await page.evaluate(() => location.origin);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const stableDocument = documentValue => JSON.stringify({
    schema_version: documentValue.schema_version,
    process: documentValue.process,
    behaviors: documentValue.behaviors,
    flow_relations: documentValue.flow_relations,
    data_objects: documentValue.data_objects,
    forms: documentValue.forms,
    terms: documentValue.terms,
    migration: documentValue.migration
  });
  const pendingLifecycle = () => ({
    applicability: 'pending_confirmation',
    entry_state: {
      business_validity: 'pending_confirmation', custody: 'pending_confirmation',
      identifiability_applicability: 'pending_confirmation', identifiability: 'pending_confirmation'
    },
    routes: [],
    analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
    decision_reason: '', decision_notes: ''
  });
  const behavior = (ref, name) => ({
    behavior_ref: ref,
    node_type: 'action',
    behavior_name: name,
    behavior_description: `${name}的浏览器删除回归说明。`,
    current_actor_role: '工程技术部',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '', precondition: '', input_description: '', timing: null,
    completion_standard: `${name}已完成`, output_description: '',
    countersign_all_required: false, countersign_target_departments: []
  });

  const waitForImport = async () => page.waitForFunction(() => {
    const status = document.querySelector('#statusBox');
    const select = document.querySelector('#governanceCandidateSelect');
    return status?.classList.contains('success') && select?.options.length === 1;
  }, null, { timeout: 15000 });

  const uploadJson = async documentValue => {
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload], 'deletion-safety-v7.json', { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, JSON.stringify(documentValue));
    await waitForImport();
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-action="undo-graph"]').waitFor({ state: 'visible' });
  };

  const readDownloadJson = async download => {
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString('utf8');
    return JSON.parse(content);
  };

  const downloadCurrent = async () => {
    const button = page.locator('#governanceHeader [data-action="download-current-stage"]');
    await page.waitForFunction(() => !document.querySelector('#governanceHeader [data-action="download-current-stage"]')?.disabled);
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await button.click();
    return readDownloadJson(await downloadPromise);
  };

  const triggerSyntheticAction = async dataset => {
    await page.locator('#workspace').evaluate((workspace, values) => {
      const previous = document.getElementById('deletionSafetySyntheticAction');
      previous?.remove();
      const button = document.createElement('button');
      button.id = 'deletionSafetySyntheticAction';
      button.type = 'button';
      Object.entries(values).forEach(([key, value]) => {
        button.dataset[key] = String(value);
      });
      workspace.appendChild(button);
    }, dataset);
    await page.locator('#deletionSafetySyntheticAction').click();
  };

  const triggerWithDialog = async (dataset, disposition) => {
    let dialogType = '';
    let dialogMessage = '';
    const dialogPromise = new Promise(resolve => {
      page.once('dialog', async dialog => {
        dialogType = dialog.type();
        dialogMessage = dialog.message();
        if (disposition === 'dismiss') await dialog.dismiss();
        else await dialog.accept();
        resolve();
      });
    });
    await triggerSyntheticAction(dataset);
    await dialogPromise;
    await page.waitForTimeout(50);
    return { type: dialogType, message: dialogMessage };
  };

  const restoreWithSingleUndo = async expected => {
    const undo = page.locator('[data-action="undo-graph"]');
    assert(await undo.isEnabled(), '确认删除后没有形成可撤销记录');
    await undo.click();
    const restored = await downloadCurrent();
    assert(stableDocument(restored) === stableDocument(expected), '一次撤销没有恢复删除前的完整内容');
  };

  const runDeletionCase = async ({ name, dataset, verifyDeleted }) => {
    await uploadJson(fixture);
    const baseline = await downloadCurrent();
    const cancelledDialog = await triggerWithDialog(dataset, 'dismiss');
    assert(cancelledDialog.type === 'confirm', `${name}删除前没有显示确认框`);
    assert(cancelledDialog.message.includes('影响：') && cancelledDialog.message.includes('可撤销'), `${name}确认信息没有说明影响和撤销`);
    const afterCancel = await downloadCurrent();
    assert(stableDocument(afterCancel) === stableDocument(baseline), `取消${name}删除后JSON发生变化`);

    const confirmedDialog = await triggerWithDialog(dataset, 'accept');
    assert(confirmedDialog.type === 'confirm', `${name}确认删除没有使用同一确认入口`);
    const deleted = await downloadCurrent();
    assert(verifyDeleted(deleted), `${name}确认后没有删除指定对象，或删除范围不正确`);
    await restoreWithSingleUndo(baseline);
    results.push(`${name}：取消不改数据，确认后一次删除，一次撤销完整恢复`);
  };

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#jsonInput', { state: 'attached' });
  const templateResponse = await page.context().request.get(`${baseOrigin}/api/template?version=process-governance-v7`);
  assert(templateResponse.ok(), `无法读取v7空白模板：${templateResponse.status()}`);
  const fixture = (await templateResponse.json()).data;
  fixture.export_meta.initiating_department = '工程技术部';
  fixture.export_meta.compiler = '删除安全浏览器回归';
  fixture.process.process_name = '步骤5删除安全回归流程';
  fixture.process.owning_department = '工程技术部';
  fixture.process.purpose = '验证引用阻断、确认和一次撤销';
  fixture.process.scope = '仅用于本地自动化回归';
  fixture.behaviors = [
    behavior('behavior_delete_test', '登记删除测试数据'),
    behavior('behavior_relation_target', '复核删除测试数据'),
    behavior('behavior_delete_isolated', '可删除孤立节点')
  ];
  fixture.flow_relations = [{
    relation_ref: 'relation_delete_test', relation_type: 'sequence',
    from_behavior_ref: 'behavior_delete_test', to_behavior_ref: 'behavior_relation_target', condition: ''
  }];
  fixture.data_objects = [{
    data_ref: 'data_delete_primary', data_name: '删除测试主数据', description: '包含字段、行为关系和来源。',
    information_type: 'business_information',
    fields: [
      { field_ref: 'data_field_referenced', field_name: '被引用字段', field_type: '文本', definition: '用于引用阻断回归' },
      { field_ref: 'data_field_unreferenced', field_name: '可删除字段', field_type: '日期', definition: '用于确认和撤销回归' }
    ],
    behavior_links: [{
      link_ref: 'data_link_delete_test', behavior_ref: 'behavior_delete_test', operation: 'update',
      updated_field_refs: ['data_field_referenced']
    }],
    source_relations: [{
      source_ref: 'data_source_delete_test', source_department: '工程技术部', source_process_name: '上游测试流程',
      source_behavior_name: '形成上游数据', source_data_name: '上游测试数据', availability_mode: 'process_start',
      available_from_behavior_ref: null
    }],
    lifecycle: pendingLifecycle()
  }, {
    data_ref: 'data_delete_orphan', data_name: '可删除孤立数据', description: '没有外部引用。',
    information_type: 'business_information', fields: [], behavior_links: [], source_relations: [], lifecycle: pendingLifecycle()
  }];
  fixture.forms = [{
    form_ref: 'form_delete_test', form_name: '删除测试表单', form_no: null, form_design_state: 'current_state',
    behavior_links: [{ link_ref: 'form_link_delete_test', behavior_ref: 'behavior_delete_test', operations: ['fill'], notes: '' }],
    areas: [{
      area_ref: 'area_delete_main', area_type: '基本信息', area_title: '主表', items: [{
        item_ref: 'item_delete_main', item_name: '被引用表单字段', item_type: '文本', required: true, instructions: '',
        business_data_ref: 'data_delete_primary', data_field_ref: 'data_field_referenced',
        value_usage_mode: 'reuse_existing', value_origin_mode: 'depends_on_data',
        source_links: [{
          source_link_ref: 'field_source_delete_test', source_type: 'process_data', source_data_ref: 'data_delete_primary',
          source_system_name: '', source_data_name: '', source_role: 'provides_value'
        }]
      }]
    }, {
      area_ref: 'area_delete_detail', area_type: '明细清单', area_title: '可删除明细表', items: [{
        item_ref: 'item_delete_detail', item_name: '明细字段', item_type: '文本', required: false, instructions: '',
        business_data_ref: 'data_delete_primary', data_field_ref: 'data_field_referenced',
        value_usage_mode: 'reuse_existing', value_origin_mode: 'direct_current_process', source_links: []
      }]
    }]
  }, {
    form_ref: 'form_delete_keep', form_name: '保留表单', form_no: null, form_design_state: 'current_state', behavior_links: [],
    areas: [{ area_ref: 'area_delete_keep', area_type: '基本信息', area_title: '', items: [{
      item_ref: 'item_reference_pending', item_name: '', item_type: '', required: false, instructions: '',
      business_data_ref: 'data_delete_primary', data_field_ref: null,
      value_usage_mode: 'pending_confirmation', value_origin_mode: 'pending_confirmation', source_links: []
    }] }]
  }];
  fixture.terms = [{ term_ref: 'term_delete_test', term_name: '可删除术语', definition: '用于验证术语删除的确认和撤销。' }];

  const validation = await page.context().request.post(`${baseOrigin}/api/validate`, { data: { data: fixture } });
  const validationBody = await validation.json();
  assert(validation.ok() && validationBody.valid, `删除回归输入未通过v7校验：${JSON.stringify(validationBody.errors || validationBody)}`);

  await uploadJson(fixture);
  await page.locator('[data-action="switch-step-view"][data-view="forms"]').click();
  await page.locator('[data-action="select-form"][data-ref="form_delete_keep"]').click();
  await page.locator('[data-action="edit-field-relations"][data-ref="item_reference_pending"]').click();
  await page.locator('[data-bind="forms.1.areas.0.items.0.data_field_ref"]').selectOption('data_field_referenced');
  const guidedReference = await downloadCurrent();
  const guidedReferenceItem = guidedReference.forms[1].areas[0].items[0];
  assert(guidedReferenceItem.data_field_ref === 'data_field_referenced', '业务式编辑没有保存对象字段引用');
  assert(guidedReferenceItem.value_usage_mode === 'pending_confirmation', '业务式编辑根据引用先后静默推断了字段值使用方式');
  assert(guidedReferenceItem.value_origin_mode === 'pending_confirmation', '业务式编辑静默推断了字段取值方式');
  results.push('业务式引用对象字段只同步技术字段，权威录入和取值方式继续待确认');

  await uploadJson(fixture);
  await page.locator('[data-action="switch-data-editing-mode"][data-mode="grid"]').click();
  await page.locator('[data-action="switch-grid-workspace"][data-workspace="forms"]').click();
  await page.locator('[data-grid-panel="forms"] [data-grid-row-selector]').nth(1).click();
  await page.locator('[data-grid-panel="form_areas"] [data-grid-row-selector]').first().click();
  const gridFieldReference = page.locator('[data-grid-panel="form_items"] [data-grid-column="data_field_ref"][data-grid-cell]');
  await gridFieldReference.selectOption('data_field_referenced');
  await page.locator('[data-action="apply-web-grid"]').click();
  const gridReference = await downloadCurrent();
  const gridReferenceItem = gridReference.forms[1].areas[0].items[0];
  assert(gridReferenceItem.data_field_ref === 'data_field_referenced', '表格编辑没有保存对象字段引用');
  assert(gridReferenceItem.value_usage_mode === 'pending_confirmation', '表格编辑根据引用先后静默推断了字段值使用方式');
  assert(gridReferenceItem.value_origin_mode === 'pending_confirmation', '表格编辑静默推断了字段取值方式');
  results.push('表格引用对象字段只同步技术字段，权威录入和取值方式继续待确认');

  const lifecycleFixture = JSON.parse(JSON.stringify(fixture));
  lifecycleFixture.data_objects[0].lifecycle = {
    applicability: 'applicable',
    entry_state: {
      business_validity: 'effective', custody: 'active_custody',
      identifiability_applicability: 'not_applicable', identifiability: 'not_applicable'
    },
    routes: [{
      route_ref: 'route_delete_guard', route_label: '删除保护路径',
      flow_relation_refs: ['relation_delete_test'],
      events: [{
        event_ref: 'event_delete_guard', action: 'archive',
        trigger: { mode: 'behavior', operator: 'single', behavior_ref: 'behavior_delete_isolated', expression: '孤立节点完成后' },
        result_state: {
          business_validity: 'effective', custody: 'archived',
          identifiability_applicability: 'not_applicable', identifiability: 'not_applicable'
        },
        target_scope: 'pending_confirmation', carrier_scope: 'pending_confirmation',
        responsibility: { mode: 'pending_confirmation', department: '', position: '' },
        exception_handling: '', high_risk: false, review_status: 'pending_confirmation',
        decision_reason: '', decision_notes: '',
        provenance: {
          source_type: 'user_confirmed', source_ref: 'behavior_delete_isolated', source_path: '', basis: '',
          analyzer_version: '', source_fingerprint: ''
        }
      }],
      exit_state: {
        business_validity: 'effective', custody: 'archived',
        identifiability_applicability: 'not_applicable', identifiability: 'not_applicable'
      }
    }],
    analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
    decision_reason: '', decision_notes: ''
  };
  const lifecycleValidation = await page.context().request.post(`${baseOrigin}/api/validate`, { data: { data: lifecycleFixture } });
  const lifecycleValidationBody = await lifecycleValidation.json();
  assert(lifecycleValidation.ok() && lifecycleValidationBody.valid, `生命周期引用回归输入未通过v7校验：${JSON.stringify(lifecycleValidationBody.errors || lifecycleValidationBody)}`);
  await uploadJson(lifecycleFixture);
  const blockedLifecycleRelation = await triggerWithDialog({ action: 'remove-relation', index: 0 }, 'accept');
  assert(blockedLifecycleRelation.type === 'alert' && blockedLifecycleRelation.message.includes('生命周期路径'), '生命周期路径没有阻止删除其引用的流程关系');
  const blockedLifecycleBehavior = await triggerWithDialog({ action: 'remove-behavior', index: 2 }, 'accept');
  assert(blockedLifecycleBehavior.type === 'alert' && blockedLifecycleBehavior.message.includes('生命周期事件'), '生命周期事件没有阻止删除其触发行为');
  results.push('生命周期路径和事件引用分别阻止删除流程关系和触发行为');

  await uploadJson(fixture);
  const blockedBaseline = await downloadCurrent();
  const blocked = await triggerWithDialog({ action: 'remove-data-field', dataIndex: 0, index: 0 }, 'accept');
  assert(blocked.type === 'alert', '删除被引用对象字段时未阻断操作');
  assert(blocked.message.includes('不能删除') && blocked.message.includes('不会自动级联删除'), '引用阻断没有说明原因或禁止静默级联');
  const blockedAfter = await downloadCurrent();
  assert(stableDocument(blockedAfter) === stableDocument(blockedBaseline), '引用阻断后JSON发生变化');
  results.push('被数据更新关系和表单引用的对象字段无法删除，且没有级联变更');

  await runDeletionCase({
    name: '对象字段', dataset: { action: 'remove-data-field', dataIndex: 0, index: 1 },
    verifyDeleted: documentValue => documentValue.data_objects[0].fields.length === 1
  });
  await runDeletionCase({
    name: '数据行为关系', dataset: { action: 'delete-graph-data-edge', dataRef: 'data_delete_primary', behaviorRef: 'behavior_delete_test' },
    verifyDeleted: documentValue => documentValue.data_objects[0].behavior_links.length === 0
  });
  await runDeletionCase({
    name: '数据来源', dataset: { action: 'remove-data-source', dataIndex: 0, index: 0 },
    verifyDeleted: documentValue => documentValue.data_objects[0].source_relations.length === 0
  });
  await runDeletionCase({
    name: '表单行为关系', dataset: { action: 'remove-form-behavior-link', formIndex: 0, index: 0 },
    verifyDeleted: documentValue => documentValue.forms[0].behavior_links.length === 0
  });
  await runDeletionCase({
    name: '字段取值来源', dataset: { action: 'remove-field-source', formIndex: 0, areaIndex: 0, itemIndex: 0, index: 0 },
    verifyDeleted: documentValue => documentValue.forms[0].areas[0].items[0].source_links.length === 0
  });
  await runDeletionCase({
    name: '表单字段', dataset: { action: 'remove-form-item', formIndex: 0, areaIndex: 0, index: 0 },
    verifyDeleted: documentValue => documentValue.forms[0].areas[0].items.length === 0
  });
  await runDeletionCase({
    name: '明细表', dataset: { action: 'remove-detail-area', formIndex: 0, index: 1 },
    verifyDeleted: documentValue => documentValue.forms[0].areas.length === 1
  });
  await runDeletionCase({
    name: '表单或记录', dataset: { action: 'remove-form', index: 0 },
    verifyDeleted: documentValue => documentValue.forms.length === 1 && documentValue.forms[0].form_ref === 'form_delete_keep'
  });
  await runDeletionCase({
    name: '数据对象', dataset: { action: 'remove-data', index: 1 },
    verifyDeleted: documentValue => documentValue.data_objects.length === 1 && documentValue.data_objects[0].data_ref === 'data_delete_primary'
  });
  await runDeletionCase({
    name: '流程关系', dataset: { action: 'remove-relation', index: 0 },
    verifyDeleted: documentValue => documentValue.flow_relations.length === 0
  });
  await runDeletionCase({
    name: '孤立节点', dataset: { action: 'remove-behavior', index: 2 },
    verifyDeleted: documentValue => documentValue.behaviors.length === 2
      && !documentValue.behaviors.some(item => item.behavior_ref === 'behavior_delete_isolated')
  });
  await runDeletionCase({
    name: '术语', dataset: { action: 'remove-term', index: 0 },
    verifyDeleted: documentValue => documentValue.terms.length === 0
  });

  return { passed: true, checks: results };
}
