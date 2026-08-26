async page => {
  const results = [];
  const consoleProblems = [];
  const pageErrors = [];
  const requestUrls = [];
  const baseOrigin = await page.evaluate(() => location.origin);

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const record = message => results.push(message);
  const pendingLifecycle = () => ({
    applicability: 'pending_confirmation',
    entry_state: {
      business_validity: 'pending_confirmation',
      custody: 'pending_confirmation',
      identifiability_applicability: 'pending_confirmation',
      identifiability: 'pending_confirmation'
    },
    routes: [],
    analysis: {
      analyzer_version: '',
      source_fingerprint: '',
      status: 'not_analyzed'
    },
    decision_reason: '',
    decision_notes: ''
  });
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

  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requestUrls.push(request.url()));

  const waitForImport = async expectedCandidateCount => {
    await page.waitForFunction(count => {
      const status = document.querySelector('#statusBox');
      const select = document.querySelector('#governanceCandidateSelect');
      return status?.classList.contains('success')
        && select
        && select.options.length === count;
    }, expectedCandidateCount, { timeout: 15000 });
  };

  const uploadJson = async (name, documentValue, expectedCandidateCount = 1) => {
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.text], payload.name, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, {
      name,
      text: JSON.stringify(documentValue)
    });
    await waitForImport(expectedCandidateCount);
  };

  const validateDocument = async documentValue => {
    const response = await page.context().request.post(`${baseOrigin}/api/validate`, {
      data: { data: documentValue }
    });
    const body = await response.json();
    assert(response.ok(), `验证接口返回 ${response.status()}：${JSON.stringify(body)}`);
    assert(body.valid === true, `浏览器测试输入未通过结构检查：${JSON.stringify(body.errors || body)}`);
  };

  const pendingModal = page.locator('#pendingEditModal');
  const expectPendingModal = async () => {
    await pendingModal.waitFor({ state: 'visible', timeout: 5000 });
    const rect = await pendingModal.locator('.modal').boundingBox();
    const viewport = page.viewportSize();
    assert(rect && viewport, '未取得三选确认框的可见尺寸');
    assert(rect.x >= 0 && rect.y >= 0, '三选确认框超出视口左侧或顶部');
    assert(rect.x + rect.width <= viewport.width + 1, '三选确认框超出视口右侧');
    assert(rect.y + rect.height <= viewport.height + 1, '三选确认框超出视口底部');
  };

  const readDownloadJson = async download => {
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString('utf8');
    return JSON.parse(content);
  };

  const downloadFromHeader = async pendingResolution => {
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('#governanceHeader [data-action="download-current-stage"]').click();
    if (pendingResolution) {
      await expectPendingModal();
      await page.locator(pendingResolution).click();
    }
    return readDownloadJson(await downloadPromise);
  };

  const downloadFinalThroughAction = async pendingResolution => {
    const acceptedDialogs = [];
    const acceptDialog = async dialog => {
      acceptedDialogs.push(dialog.type());
      await dialog.accept();
    };
    page.on('dialog', acceptDialog);
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await page.locator('#workspace').evaluate(workspace => {
        const previous = document.getElementById('pendingEditFinalDownloadAction');
        previous?.remove();
        const button = document.createElement('button');
        button.id = 'pendingEditFinalDownloadAction';
        button.type = 'button';
        button.dataset.action = 'export-current';
        workspace.appendChild(button);
      });
      await page.locator('#pendingEditFinalDownloadAction').click();
      await expectPendingModal();
      await page.locator(pendingResolution).click();
      return { documentValue: await readDownloadJson(await downloadPromise), acceptedDialogs };
    } finally {
      page.off('dialog', acceptDialog);
    }
  };

  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.waitForSelector('#jsonInput', { state: 'attached' });

    const templateResponse = await page.context().request.get(`${baseOrigin}/api/template?version=process-governance-v7`);
    assert(templateResponse.ok(), `无法读取v7空白模板：${templateResponse.status()}`);
    const templateBody = await templateResponse.json();
    const v7 = templateBody.data;
    v7.export_meta.initiating_department = '工程技术部';
    v7.export_meta.compiler = '浏览器回归测试';
    v7.process.process_name = '未应用修改浏览器回归流程';
    v7.process.owning_department = '工程技术部';
    v7.process.purpose = '验证未应用修改保护';
    v7.process.scope = '仅用于本地自动化回归';
    v7.data_objects = [{
      data_ref: 'data_pending_edit_regression',
      data_name: '对象事实基线',
      description: '应用前说明',
      information_type: 'business_information',
      fields: [],
      behavior_links: [],
      source_relations: [],
      lifecycle: pendingLifecycle()
    }];
    await validateDocument(v7);
    await uploadJson('pending-edit-regression-v7.json', v7, 1);
    assert(await page.locator('#governanceHeader').getByText('当前内容与导入文件一致', { exact: true }).isVisible(), '原生v7导入后未显示导入文件基线');
    assert(await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true }).count() === 0, '原生v7导入后误显示为已下载');
    record('已导入单候选v7浏览器测试输入');

    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-graph-data-property="data_name"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-graph-data-property="data_name"]').isEnabled(), '数据对象属性控件可见但没有可用编辑会话');

    await page.locator('[data-graph-data-property="data_name"]').fill('对象事实继续编辑');
    await page.locator('[data-graph-data-property="description"]').fill('继续编辑时必须保留');
    await page.locator('[data-graph-data-property="information_type"]').selectOption('business_conclusion');
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await expectPendingModal();
    await page.locator('#continuePendingEditingButton').click();
    await pendingModal.waitFor({ state: 'hidden' });
    assert(await page.locator('[data-action="switch-data-mode"][data-mode="flow"]').getAttribute('class').then(value => value.includes('active')), '选择继续编辑后仍切换到了生命周期');
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '对象事实继续编辑', '选择继续编辑后数据名称输入丢失');
    assert(await page.locator('[data-graph-data-property="description"]').inputValue() === '继续编辑时必须保留', '选择继续编辑后说明输入丢失');
    record('生命周期切换的“继续编辑”保留输入并取消切换');

    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await expectPendingModal();
    assert(await page.locator('#applyPendingEditButton').isEnabled(), '完整的数据对象修改不能应用');
    await page.locator('#applyPendingEditButton').click();
    await page.locator('[data-action="supplement-data-facts"]').waitFor({ state: 'visible' });
    await page.locator('[data-action="supplement-data-facts"]').click();
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '对象事实继续编辑', '应用后返回数据流没有显示已应用值');
    record('生命周期切换的“应用修改并继续”写入当前JSON');

    await page.locator('[data-graph-data-property="data_name"]').fill('对象事实下载应用');
    await page.locator('[data-graph-data-property="description"]').fill('下载前应用的说明');
    const appliedDownload = await downloadFromHeader('#applyPendingEditButton');
    assert(appliedDownload.data_objects[0].data_name === '对象事实下载应用', '下载文件遗漏下载前应用的数据名称');
    assert(appliedDownload.data_objects[0].description === '下载前应用的说明', '下载文件遗漏下载前应用的说明');
    assert(await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true }).isVisible(), '实际下载成功后未显示已下载基线');
    record('下载先处理未应用修改，应用后的内容进入实际下载文件');

    await page.locator('[data-graph-data-property="data_name"]').fill('最终下载时应放弃的输入');
    const finalDiscarded = await downloadFinalThroughAction('#discardPendingEditButton');
    assert(finalDiscarded.documentValue.data_objects[0].data_name === '对象事实下载应用', '最终下载把已经放弃的未应用输入写入了文件');
    assert(finalDiscarded.acceptedDialogs.includes('confirm'), '最终下载没有执行既有业务提示确认');
    record('最终下载使用同一未应用保护，放弃的输入未进入文件');

    await uploadJson('pending-edit-roundtrip-v7.json', appliedDownload, 1);
    assert(await page.locator('#governanceHeader').getByText('当前内容与导入文件一致', { exact: true }).isVisible(), '重新导入下载文件后未切换为导入文件基线');
    assert(await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true }).count() === 0, '重新导入的文件被误当作当前会话的成功下载');
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-graph-data-property="data_name"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '对象事实下载应用', '当前v7下载文件重新导入后数据名称不一致');
    assert(await page.locator('[data-graph-data-property="description"]').inputValue() === '下载前应用的说明', '当前v7下载文件重新导入后说明不一致');
    record('当前v7下载文件可重新导入，已应用对象事实保持一致');

    await page.locator('[data-graph-data-property="data_name"]').fill('对象事实应放弃');
    await page.locator('[data-graph-data-property="description"]').fill('这段说明不应进入JSON');
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await expectPendingModal();
    await page.locator('#discardPendingEditButton').click();
    await page.locator('[data-action="supplement-data-facts"]').waitFor({ state: 'visible' });
    await page.locator('[data-action="supplement-data-facts"]').click();
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '对象事实下载应用', '放弃修改后没有恢复已应用的数据名称');
    assert(await page.locator('[data-graph-data-property="description"]').inputValue() === '下载前应用的说明', '放弃修改后没有恢复已应用的说明');
    record('生命周期切换的“放弃修改并继续”恢复已应用值');

    await page.locator('[data-graph-data-property="data_name"]').fill('对象事实下载时放弃');
    const discardedDownload = await downloadFromHeader('#discardPendingEditButton');
    assert(discardedDownload.data_objects[0].data_name === '对象事实下载应用', '下载时放弃修改后文件仍包含被放弃内容');
    await uploadJson('pending-edit-discard-roundtrip-v7.json', discardedDownload, 1);
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-graph-data-property="data_name"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '对象事实下载应用', '放弃修改的下载文件重新导入后出现被放弃内容');
    record('下载时放弃的页面输入未进入下载文件，重新导入后仍保持已应用值');

    const undoBeforePureView = await page.locator('[data-action="undo-graph"]').isEnabled();
    const baselineDownload = await downloadFromHeader();
    assert(await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true }).isVisible(), '成功下载后未显示当前内容已下载');
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await page.locator('[aria-label="主数据认定提示"] summary').click();
    await page.locator('[data-graph-data-focus]').selectOption('data_pending_edit_regression');
    await page.locator('[data-action="supplement-data-facts"]').click();
    const undoAfterPureView = await page.locator('[data-action="undo-graph"]').isEnabled();
    assert(undoAfterPureView === undoBeforePureView, '生命周期纯读取操作改变了撤销状态');
    assert(await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true }).isVisible(), '生命周期纯读取操作错误地产生未下载状态');
    const afterPureViewDownload = await downloadFromHeader();
    assert(stableDocument(afterPureViewDownload) === stableDocument(baselineDownload), '生命周期切换、选择或展开说明改变了JSON');
    record('生命周期切换、对象选择和说明展开不改变JSON、撤销状态或未下载状态');

    await page.locator('[data-graph-data-property="description"]').fill('只用于验证离页保护');
    assert(await page.locator('#governanceHeader').getByText('有未应用修改', { exact: true }).isVisible(), '页面没有识别只存在于编辑会话的未应用修改');
    let beforeUnloadDialog = '';
    const dismissBeforeUnload = async dialog => {
      beforeUnloadDialog = dialog.type();
      await dialog.dismiss();
    };
    page.on('dialog', dismissBeforeUnload);
    const beforeUnloadProtection = await page.evaluate(() => {
      const event = new Event('beforeunload', { bubbles: false, cancelable: true });
      const dispatchResult = window.dispatchEvent(event);
      return { dispatchResult, defaultPrevented: event.defaultPrevented, returnValue: event.returnValue };
    });
    await page.waitForTimeout(100);
    page.off('dialog', dismissBeforeUnload);
    assert(
      beforeUnloadDialog === 'beforeunload'
        || (beforeUnloadProtection.defaultPrevented && beforeUnloadProtection.dispatchResult === false),
      '只有未应用修改时，beforeunload处理器没有阻止离页'
    );
    assert(await page.locator('[data-graph-data-property="description"]').inputValue() === '只用于验证离页保护', '离页保护检查后未应用输入丢失');
    const candidateBeforeInvalidImport = await page.locator('#governanceCandidateSelect').inputValue();
    await page.locator('#jsonInput').evaluate(input => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['{"schema_version":'], 'invalid-import.json', { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#statusBox')?.classList.contains('error'), null, { timeout: 5000 });
    assert(await page.locator('#governanceCandidateSelect').inputValue() === candidateBeforeInvalidImport, '导入失败后当前候选发生变化');
    assert(await page.locator('[data-graph-data-property="description"]').inputValue() === '只用于验证离页保护', '导入失败后未应用输入丢失');
    assert(await page.locator('#governanceHeader').getByText('有未应用修改', { exact: true }).isVisible(), '导入失败后编辑会话未保留');
    record('导入失败不替换当前JSON，候选和未应用输入均保留');
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await expectPendingModal();
    await page.locator('#discardPendingEditButton').click();
    record('只有未应用修改时，beforeunload处理器仍阻止离页且输入保留');

    const lifecycleDocument = JSON.parse(JSON.stringify(v7));
    lifecycleDocument.process.process_name = '生命周期事务回归流程';
    lifecycleDocument.behaviors = [{
      behavior_ref: 'behavior_lifecycle_create',
      node_type: 'action',
      behavior_name: '形成测试数据',
      behavior_description: '形成一条用于验证生命周期的数据。',
      current_actor_role: '工程技术部',
      actor_assignment_mode: 'fixed_department',
      actor_department_data_ref: null,
      actor_position_rule: '',
      trigger: '', precondition: '', input_description: '', timing: null,
      completion_standard: '测试数据已形成', output_description: '',
      countersign_all_required: false, countersign_target_departments: []
    }];
    lifecycleDocument.flow_relations = [];
    lifecycleDocument.data_objects[0].behavior_links = [{
      link_ref: 'data_link_lifecycle_create',
      behavior_ref: 'behavior_lifecycle_create',
      operation: 'create',
      updated_field_refs: []
    }];
    lifecycleDocument.data_objects[0].lifecycle = pendingLifecycle();
    await validateDocument(lifecycleDocument);
    await uploadJson('lifecycle-transaction-regression-v7.json', lifecycleDocument, 1);
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    const lifecycleBaseline = await downloadFromHeader();
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await page.locator('[data-action="reanalyze-current-lifecycle"]').click();
    await page.locator('#statusBox').getByText('已重新分析1个数据对象', { exact: false }).waitFor({ state: 'visible' });
    await page.locator('[data-action="reanalyze-current-lifecycle"]').click();
    await page.locator('#statusBox').getByText('分析结果没有变化', { exact: false }).waitFor({ state: 'visible' });
    await page.locator('[data-action="switch-data-mode"][data-mode="flow"]').click();
    await page.locator('[data-action="undo-graph"]').click();
    const lifecycleAfterOneUndo = await downloadFromHeader();
    assert(stableDocument(lifecycleAfterOneUndo) === stableDocument(lifecycleBaseline), '重复生命周期分析产生了多余撤销记录，或一次撤销未恢复分析前JSON');
    record('生命周期分析只在结果变化时形成一次事务，重复分析不增加撤销记录');

    const legacy = {
      schema_version: 'document-structured-output-v2',
      draft: {
        document_no: 'BROWSER-REGRESSION-001',
        document_title: '多候选切换浏览器回归',
        planned_edition: 'A',
        process_name: '多候选切换浏览器回归',
        reason: '验证候选切换取消恢复',
        basis_type: '现场实际',
        department: { department_name: '工程技术部' }
      },
      document_profile: {
        document_no: 'BROWSER-REGRESSION-001',
        document_title: '多候选切换浏览器回归',
        purpose: '验证候选切换保护',
        scope: '仅用于本地自动化回归'
      },
      processes: [
        { process_ref: 'legacy_process_one', process_type: 'new', l1_name: '测试域', l2_name: '测试能力', l3_name: '候选流程一' },
        { process_ref: 'legacy_process_two', process_type: 'new', l1_name: '测试域', l2_name: '测试能力', l3_name: '候选流程二' }
      ],
      steps: [
        { step_ref: 'legacy_step_one', process_ref: 'legacy_process_one', step_type: 'action', step_name: '形成候选一数据', output_result: '候选一数据对象' },
        { step_ref: 'legacy_step_two', process_ref: 'legacy_process_two', step_type: 'action', step_name: '形成候选二数据', output_result: '候选二数据对象' }
      ],
      step_transitions: [],
      evidence_catalog: []
    };
    await validateDocument(legacy);
    await uploadJson('pending-edit-regression-multi-v2.json', legacy, 2);
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-graph-data-property="data_name"]').fill('候选一尚未应用');
    await page.locator('#governanceCandidateSelect').selectOption('1');
    await expectPendingModal();
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('#governanceCandidateSelect').inputValue() === '0', '取消顶部候选切换后下拉框没有恢复原候选');
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '候选一尚未应用', '取消候选切换后当前输入丢失');
    await page.locator('[data-candidate-index="1"]').click();
    await expectPendingModal();
    await page.locator('#continuePendingEditingButton').click();
    assert(await page.locator('#governanceCandidateSelect').inputValue() === '0', '取消侧栏候选切换后当前候选发生变化');
    assert(await page.locator('[data-graph-data-property="data_name"]').inputValue() === '候选一尚未应用', '取消侧栏候选切换后当前输入丢失');
    record('顶部和侧栏候选切换选择继续编辑后均恢复原候选和值');

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 864 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(80);
      await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
      await expectPendingModal();
      await page.locator('#continuePendingEditingButton').click();
      assert(
        await page.locator('[data-graph-data-property="data_name"]').inputValue() === '候选一尚未应用',
        `${viewport.width}×${viewport.height}选择继续编辑后输入丢失`
      );
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `${viewport.width}×${viewport.height}出现页面级横向溢出：${overflow}px`);
    }
    record('三档桌面视口的三项保护无遮挡、继续编辑保留输入，且没有页面级横向溢出');

    const storage = await page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      cookie: document.cookie,
      indexedDb: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : 0
    }));
    assert(storage.localStorage === 0, `localStorage存在${storage.localStorage}项`);
    assert(storage.sessionStorage === 0, `sessionStorage存在${storage.sessionStorage}项`);
    assert(storage.indexedDb === 0, `IndexedDB存在${storage.indexedDb}个数据库`);
    assert(storage.cookie === '', '页面写入了Cookie');

    const unexpectedRequests = requestUrls.filter(url => {
      if (/^(?:blob:|data:|about:)/.test(url)) return false;
      return !url.startsWith(`${baseOrigin}/`);
    });
    assert(unexpectedRequests.length === 0, `发现3001以外的网络请求：${unexpectedRequests.join('，')}`);
    assert(pageErrors.length === 0, `页面异常：${pageErrors.join('；')}`);
    assert(consoleProblems.length === 0, `控制台warning/error：${consoleProblems.join('；')}`);
    record('业务存储为空，未请求3000、AI或第三方，控制台无warning/error');

    return { passed: true, checks: results };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/pending-edit-browser-failure.png', fullPage: true }).catch(() => {});
    throw error;
  }
}
