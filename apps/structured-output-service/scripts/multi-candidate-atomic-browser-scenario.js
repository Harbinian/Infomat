async page => {
  const results = [];
  const consoleProblems = [];
  const pageErrors = [];
  const atomicFileChecks = [];
  const baseOrigin = await page.evaluate(() => location.origin);

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const deepEqual = (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
  };
  const record = message => results.push(message);

  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', async dialog => dialog.accept());

  const baselineSource = {
    schema_version: 'document-structured-output-v2',
    generated_at: '2026-08-26T00:00:00.000Z',
    draft: {
      document_no: 'MC-BASE-001',
      document_title: '多候选浏览器状态基线',
      planned_edition: 'A',
      process_name: '多候选浏览器状态基线',
      basis_type: '现场实际',
      department: { department_name: '工程技术部' }
    },
    document_profile: {
      document_no: 'MC-BASE-001',
      document_title: '多候选浏览器状态基线',
      purpose: '验证失败导入不改变页面状态',
      scope: '仅限脱敏技术测试'
    },
    processes: [
      {
        process_ref: 'baseline-one', process_type: 'new', l1_name: '测试域',
        l2_name: '测试能力', l3_name: '基线候选一'
      },
      {
        process_ref: 'baseline-two', process_type: 'new', l1_name: '测试域',
        l2_name: '测试能力', l3_name: '基线候选二'
      }
    ],
    steps: [
      {
        step_ref: 'baseline-one-start', process_ref: 'baseline-one', step_type: 'action',
        step_name: '形成候选一数据', output_result: '候选一数据对象'
      },
      {
        step_ref: 'baseline-one-finish', process_ref: 'baseline-one', step_type: 'action',
        step_name: '完成候选一事项'
      },
      {
        step_ref: 'baseline-two-start', process_ref: 'baseline-two', step_type: 'action',
        step_name: '形成候选二数据', output_result: '候选二数据对象'
      },
      {
        step_ref: 'baseline-two-finish', process_ref: 'baseline-two', step_type: 'action',
        step_name: '完成候选二事项'
      }
    ],
    step_transitions: [
      {
        transition_ref: 'baseline-one-sequence', process_ref: 'baseline-one',
        from_step_ref: 'baseline-one-start', to_step_ref: 'baseline-one-finish',
        condition: '形成数据后继续'
      },
      {
        transition_ref: 'baseline-two-sequence', process_ref: 'baseline-two',
        from_step_ref: 'baseline-two-start', to_step_ref: 'baseline-two-finish',
        condition: '形成数据后继续'
      }
    ],
    evidence_catalog: []
  };

  const atomicRejectSource = {
    schema_version: 'document-structured-output-v2',
    generated_at: '2026-08-26T00:00:00.000Z',
    draft: {
      document_no: 'MC-ATOMIC-001',
      document_title: '多候选原子拒绝测试',
      planned_edition: 'A',
      process_name: '多候选原子拒绝测试',
      basis_type: '现场实际',
      department: { department_name: '工程技术部' }
    },
    document_profile: {
      document_no: 'MC-ATOMIC-001',
      document_title: '多候选原子拒绝测试',
      purpose: '验证多候选整批拒绝',
      scope: '仅限脱敏技术测试'
    },
    processes: [
      {
        process_ref: 'valid-process', process_type: 'new', l1_name: '测试域',
        l2_name: '测试能力', l3_name: '有效候选'
      },
      {
        process_ref: 'invalid-process', process_type: 'new', l1_name: '测试域',
        l2_name: '测试能力', l3_name: '目标自环候选'
      }
    ],
    steps: [
      {
        step_ref: 'valid-step', process_ref: 'valid-process', step_type: 'action',
        step_name: '办理有效事项'
      },
      {
        step_ref: 'invalid-step', process_ref: 'invalid-process', step_type: 'action',
        step_name: '办理异常事项'
      }
    ],
    step_transitions: [
      {
        transition_ref: 'invalid-self-loop', process_ref: 'invalid-process',
        from_step_ref: 'invalid-step', to_step_ref: 'invalid-step',
        condition: '再次进入同一步骤'
      }
    ],
    evidence_catalog: []
  };

  const validateThroughApi = async documentValue => {
    const response = await page.context().request.post(`${baseOrigin}/api/validate`, {
      data: { data: documentValue }
    });
    const body = await response.json();
    assert(response.ok(), `校验接口返回HTTP ${response.status()}：${JSON.stringify(body)}`);
    return body;
  };

  const waitForImport = async expectedCandidateCount => {
    await page.waitForFunction(count => {
      const status = document.querySelector('#statusBox');
      const select = document.querySelector('#governanceCandidateSelect');
      return status?.classList.contains('success')
        && select?.options.length === count
        && typeof busy !== 'undefined'
        && busy === false;
    }, expectedCandidateCount, { timeout: 15000 });
  };

  const uploadJson = async (name, documentValue, expectedCandidateCount) => {
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.text], payload.name, {
        type: 'application/json',
        lastModified: payload.lastModified
      }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, {
      name,
      text: JSON.stringify(documentValue),
      lastModified: 1756166400000
    });
    await waitForImport(expectedCandidateCount);
  };

  const drainDownload = async download => {
    const stream = await download.createReadStream();
    for await (const _chunk of stream) {
      // Consume the browser download so the user-visible download path completes.
    }
  };

  const downloadCurrent = async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('#governanceHeader [data-action="download-current-stage"]').click();
    const download = await downloadPromise;
    await drainDownload(download);
    await page.locator('#governanceHeader').getByText('当前内容已下载', { exact: true })
      .waitFor({ state: 'visible', timeout: 15000 });
    return download.suggestedFilename();
  };

  const switchCandidate = async index => {
    await page.locator('#governanceCandidateSelect').selectOption(String(index));
    await page.waitForFunction(expected => currentIndex === expected, index, { timeout: 5000 });
  };

  const prepareDownloadedBaseline = async () => {
    const sourceValidation = await validateThroughApi(baselineSource);
    assert(sourceValidation.valid === true, `双候选基线源无效：${JSON.stringify(sourceValidation.errors)}`);
    await uploadJson('multi-candidate-state-baseline-v2.json', baselineSource, 2);
    assert(await page.locator('#governanceCandidateSelect').inputValue() === '0', '双候选基线没有从候选0开始');
    await downloadCurrent();
    await switchCandidate(1);
    await downloadCurrent();
    const state = await page.evaluate(() => candidates.map(entry => ({
      dirty: entry.dirty,
      hasDownload: Boolean(entry.lastDownload),
      processName: entry.data?.process?.process_name || ''
    })));
    deepEqual(state.map(item => item.processName), ['基线候选一', '基线候选二'], '双候选基线顺序不正确');
    assert(state.every(item => item.dirty === false && item.hasDownload), '双候选下载基线没有完整建立');
  };

  const shaCurrentDocument = () => page.evaluate(async () => globalThis.GovernanceWorkflow.sha256Hex(
    new TextEncoder().encode(JSON.stringify(currentDocument()))
  ));

  const graphHistory = () => page.evaluate(() => graphHistoryState());

  const openSkeletonDiagram = async () => {
    await page.locator('[data-action="switch-governance-step"][data-step="skeleton"]').click();
    await page.waitForFunction(() => Boolean(diagramView?.cy), null, { timeout: 10000 });
  };

  const addGraphNode = async expectedUndoCount => {
    await page.locator('#workspace [data-action="add-graph-node"]').click();
    await page.waitForFunction(count => graphHistoryState().undoCount === count, expectedUndoCount, { timeout: 10000 });
  };

  const prepareGraphScenario = async () => {
    const downloadedBaselineSha = await shaCurrentDocument();
    await openSkeletonDiagram();
    await addGraphNode(1);
    const afterFirstAddSha = await shaCurrentDocument();
    await addGraphNode(2);
    const afterSecondAddSha = await shaCurrentDocument();
    await page.locator('#workspace [data-action="undo-graph"]').click();
    await page.waitForFunction(() => {
      const state = graphHistoryState();
      return state.undoCount === 1 && state.redoCount === 1;
    }, null, { timeout: 10000 });
    assert(await shaCurrentDocument() === afterFirstAddSha, '一次撤销没有恢复第一次新增节点后的JSON');

    await page.evaluate(() => {
      const selectedRef = currentDocument()?.behaviors?.[0]?.behavior_ref;
      const node = diagramView?.cy?.nodes('.behavior-node')
        .filter(item => item.data('focusRef') === selectedRef)
        .first();
      if (!node?.length) throw new Error('流程图没有找到可选择的真实业务行为节点');
      node.emit('tap');
    });
    await page.waitForFunction(() => graphSelection?.kind === 'behavior', null, { timeout: 5000 });
    const behaviorName = page.locator('[data-graph-property="behavior_name"]');
    await behaviorName.waitFor({ state: 'visible', timeout: 5000 });
    await behaviorName.fill('GRAPH-UNAPPLIED-CANARY-20260826');
    await page.waitForFunction(() => {
      const session = editSessionManager.get();
      return Boolean(session && editSessionManager.isDirty(session.candidateKey));
    }, null, { timeout: 5000 });
    await page.evaluate(() => {
      diagramView.cy.zoom(0.82);
      diagramView.cy.pan({ x: 117, y: 73 });
      captureGraphViewport();
    });
    await page.waitForTimeout(50);
    const history = await graphHistory();
    assert(history.undoCount === 1 && history.redoCount === 1, '图场景没有形成一条撤销和一条重做记录');
    return { downloadedBaselineSha, afterFirstAddSha, afterSecondAddSha };
  };

  const capturePageState = () => page.evaluate(async () => {
    const safeClone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const roundNumber = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(5)) : null;
    const normalizeViewport = viewport => viewport ? {
      zoom: roundNumber(viewport.zoom),
      pan: viewport.pan ? { x: roundNumber(viewport.pan.x), y: roundNumber(viewport.pan.y) } : null,
      dataRef: viewport.dataRef || ''
    } : null;
    const normalizeGraphSnapshot = snapshot => ({
      canUndo: Boolean(snapshot?.canUndo),
      canRedo: Boolean(snapshot?.canRedo),
      undoCount: Number(snapshot?.undoCount || 0),
      redoCount: Number(snapshot?.redoCount || 0),
      dirty: Boolean(snapshot?.dirty),
      view: snapshot?.view ? {
        mode: snapshot.view.mode,
        selection: safeClone(snapshot.view.selection),
        flow: normalizeViewport(snapshot.view.flow),
        data: normalizeViewport(snapshot.view.data)
      } : null
    });
    const sha = value => globalThis.GovernanceWorkflow.sha256Hex(new TextEncoder().encode(value));
    const candidateStates = [];
    for (const entry of candidates) {
      const key = candidateStateKey(entry);
      const unapplied = candidateHasUnappliedChanges(entry);
      candidateStates.push({
        stateKey: key,
        processRef: entry.data?.process?.process_ref || '',
        processName: entry.data?.process?.process_name || '',
        exactJsonSha256: await sha(JSON.stringify(entry.data)),
        graphFingerprintSha256: await sha(globalThis.GraphEditorState.fingerprint(entry.data)),
        dirty: Boolean(entry.dirty),
        forceDirty: Boolean(entry.forceDirty),
        origin: entry.origin || '',
        importInfo: safeClone(entry.importInfo || null),
        lastDownload: safeClone(entry.lastDownload || null),
        governanceStep: entry.governanceStep || '',
        stepView: entry.stepView || '',
        hasUnappliedChanges: Boolean(unapplied),
        fileState: safeClone(candidateFileState(entry, unapplied)),
        graphHistory: normalizeGraphSnapshot(graphStateManager.snapshot(key, entry.data))
      });
    }
    const select = document.querySelector('#governanceCandidateSelect');
    return {
      candidates: candidateStates,
      currentIndex,
      candidateSelect: select ? {
        value: select.value,
        options: Array.from(select.options).map(option => ({ value: option.value, text: option.textContent }))
      } : null,
      navigation: {
        activeGovernanceStep,
        activeStepView,
        activeWorkspaceTab,
        activeEditorSection,
        activeProcessSection,
        activeBehaviorRef,
        activeRelationRef,
        activeDataRef,
        activeDataFieldRef,
        activeDataMode,
        activeDataEditingMode,
        activeGridWorkspace,
        activeTermRef,
        activeFlowItemKind,
        activeFormRef,
        activeAreaRef,
        activeFormItemRef,
        advancedLifecycleMode
      },
      graph: {
        selection: safeClone(graphSelection),
        flowRelationDraft: safeClone(flowRelationDraft),
        liveFlowViewport: normalizeViewport(diagramView?.viewport?.()),
        liveDataViewport: normalizeViewport(dataDiagramView?.viewport?.()),
        undoEnabled: Boolean(document.querySelector('[data-action="undo-graph"]:not([disabled])')),
        redoEnabled: Boolean(document.querySelector('[data-action="redo-graph"]:not([disabled])'))
      },
      editSession: safeClone(editSessionManager.get()),
      webGrid: webGridSession ? {
        dirty: webGridSession.isDirty(),
        sourceKey: webGridSession.sourceKey(),
        allRows: webGridSession.allRows(),
        issues: safeClone(webGridIssues),
        selectedRows: safeClone(webGridSelectedRows),
        filters: safeClone(webGridFilters),
        sorts: safeClone(webGridSorts),
        ranges: safeClone(webGridRanges)
      } : null,
      checkedGovernanceSteps: [...checkedGovernanceSteps].sort(),
      hasUnappliedChanges: hasUnappliedChanges(),
      hasUndownloadedChanges: hasUndownloadedChanges()
    };
  });

  const preflightAtomicSource = async () => page.evaluate(async source => {
    const cloneValue = value => JSON.parse(JSON.stringify(value));
    const sourceBefore = JSON.stringify(source);
    const sourceResponse = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: source })
    });
    const sourceValidation = await sourceResponse.json();
    const migrated = globalThis.ProcessGovernanceMigration.migrateDocument(source, {
      departments: typeof DEPARTMENTS === 'undefined' ? [] : DEPARTMENTS
    });
    const targetValidations = await Promise.all(migrated.map(async documentValue => {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: documentValue })
      });
      return { status: response.status, body: await response.json() };
    }));
    const batch = globalThis.ImportCompatibility.classifyPostMigrationBatch(
      targetValidations.map(result => result.body)
    );
    return {
      sourceStatus: sourceResponse.status,
      sourceValidation,
      sourceUnchanged: sourceBefore === JSON.stringify(source),
      candidateCount: migrated.length,
      candidateNames: migrated.map(item => item.process?.process_name || ''),
      targetValidations: cloneValue(targetValidations),
      batch: cloneValue(batch)
    };
  }, clone(atomicRejectSource));

  const assertAtomicPreflight = preflight => {
    assert(preflight.sourceStatus === 200, `多候选源校验HTTP状态不是200：${preflight.sourceStatus}`);
    assert(preflight.sourceValidation.valid === true, `多候选源未通过源API校验：${JSON.stringify(preflight.sourceValidation.errors)}`);
    assert(preflight.sourceUnchanged === true, '迁移预检修改了多候选源对象');
    assert(preflight.candidateCount === 2, `迁移候选数不是2：${preflight.candidateCount}`);
    deepEqual(preflight.candidateNames, ['有效候选', '目标自环候选'], '迁移候选顺序不正确');
    assert(preflight.targetValidations[0].status === 200 && preflight.targetValidations[0].body.valid === true, '候选0迁移后未通过V7严格校验');
    const invalid = preflight.targetValidations[1];
    assert(invalid.status === 200 && invalid.body.valid === false, '候选1迁移后没有被V7严格校验拒绝');
    assert(invalid.body.errors?.length === 1, `候选1目标错误数不是1：${JSON.stringify(invalid.body.errors)}`);
    const error = invalid.body.errors[0];
    assert(error.path === '/flow_relations/0/to_behavior_ref', `候选1错误路径不正确：${error.path}`);
    assert(error.keyword === 'localReference', `候选1错误关键字不正确：${error.keyword}`);
    assert(error.params?.ref === 'invalid-self-loop', `候选1错误引用不正确：${JSON.stringify(error.params)}`);
    assert(error.message === '流程关系的起点和终点不能相同', `候选1错误说明不正确：${error.message}`);
    assert(!error.rule_code, `候选1错误被错误标记为可兼容规则：${error.rule_code}`);
    assert(preflight.batch.allowed === false, '多候选目标批次被错误允许安装');
    assert(preflight.batch.failedIndex === 1, `批次失败候选索引不正确：${preflight.batch.failedIndex}`);
    assert(preflight.batch.repairableErrorCount === 0, '拒绝批次错误报告了可安装整改项');
  };

  const dispatchAtomicImport = () => page.locator('#jsonInput').evaluate(async (input, payload) => {
    const file = new File([payload.text], payload.name, {
      type: 'application/json',
      lastModified: payload.lastModified
    });
    globalThis.__multiCandidateAtomicFileProbe = file;
    const sha256 = await globalThis.GovernanceWorkflow.sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { name: file.name, size: file.size, lastModified: file.lastModified, sha256 };
  }, {
    name: 'multi-candidate-one-target-self-loop-v2.json',
    text: JSON.stringify(atomicRejectSource),
    lastModified: 1756166400000
  });

  const readAtomicFileProbe = () => page.evaluate(async () => {
    const file = globalThis.__multiCandidateAtomicFileProbe;
    if (!(file instanceof File)) return null;
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      sha256: await globalThis.GovernanceWorkflow.sha256Hex(new Uint8Array(await file.arrayBuffer()))
    };
  });

  const importAtomicAndAssertRejected = async () => {
    const fileBefore = await dispatchAtomicImport();
    await page.waitForFunction(() => {
      const status = document.querySelector('#statusBox');
      return status?.classList.contains('error')
        && status.textContent.includes('流程关系的起点和终点不能相同')
        && typeof busy !== 'undefined'
        && busy === false;
    }, null, { timeout: 15000 });
    const fileAfter = await readAtomicFileProbe();
    deepEqual(fileAfter, fileBefore, '失败导入前后File名称、大小、修改时间或SHA-256发生变化');
    assert(await page.locator('#jsonInput').evaluate(input => input.files?.length || 0) === 0, '失败导入后文件输入没有按设计清空');
    const candidateText = await page.locator('#governanceCandidateSelect option').allTextContents();
    assert(!candidateText.some(text => text.includes('有效候选') || text.includes('目标自环候选')), '失败批次有候选被部分安装到页面');
    atomicFileChecks.push({ ...fileAfter, inputFilesAfterFailure: 0, unchanged: true });
    return fileAfter;
  };

  const assertStateUnchanged = (before, after, label) => {
    deepEqual(after.candidates, before.candidates, `${label}：候选数组、JSON摘要、下载基线、未下载状态或图历史发生变化`);
    assert(after.currentIndex === before.currentIndex, `${label}：当前候选索引发生变化`);
    deepEqual(after.candidateSelect, before.candidateSelect, `${label}：候选下拉顺序或当前值发生变化`);
    deepEqual(after.navigation, before.navigation, `${label}：图模式或页面导航状态发生变化`);
    deepEqual(after.graph, before.graph, `${label}：图选择、视口或撤销重做按钮状态发生变化`);
    deepEqual(after.editSession, before.editSession, `${label}：未应用图属性工作副本发生变化`);
    deepEqual(after.webGrid, before.webGrid, `${label}：表格工作副本发生变化`);
    deepEqual(after.checkedGovernanceSteps, before.checkedGovernanceSteps, `${label}：已核对步骤发生变化`);
    assert(after.hasUnappliedChanges === before.hasUnappliedChanges, `${label}：未应用状态发生变化`);
    assert(after.hasUndownloadedChanges === before.hasUndownloadedChanges, `${label}：未下载状态发生变化`);
  };

  const verifyGraphHistoryContents = async expected => {
    await page.locator('#workspace [data-action="redo-graph"]').click();
    await page.locator('#pendingEditModal').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#discardPendingEditButton').click();
    await page.waitForFunction(() => {
      const state = graphHistoryState();
      return state.undoCount === 2 && state.redoCount === 0;
    }, null, { timeout: 10000 });
    assert(await shaCurrentDocument() === expected.afterSecondAddSha, '失败导入后重做记录没有恢复第二次新增节点后的JSON');
    await page.locator('#workspace [data-action="undo-graph"]').click();
    await page.waitForFunction(() => graphHistoryState().undoCount === 1, null, { timeout: 10000 });
    assert(await shaCurrentDocument() === expected.afterFirstAddSha, '失败导入后第一次撤销没有恢复第一次新增节点后的JSON');
    await page.locator('#workspace [data-action="undo-graph"]').click();
    await page.waitForFunction(() => graphHistoryState().undoCount === 0, null, { timeout: 10000 });
    assert(await shaCurrentDocument() === expected.downloadedBaselineSha, '失败导入后第二次撤销没有恢复下载基线JSON');
  };

  const runGraphStateScenario = async () => {
    await prepareDownloadedBaseline();
    const expectedHistory = await prepareGraphScenario();
    const before = await capturePageState();
    assert(before.currentIndex === 1, '图场景没有停在候选1');
    assert(before.candidates.length === 2, '图场景基线候选数不是2');
    assert(before.candidates[1].dirty === true && before.candidates[1].lastDownload, '图场景没有同时形成未下载状态和下载基线');
    assert(before.graph.selection?.kind === 'behavior', '图场景没有形成非空业务行为选择');
    assert(before.graph.liveFlowViewport?.zoom === 0.82, `图场景没有保存非默认视口：${JSON.stringify(before.graph.liveFlowViewport)}`);
    assert(before.candidates[1].graphHistory.undoCount === 1 && before.candidates[1].graphHistory.redoCount === 1, '图场景撤销重做计数不正确');
    assert(before.editSession?.dirty === true, '图场景没有形成未应用图属性');
    assert(before.hasUnappliedChanges === true && before.hasUndownloadedChanges === true, '图场景没有形成未应用和未下载状态');
    await importAtomicAndAssertRejected();
    const after = await capturePageState();
    assertStateUnchanged(before, after, '图状态场景');
    assert(await page.locator('[data-graph-property="behavior_name"]').inputValue() === 'GRAPH-UNAPPLIED-CANARY-20260826', '失败导入后未应用图属性canary丢失');
    await verifyGraphHistoryContents(expectedHistory);
    record('图状态场景：候选、索引、JSON摘要、模式、选择、视口、撤销重做、未应用属性、未下载状态和下载基线均保持不变');
  };

  const prepareGridScenario = async () => {
    await openSkeletonDiagram();
    await addGraphNode(1);
    const jsonShaAfterGraphChange = await shaCurrentDocument();
    await page.evaluate(() => {
      diagramView.cy.zoom(0.76);
      diagramView.cy.pan({ x: 91, y: 64 });
      captureGraphViewport();
    });
    await page.locator('[data-action="switch-governance-step"][data-step="data"]').click();
    await page.locator('[data-action="switch-data-editing-mode"][data-mode="grid"]').click();
    const cell = page.locator('[data-grid-cell][data-grid-table-id="data_objects"][data-grid-column="data_name"]').first();
    await cell.waitFor({ state: 'visible', timeout: 5000 });
    await cell.fill('GRID-WORK-COPY-CANARY-20260826');
    await page.waitForFunction(() => Boolean(webGridSession?.isDirty()), null, { timeout: 5000 });
    assert(await shaCurrentDocument() === jsonShaAfterGraphChange, '表格未应用输入提前写入当前JSON');
    return { jsonShaAfterGraphChange, cell };
  };

  const runGridStateScenario = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#jsonInput', { state: 'attached' });
    await prepareDownloadedBaseline();
    const prepared = await prepareGridScenario();
    const before = await capturePageState();
    assert(before.currentIndex === 1, '表格场景没有停在候选1');
    assert(before.candidates[1].dirty === true && before.candidates[1].lastDownload, '表格场景没有同时形成未下载状态和下载基线');
    assert(before.candidates[1].graphHistory.undoCount === 1, '表格场景没有保留图历史');
    assert(before.webGrid?.dirty === true, '表格场景没有形成未应用工作副本');
    assert(before.hasUnappliedChanges === true && before.hasUndownloadedChanges === true, '表格场景没有形成未应用和未下载状态');
    await importAtomicAndAssertRejected();
    const after = await capturePageState();
    assertStateUnchanged(before, after, '表格工作副本场景');
    assert(await prepared.cell.inputValue() === 'GRID-WORK-COPY-CANARY-20260826', '失败导入后表格canary丢失');
    assert(await shaCurrentDocument() === prepared.jsonShaAfterGraphChange, '失败导入后当前JSON摘要发生变化');
    record('表格场景：工作副本、canary、JSON摘要、图历史、未下载状态和下载基线均保持不变');
  };

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForSelector('#jsonInput', { state: 'attached' });
  const preflight = await preflightAtomicSource();
  assertAtomicPreflight(preflight);
  record('源API校验通过；迁移后候选0有效，候选1只有一项非兼容自环错误，整批分类拒绝');

  await runGraphStateScenario();
  await runGridStateScenario();

  assert(pageErrors.length === 0, `浏览器页面异常：${pageErrors.join(' | ')}`);
  assert(consoleProblems.length === 0, `浏览器控制台存在warning/error：${consoleProblems.join(' | ')}`);
  const evidence = {
    passed: true,
    candidateSource: {
      schemaVersion: 'document-structured-output-v2',
      sourceValid: true,
      candidateCount: 2,
      validCandidateIndex: 0,
      rejectedCandidateIndex: 1,
      rejectedErrorPath: '/flow_relations/0/to_behavior_ref',
      rejectedErrorKeyword: 'localReference',
      rejectedErrorRef: 'invalid-self-loop',
      rejectedErrorCode: null,
      rejectedErrorCount: 1,
      batchAllowed: false,
      batchFailedIndex: 1,
      repairableErrorCount: 0
    },
    stateAssertions: {
      candidateArrayUnchanged: true,
      currentIndexUnchanged: true,
      candidateJsonHashesUnchanged: true,
      graphModeUnchanged: true,
      graphSelectionUnchanged: true,
      graphViewportUnchanged: true,
      undoRedoStateAndContentsUnchanged: true,
      graphEditSessionUnchanged: true,
      webGridCopyUnchanged: true,
      undownloadedStateUnchanged: true,
      lastDownloadBaselineUnchanged: true,
      noPartialCandidateInstalled: true,
      consoleProblems: consoleProblems.length,
      pageErrors: pageErrors.length
    },
    selectedFileChecks: atomicFileChecks,
    results
  };
  console.log(JSON.stringify(evidence, null, 2));
  return evidence;
}
