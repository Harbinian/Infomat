async page => {
  const checks = [];
  const baseOrigin = await page.evaluate(() => location.origin);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const record = message => checks.push(message);
  const pendingLifecycle = () => ({
    applicability: 'pending_confirmation',
    entry_state: {
      business_validity: 'pending_confirmation',
      custody: 'pending_confirmation',
      identifiability_applicability: 'pending_confirmation',
      identifiability: 'pending_confirmation'
    },
    routes: [],
    analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
    decision_reason: '',
    decision_notes: ''
  });
  const behavior = (ref, name, description, completion) => ({
    behavior_ref: ref,
    node_type: 'action',
    behavior_name: name,
    behavior_description: description,
    current_actor_role: '财务部会计员',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: '收到费用事项时',
    precondition: '',
    input_description: '费用事项资料',
    timing: null,
    completion_standard: completion,
    output_description: '费用处理结果',
    countersign_all_required: true,
    countersign_target_departments: ['质量管理部']
  });

  const waitForImport = async () => {
    await page.waitForFunction(() => {
      const status = document.querySelector('#statusBox');
      return status?.classList.contains('success') && document.querySelector('#governanceCandidateSelect');
    }, null, { timeout: 15000 });
  };
  const uploadJson = async (name, documentValue) => {
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.text], payload.name, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name, text: JSON.stringify(documentValue) });
    await waitForImport();
  };
  const validateDocument = async documentValue => {
    const response = await page.context().request.post(`${baseOrigin}/api/validate`, {
      data: { data: documentValue }
    });
    const result = await response.json();
    assert(response.ok(), `验证接口返回${response.status()}：${JSON.stringify(result)}`);
    assert(result.valid === true, `浏览器回归输入不合法：${JSON.stringify(result.errors || result)}`);
  };
  const pendingModal = page.locator('#pendingEditModal');
  const unsavedModal = page.locator('#unsavedModal');
  const expectPending = async (canApply = true) => {
    await pendingModal.waitFor({ state: 'visible', timeout: 5000 });
    assert(await page.locator('#applyPendingEditButton').isEnabled() === canApply, canApply
      ? '可应用编辑会话的“应用修改并继续”被禁用'
      : '未完成编辑会话错误地允许应用');
  };
  const skeletonItem = (kind, ref) => page.locator(`[data-action="select-skeleton-item"][data-kind="${kind}"][data-ref="${ref}"]`);
  const openSkeletonList = async () => {
    await page.locator('[data-action="switch-governance-step"][data-step="skeleton"]').click();
    const listButton = page.locator('[data-action="switch-step-view"][data-view="list"]');
    if (await listButton.count() && !(await listButton.getAttribute('class')).includes('active')) await listButton.click();
    await skeletonItem('behavior', 'behavior_submit').waitFor({ state: 'visible' });
  };
  const openSkeletonDiagram = async () => {
    await page.locator('[data-action="switch-governance-step"][data-step="skeleton"]').click();
    const diagramButton = page.locator('[data-action="switch-step-view"][data-view="diagram"]');
    if (await diagramButton.count() && !(await diagramButton.getAttribute('class')).includes('active')) await diagramButton.click();
    await page.locator('[data-action="undo-graph"]').waitFor({ state: 'visible' });
  };
  const readDownloadJson = async download => {
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString('utf8');
    return JSON.parse(content);
  };
  const downloadCurrentStage = async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('#governanceHeader [data-action="download-current-stage"]').click();
    return readDownloadJson(await downloadPromise);
  };
  const openFileMenuAndClear = async () => {
    const fileMenu = page.locator('#governanceHeader details.header-menu').filter({ hasText: '文件' });
    if (!(await fileMenu.getAttribute('open'))) await fileMenu.locator('summary').click();
    await fileMenu.locator('[data-action="clear-current-page"]').click();
  };

  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.waitForSelector('#jsonInput', { state: 'attached' });

    const templateResponse = await page.context().request.get(`${baseOrigin}/api/template?version=process-governance-v7`);
    assert(templateResponse.ok(), `无法取得v7模板：${templateResponse.status()}`);
    const fixture = (await templateResponse.json()).data;
    fixture.export_meta.initiating_department = '财务部';
    fixture.export_meta.compiler = '浏览器回归测试';
    fixture.process.process_name = '流程与数据未应用修改回归';
    fixture.process.owning_department = '财务部';
    fixture.process.purpose = '验证统一编辑会话保护';
    fixture.process.scope = '仅用于本地自动化回归';
    fixture.behaviors = [
      behavior('behavior_submit', '财务人员提交费用事项', '提交费用资料并登记原始说明。', '费用事项已经提交'),
      behavior('behavior_review', '财务人员复核费用事项', '复核费用资料并形成处理意见。', '费用事项已经复核')
    ];
    fixture.flow_relations = [{
      relation_ref: 'relation_submit_review',
      relation_type: 'condition',
      from_behavior_ref: 'behavior_submit',
      to_behavior_ref: 'behavior_review',
      condition: '费用资料齐全'
    }];
    fixture.data_objects = [{
      data_ref: 'data_expense',
      data_name: '费用事项',
      description: '费用事项业务数据',
      information_type: 'business_information',
      fields: [
        { field_ref: 'field_amount', field_name: '金额', field_type: 'decimal', definition: '本次费用金额' },
        { field_ref: 'field_status', field_name: '处理状态', field_type: 'string', definition: '费用事项当前处理状态' }
      ],
      behavior_links: [{
        link_ref: 'data_link_submit_update',
        behavior_ref: 'behavior_submit',
        operation: 'update',
        updated_field_refs: ['field_amount']
      }],
      source_relations: [],
      lifecycle: pendingLifecycle()
    }];
    fixture.forms = [];
    await validateDocument(fixture);
    await uploadJson('flow-pending-browser-regression-v7.json', fixture);
    record('已导入流程与数据关系回归输入');

    await openSkeletonList();
    await skeletonItem('behavior', 'behavior_submit').click();
    await page.locator('[data-graph-property="behavior_name"]').fill('财务人员提交并登记费用事项');
    await skeletonItem('relation', 'relation_submit_review').click();
    await expectPending(true);
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('[data-graph-property="behavior_name"]').inputValue() === '财务人员提交并登记费用事项', '业务行为选择继续编辑后输入丢失');
    assert(await skeletonItem('behavior', 'behavior_submit').getAttribute('class').then(value => value.includes('primary')), '继续编辑后当前业务行为选择丢失');
    record('业务行为属性切换的继续编辑保留输入与选择');

    await skeletonItem('relation', 'relation_submit_review').click();
    await expectPending(true);
    await page.locator('#applyPendingEditButton').click();
    await page.locator('[data-graph-property="relation_type"]').waitFor({ state: 'visible' });
    record('业务行为属性切换的应用并继续生效');

    await skeletonItem('behavior', 'behavior_submit').click();
    await page.locator('[data-graph-property="behavior_name"]').fill('本次名称应放弃');
    await skeletonItem('relation', 'relation_submit_review').click();
    await expectPending(true);
    await page.locator('#discardPendingEditButton').click();
    await skeletonItem('behavior', 'behavior_submit').click();
    assert(await page.locator('[data-graph-property="behavior_name"]').inputValue() === '财务人员提交并登记费用事项', '放弃业务行为属性后没有恢复已应用值');
    record('业务行为属性切换的放弃修改恢复已应用值');

    await skeletonItem('relation', 'relation_submit_review').click();
    await page.locator('[data-graph-property="relation_type"]').selectOption('sequence');
    await skeletonItem('behavior', 'behavior_submit').click();
    await expectPending(true);
    await page.locator('#applyPendingEditButton').click();
    await page.locator('[data-graph-property="behavior_name"]').waitFor({ state: 'visible' });
    record('流程关系属性通过字段补丁应用');

    await page.locator('[data-action="start-flow-relation"]').click();
    await page.locator('[data-graph-relation-type]').selectOption('sequence');
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await expectPending(false);
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('.graph-operation-card').getByText('第2步：选择起点', { exact: true }).isVisible(), '继续编辑后未完成关系向导没有保留当前阶段');
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await expectPending(false);
    await page.locator('#discardPendingEditButton').click();
    assert(await page.locator('[data-action="switch-step-view"][data-view="behaviors"]').getAttribute('class').then(value => value.includes('active')), '放弃未完成关系向导后没有继续目标导航');
    record('未完成流程关系向导禁用应用，继续保留，放弃后完成导航');

    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-action="choose-data-behavior"]').click();
    await page.locator('[data-graph-data-behavior]').selectOption('behavior_submit');
    await page.locator('[data-action="continue-data-relation"]').click();
    await page.locator('[data-graph-data-operation][value="use"]').check();
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await expectPending(true);
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('[data-graph-data-operation][value="use"]').isChecked(), '继续编辑后数据操作选择丢失');
    record('数据关系操作选择触发未应用保护并保留选择');

    await page.locator('[data-action="open-graph-update-fields"]').click();
    await page.locator('[data-update-field-ref][value="field_amount"]').uncheck();
    await page.locator('[data-update-field-ref][value="field_status"]').check();
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').evaluate(button => button.click());
    await expectPending(true);
    await page.locator('#continuePendingEditingButton').evaluate(button => button.click());
    assert(await page.locator('#updateFieldsModal').isVisible(), '继续编辑后更新字段选择框被关闭');
    assert(await page.locator('[data-update-field-ref][value="field_status"]').isChecked(), '继续编辑后更新字段选择丢失');
    await page.locator('#cancelUpdateFieldsButton').click();
    await expectPending(true);
    assert(await page.locator('#updateFieldsModal').isVisible(), '更新字段存在修改时点击取消却直接关闭弹窗');
    const pendingZIndex = await page.locator('#pendingEditModal').evaluate(element => Number(getComputedStyle(element).zIndex));
    const updateZIndex = await page.locator('#updateFieldsModal').evaluate(element => Number(getComputedStyle(element).zIndex));
    assert(pendingZIndex > updateZIndex, '更新字段的三选保护框被原弹窗遮挡');
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('#updateFieldsModal').isVisible(), '更新字段选择继续编辑后弹窗未恢复');
    assert(await page.locator('[data-update-field-ref][value="field_status"]').isChecked(), '更新字段选择继续编辑后选择丢失');
    await page.locator('#confirmUpdateFieldsButton').click();
    await page.locator('[data-action="apply-data-operations"]').click();
    await page.locator('#statusBox').getByText('数据关系已更新', { exact: false }).waitFor({ state: 'visible' });
    record('尚未确认的更新字段选择触发保护，确认后与数据操作一次应用');

    const downloaded = await downloadCurrentStage();
    const downloadedBehavior = downloaded.behaviors.find(item => item.behavior_ref === 'behavior_submit');
    const downloadedRelation = downloaded.flow_relations.find(item => item.relation_ref === 'relation_submit_review');
    const downloadedData = downloaded.data_objects.find(item => item.data_ref === 'data_expense');
    assert(downloadedBehavior.behavior_name === '财务人员提交并登记费用事项', '下载文件未包含已应用的业务行为名称');
    assert(downloadedBehavior.behavior_description === '提交费用资料并登记原始说明。', '业务行为属性应用覆盖了动作说明');
    assert(downloadedBehavior.completion_standard === '费用事项已经提交', '业务行为属性应用覆盖了完成标准');
    assert(downloadedBehavior.countersign_all_required === true, '业务行为属性应用覆盖了会签要求');
    assert(JSON.stringify(downloadedBehavior.countersign_target_departments) === JSON.stringify(['质量管理部']), '业务行为属性应用覆盖了会签部门');
    assert(downloadedRelation.relation_type === 'sequence', '流程关系类型没有应用');
    assert(downloadedRelation.condition === '费用资料齐全', '流程关系属性应用覆盖了第4步维护的condition');
    const submittedLinks = downloadedData.behavior_links.filter(item => item.behavior_ref === 'behavior_submit');
    assert(submittedLinks.some(item => item.operation === 'use'), '下载文件缺少已应用的use数据操作');
    const updateLink = submittedLinks.find(item => item.operation === 'update');
    assert(updateLink && JSON.stringify(updateLink.updated_field_refs) === JSON.stringify(['field_status']), '下载文件中的更新字段不是用户确认的field_status');
    record('下载验证字段补丁保留非本面板字段、关系条件和数据操作');

    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await page.locator('[data-bind="behaviors.0.behavior_description"]').fill('图操作之后的普通字段修改必须保留。');
    await openSkeletonDiagram();
    await page.locator('[data-action="undo-graph"]').click();
    await page.locator('#statusBox').getByText('该操作之后当前JSON还有其他修改', { exact: false }).waitFor({ state: 'visible' });
    const undoBlockedDownload = await downloadCurrentStage();
    assert(undoBlockedDownload.behaviors[0].behavior_description === '图操作之后的普通字段修改必须保留。', '被阻止的撤销仍覆盖了后续普通字段修改');
    record('撤销检测到后续直接写入修改时阻止整文档覆盖，且保留当前JSON');

    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('#workspace').evaluate(workspace => {
      const select = document.createElement('select');
      select.dataset.bind = 'data_objects.0.behavior_links.0.operation';
      select.innerHTML = '<option value="update">update</option><option value="create">create</option>';
      select.value = 'create';
      workspace.appendChild(select);
      select.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert(await page.locator('#governanceHeader').getByText('有未应用修改', { exact: true }).isVisible(), '引导式数据操作变更被直接写入JSON');
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await expectPending(true);
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('[data-graph-data-operation][value="create"]').isChecked(), '引导式数据操作继续编辑后选择丢失');
    await page.locator('[data-action="switch-governance-step"][data-step="action"]').click();
    await expectPending(true);
    await page.locator('#discardPendingEditButton').click();
    const guidedDiscardDownload = await downloadCurrentStage();
    const guidedDiscardLinks = guidedDiscardDownload.data_objects[0].behavior_links.filter(item => item.behavior_ref === 'behavior_submit');
    assert(guidedDiscardLinks.some(item => item.operation === 'update'), '放弃引导式数据操作后原更新关系丢失');
    assert(!guidedDiscardLinks.some(item => item.operation === 'create'), '放弃引导式数据操作后新操作仍进入JSON');
    record('引导式数据操作在应用前不写入JSON，放弃后不留下部分操作');

    await openSkeletonList();
    await skeletonItem('behavior', 'behavior_submit').click();
    await page.locator('[data-graph-property="behavior_name"]').fill('清空前应用的节点名称');
    await openFileMenuAndClear();
    await expectPending(true);
    assert(!(await unsavedModal.isVisible()), '清空在处理未应用修改前就显示了未下载确认');
    await page.locator('#applyPendingEditButton').click();
    await unsavedModal.waitFor({ state: 'visible', timeout: 5000 });
    assert(!(await pendingModal.isVisible()), '处理未应用修改后仍停留在第一层确认');
    await page.locator('#cancelProtectedButton').click();
    assert(await page.locator('[data-graph-property="behavior_name"]').inputValue() === '清空前应用的节点名称', '取消第二层清空确认后，第一层已应用修改丢失');
    record('清空先处理未应用修改，再显示未下载修改确认');

    await openFileMenuAndClear();
    await unsavedModal.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#discardProtectedButton').click();
    await page.locator('.start-hero').waitFor({ state: 'visible', timeout: 5000 });
    assert(await page.locator('#governanceCandidateSelect').count() === 0, '确认放弃未下载内容后页面没有清空');
    record('第二层确认放弃后才执行清空');

    return { passed: true, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/flow-pending-browser-failure.png', fullPage: true }).catch(() => {});
    throw error;
  }
}
