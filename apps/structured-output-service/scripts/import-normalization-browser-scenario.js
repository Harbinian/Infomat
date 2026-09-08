async page => {
  const consoleProblems = [];
  const pageErrors = [];
  const requests = [];
  const viewportResults = [];
  const baseOrigin = await page.evaluate(() => location.origin);

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const clone = value => JSON.parse(JSON.stringify(value));

  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), postData: request.postData() || '' }));
  page.on('dialog', async dialog => dialog.accept());

  const browserRuntime = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewportScale: visualViewport?.scale || 1
  }));
  assert(/Edg\//.test(browserRuntime.userAgent), `浏览器不是Microsoft Edge：${browserRuntime.userAgent}`);
  assert(browserRuntime.viewportScale === 1, `浏览器页面缩放不是100%：${browserRuntime.viewportScale}`);

  const v6Seed = {
    schema_version: 'process-governance-v6',
    export_meta: {
      package_ref: 'package_import_normalization_test',
      exported_at: '2026-09-03T00:00:00.000Z',
      initiating_department: '工程技术部',
      compiler: '自动测试'
    },
    process: {
      process_ref: 'process_import_normalization_test',
      process_name: '导入规范化测试流程',
      owning_department: '工程技术部',
      purpose: '验证原生v7导入规范化差异可见',
      scope: '仅限脱敏自动测试',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    behaviors: [{
      behavior_ref: 'behavior_dynamic_with_data',
      node_type: 'action',
      behavior_name: '按数据确定责任部门',
      behavior_description: '根据申请数据确定责任部门。',
      current_actor_role: '工程技术部经办人',
      actor_assignment_mode: 'fixed_department',
      actor_department_data_ref: null,
      actor_position_rule: '',
      trigger: '收到申请时',
      precondition: '',
      input_description: '',
      timing: null,
      completion_standard: '责任部门已经确定',
      output_description: '',
      countersign_all_required: false,
      countersign_target_departments: []
    }],
    flow_relations: [],
    data_objects: [{
      data_ref: 'data_department_source',
      data_name: '责任部门来源数据',
      description: '用于自动测试动态责任来源。',
      information_type: 'business_information',
      behavior_links: [{
        link_ref: 'data_link_department_source',
        behavior_ref: 'behavior_dynamic_with_data',
        operation: 'use'
      }],
      source_relations: []
    }],
    forms: [],
    terms: [],
    migration: {
      source_schema_version: 'process-governance-v6',
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

  const source = await page.evaluate(seed => {
    const value = globalThis.ProcessGovernanceMigration.migrateDocument(seed)[0];
    Object.assign(value.behaviors[0], {
      behavior_name: '<script data-normalization-xss>动态责任一</script>',
      current_actor_role: '<img data-normalization-xss src=x onerror="window.__normalizationXss=1">',
      actor_assignment_mode: 'dynamic_from_data',
      actor_department_data_ref: 'data_department_source',
      actor_position_rule: '按来源数据匹配岗位'
    });
    value.behaviors.push({
      ...JSON.parse(JSON.stringify(value.behaviors[0])),
      behavior_ref: 'behavior_dynamic_without_data',
      behavior_name: '无部门来源数据的动态责任',
      current_actor_role: '运行时确定的办理岗位',
      actor_department_data_ref: null,
      actor_position_rule: '按运行条件匹配岗位'
    });
    return value;
  }, clone(v6Seed));

  const sourceValidation = await page.context().request.post(`${baseOrigin}/api/validate`, {
    data: { data: source }
  });
  const sourceValidationBody = await sourceValidation.json();
  assert(sourceValidation.ok() && sourceValidationBody.valid === true,
    `原生v7脱敏夹具未通过校验：${JSON.stringify(sourceValidationBody.errors)}`);

  const uploadJson = async (name, value) => {
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.text], payload.name, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name, text: JSON.stringify(value) });
    await page.waitForFunction(() => {
      const status = document.querySelector('#statusBox');
      return status?.classList.contains('success') && !busy && candidates.length === 1;
    }, null, { timeout: 15000 });
  };

  await uploadJson('native-v7-normalization-<unsafe>.json', source);
  const importedState = await page.evaluate(() => {
    const entry = currentEntry();
    return {
      dirty: entry?.dirty,
      forceDirty: entry?.forceDirty,
      fileState: candidateFileState(entry),
      normalization: JSON.parse(JSON.stringify(entry?.importInfo?.normalization || null)),
      currentActors: currentDocument()?.behaviors?.map(item => item.current_actor_role),
      actorSources: currentDocument()?.behaviors?.map(item => item.actor_department_data_ref),
      archives: JSON.parse(JSON.stringify(currentDocument()?.migration?.unresolved_actor_roles || [])),
      importInfoInDocument: Object.prototype.hasOwnProperty.call(currentDocument() || {}, 'importInfo')
    };
  });
  assert(importedState.dirty === true && importedState.forceDirty === true, '规范化差异没有形成未下载状态');
  assert(importedState.fileState === null, '规范化后仍错误显示为与导入文件一致');
  assert(importedState.normalization?.totalChanges === 2, '动态责任差异没有按两个业务对象聚合');
  assert(importedState.normalization?.shownChanges === 2 && importedState.normalization?.truncated === false,
    '规范化差异显示数量不正确');
  assert(importedState.normalization.changes.every(change => change.code === 'DYNAMIC_ACTOR_ROLE_ARCHIVED'),
    '动态责任差异编码不正确');
  assert(importedState.normalization.changes.every(change => change.path.endsWith('/current_actor_role')),
    '动态责任差异没有定位到JSON Pointer');
  assert(importedState.normalization.changes.every(change => change.stable_object_ref && change.object_name
    && change.before_present && change.after_present && change.migration_archive_ref),
  '规范化差异缺少稳定标识、对象名称、前后值或迁移归档标识');
  assert(JSON.stringify(importedState.currentActors) === JSON.stringify(['', '']), '动态责任当前字段没有清空');
  assert(JSON.stringify(importedState.actorSources) === JSON.stringify(['data_department_source', null]),
    '有/无部门来源数据的动态责任状态没有保留');
  assert(importedState.archives.length === 2, '动态责任原值没有完整进入迁移归档');
  assert(importedState.importInfoInDocument === false, '页面导入摘要进入了当前JSON');

  const fileMenu = page.locator('#governanceHeader details.header-menu').filter({ hasText: '文件' });
  if (await fileMenu.isVisible()) {
    if (!(await fileMenu.getAttribute('open'))) await fileMenu.locator('summary').click();
    const fileInfo = fileMenu.locator('[data-action="switch-governance-step"][data-step="start"]');
    if (await fileInfo.isVisible()) await fileInfo.click();
  }
  const details = page.locator('.import-normalization-details');
  await details.waitFor({ state: 'visible', timeout: 5000 });
  await details.locator('summary').click();
  assert(await details.locator('.import-normalization-item').count() === 2, '页面没有按业务对象显示两项差异');
  const detailsText = await details.textContent();
  assert(detailsText.includes('动态责任原值已保留在迁移归档；当前内容尚未下载。'), '页面缺少归档和未下载提示');
  assert(detailsText.includes('/behaviors/0/current_actor_role'), '页面缺少JSON Pointer');
  assert(detailsText.includes('DYNAMIC_ACTOR_ROLE_ARCHIVED'), '页面缺少变化编码');
  assert(await page.locator('[data-normalization-xss]').count() === 0, '上传文字被解释为HTML元素');
  assert(await page.evaluate(() => globalThis.__normalizationXss !== 1), '上传文字触发了脚本');

  for (const viewport of [
    { width: 1699, height: 828 },
    { width: 1920, height: 1080 },
    { width: 1920, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(50);
    const layout = await page.evaluate(() => {
      const workspace = document.querySelector('#workspace');
      const panel = document.querySelector('.import-normalization-details');
      const panelRect = panel?.getBoundingClientRect();
      const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
      return {
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : null,
        panelLeft: panelRect?.left,
        panelRight: panelRect?.right,
        viewportWidth: innerWidth,
        workspaceOverflowX: workspaceStyle?.overflowX,
        workspaceOverflowY: workspaceStyle?.overflowY
      };
    });
    assert(layout.bodyOverflow <= 1, `${viewport.width}x${viewport.height}出现页面横向溢出：${layout.bodyOverflow}`);
    assert(layout.panelOverflow <= 1, `${viewport.width}x${viewport.height}差异摘要横向溢出：${layout.panelOverflow}`);
    assert(layout.panelLeft >= 0 && layout.panelRight <= layout.viewportWidth + 1,
      `${viewport.width}x${viewport.height}差异摘要超出可视区`);
    assert(['auto', 'scroll'].includes(layout.workspaceOverflowX)
      && ['auto', 'scroll'].includes(layout.workspaceOverflowY),
    `${viewport.width}x${viewport.height}工作区没有保留独立滚动`);
    viewportResults.push({ ...viewport, ...layout });
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('#governanceHeader [data-action="download-current-stage"]').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let downloadedText = '';
  for await (const chunk of stream) downloadedText += chunk.toString('utf8');
  const downloaded = JSON.parse(downloadedText);
  await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true })
    .waitFor({ state: 'visible', timeout: 15000 });
  assert((await details.textContent()).includes('当前内容已下载。'), '下载后差异摘要没有更新文件状态');
  assert(!Object.prototype.hasOwnProperty.call(downloaded, 'importInfo'), '下载JSON包含页面导入信息');
  assert(!Object.prototype.hasOwnProperty.call(downloaded, 'normalization'), '下载JSON包含页面规范化摘要');
  assert(downloaded.behaviors.every(item => item.current_actor_role === ''), '下载JSON没有保留规范化当前值');
  assert(downloaded.migration.unresolved_actor_roles.length === 2, '下载JSON没有保留两项迁移归档');

  await uploadJson(download.suggestedFilename(), downloaded);
  const reimportedState = await page.evaluate(() => {
    const entry = currentEntry();
    return {
      dirty: entry?.dirty,
      forceDirty: entry?.forceDirty,
      fileState: candidateFileState(entry),
      normalization: JSON.parse(JSON.stringify(entry?.importInfo?.normalization || null)),
      archiveCount: currentDocument()?.migration?.unresolved_actor_roles?.length,
      importInfoInDocument: Object.prototype.hasOwnProperty.call(currentDocument() || {}, 'importInfo')
    };
  });
  assert(reimportedState.dirty === false && reimportedState.forceDirty === false, '规范化文件重导入仍产生未下载状态');
  assert(reimportedState.fileState?.label === '当前内容与导入文件一致', '规范化文件重导入没有显示一致状态');
  assert(reimportedState.normalization?.changed === false && reimportedState.normalization?.totalChanges === 0,
    '规范化文件重导入仍产生差异摘要');
  assert(reimportedState.archiveCount === 2, '规范化文件重导入重复新增迁移归档');
  assert(reimportedState.importInfoInDocument === false, '重导入摘要进入了当前JSON');

  const storage = await page.evaluate(async () => ({
    localStorageLength: localStorage.length,
    sessionStorageLength: sessionStorage.length,
    cookie: document.cookie,
    indexedDbCount: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : 0
  }));
  assert(storage.localStorageLength === 0 && storage.sessionStorageLength === 0
    && storage.cookie === '' && storage.indexedDbCount === 0,
  `浏览器持久化边界被突破：${JSON.stringify(storage)}`);
  const port3000Requests = requests.filter(request => /:\/\/[^/]+:3000(?:\/|$)/.test(request.url));
  const leakedSummaries = requests.filter(request => /"(?:importInfo|normalization)"\s*:/.test(request.postData));
  assert(port3000Requests.length === 0, `检测到3000网络调用：${port3000Requests.map(item => item.url).join(' | ')}`);
  assert(leakedSummaries.length === 0, '页面导入摘要被发送到服务端');
  assert(pageErrors.length === 0, `浏览器页面异常：${pageErrors.join(' | ')}`);
  assert(consoleProblems.length === 0, `浏览器控制台存在warning/error：${consoleProblems.join(' | ')}`);

  const evidence = {
    passed: true,
    browser: 'Microsoft Edge',
    viewportScale: browserRuntime.viewportScale,
    normalizationChanges: 2,
    archiveCount: 2,
    reimportedArchiveCount: reimportedState.archiveCount,
    reimportedDirty: reimportedState.dirty,
    storage,
    port3000Requests: port3000Requests.length,
    serverSummaryPayloads: leakedSummaries.length,
    consoleProblems: consoleProblems.length,
    pageErrors: pageErrors.length,
    viewportResults
  };
  console.log(JSON.stringify(evidence, null, 2));
  return evidence;
}
