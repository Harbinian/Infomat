async page => {
  const consoleProblems = [];
  const pageErrors = [];
  const requestUrls = [];
  const results = {
    environment: {},
    fixture: {},
    samples_ms: {
      first_display: [],
      flow_to_data: [],
      data_to_flow: [],
      selection: [],
      graph_command: [],
      merge_200_fields: [],
      download_reimport: []
    },
    medians_ms: {},
    long_tasks_over_1000: [],
    raf_gaps_over_1000: [],
    console_problems: consoleProblems,
    page_errors: pageErrors,
    unexpected_requests: [],
    passed: false
  };

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const median = values => {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.floor(ordered.length / 2)];
  };
  const round = value => Number(value.toFixed(2));

  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requestUrls.push(request.url()));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'networkidle' });
  const frameSchedulerSamples = await page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      samples.push(performance.now() - startedAt);
    }
    return samples;
  });
  const frameSchedulerMedian = median(frameSchedulerSamples);
  assert(
    frameSchedulerMedian <= 250,
    `浏览器绘制帧调度受到后台限频或远程会话影响：两个绘制帧中位数${round(frameSchedulerMedian)}ms。请保持有头浏览器前台，或使用默认无头模式重新执行。`
  );

  const fixtureResult = await page.evaluate(async () => {
    const requiredFunctions = {
      importJson,
      setActiveGovernanceStep,
      currentDocument,
      currentEntry,
      runGraphCommand,
      mergeCurrentDataObjects
    };
    Object.entries(requiredFunctions).forEach(([name, value]) => {
      if (typeof value !== 'function') throw new Error(`页面缺少性能测试所需函数：${name}`);
    });
    if (typeof globalThis.ProcessGovernanceMigration?.pendingLifecycle !== 'function') {
      throw new Error('页面缺少V7生命周期夹具函数。');
    }
    if (typeof globalThis.DataRelationDiagram?.buildModel !== 'function') {
      throw new Error('页面缺少数据关系图模型函数。');
    }

    const templateResponse = await fetch('/api/template?version=process-governance-v7');
    const templateBody = await templateResponse.json();
    if (!templateResponse.ok || !templateBody.data) {
      throw new Error(`无法取得V7空白模板：${JSON.stringify(templateBody)}`);
    }
    const fixture = JSON.parse(JSON.stringify(templateBody.data));
    fixture.export_meta.package_ref = 'package_v7_browser_performance';
    fixture.export_meta.exported_at = '2026-08-26T00:00:00.000Z';
    fixture.export_meta.initiating_department = '财务部';
    fixture.export_meta.compiler = '浏览器性能自动化';
    fixture.process = {
      process_ref: 'process_v7_browser_performance',
      process_name: 'V7浏览器固定大样本性能流程',
      owning_department: '财务部',
      purpose: '验证3001固定大样本的真实浏览器性能',
      scope: '仅用于独立测试端口的页面内存自动化',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    };

    fixture.behaviors = Array.from({ length: 40 }, (_value, index) => {
      const number = index + 1;
      return {
        behavior_ref: `behavior_perf_${number}`,
        node_type: 'action',
        behavior_name: `包含较长名称的代表性业务行为${number}`,
        behavior_description: `用于固定性能样本的业务行为${number}`,
        current_actor_role: ['财务部会计员', '质量管理部检验员', '工程技术部研发员'][index % 3],
        actor_assignment_mode: 'fixed_department',
        actor_department_data_ref: null,
        actor_position_rule: '',
        trigger: number === 1 ? '收到性能样本输入' : '',
        precondition: '',
        input_description: '',
        timing: null,
        completion_standard: `业务行为${number}已经完成`,
        output_description: '',
        countersign_all_required: false,
        countersign_target_departments: []
      };
    });

    fixture.flow_relations = [];
    for (let index = 1; index <= 39; index += 1) {
      fixture.flow_relations.push({
        relation_ref: `relation_perf_sequence_${index}`,
        relation_type: 'sequence',
        from_behavior_ref: `behavior_perf_${index}`,
        to_behavior_ref: `behavior_perf_${index + 1}`,
        condition: ''
      });
    }
    for (let index = 1; index <= 39; index += 1) {
      fixture.flow_relations.push({
        relation_ref: `relation_perf_return_${index}`,
        relation_type: 'loop',
        from_behavior_ref: `behavior_perf_${index + 1}`,
        to_behavior_ref: `behavior_perf_${Math.max(1, index - 2)}`,
        condition: `代表性返回条件${index}`
      });
    }
    fixture.flow_relations.push({
      relation_ref: 'relation_perf_remote_1',
      relation_type: 'condition',
      from_behavior_ref: 'behavior_perf_1',
      to_behavior_ref: 'behavior_perf_40',
      condition: '满足远端条件一'
    });
    fixture.flow_relations.push({
      relation_ref: 'relation_perf_remote_2',
      relation_type: 'parallel',
      from_behavior_ref: 'behavior_perf_2',
      to_behavior_ref: 'behavior_perf_39',
      condition: ''
    });

    let fieldNumber = 0;
    fixture.data_objects = Array.from({ length: 30 }, (_value, index) => {
      const number = index + 1;
      const fieldCount = number <= 20 ? 7 : 6;
      const fields = Array.from({ length: fieldCount }, () => {
        fieldNumber += 1;
        return {
          field_ref: `data_field_perf_${fieldNumber}`,
          field_name: `代表性数据字段${fieldNumber}`,
          field_type: '文本',
          definition: `固定性能样本数据字段${fieldNumber}`
        };
      });
      const creatorNumber = (index * 2) % 40 + 1;
      const consumerNumber = (index * 2 + 1) % 40 + 1;
      const updateFieldRef = fields[0].field_ref;
      return {
        data_ref: `data_perf_${number}`,
        data_name: number <= 2 ? '可归并的同名数据' : `代表性数据对象${number}`,
        description: number <= 2 ? `归并对象说明${number}` : `数据对象${number}说明`,
        information_type: 'business_information',
        fields,
        behavior_links: [
          {
            link_ref: `data_link_perf_${number}_create`,
            behavior_ref: `behavior_perf_${creatorNumber}`,
            operation: 'create',
            updated_field_refs: []
          },
          {
            link_ref: `data_link_perf_${number}_creator_update`,
            behavior_ref: `behavior_perf_${creatorNumber}`,
            operation: 'update',
            updated_field_refs: [updateFieldRef]
          },
          {
            link_ref: `data_link_perf_${number}_consumer_update`,
            behavior_ref: `behavior_perf_${consumerNumber}`,
            operation: 'update',
            updated_field_refs: [updateFieldRef]
          },
          {
            link_ref: `data_link_perf_${number}_use`,
            behavior_ref: `behavior_perf_${consumerNumber}`,
            operation: 'use',
            updated_field_refs: []
          }
        ],
        source_relations: [],
        lifecycle: globalThis.ProcessGovernanceMigration.pendingLifecycle()
      };
    });
    fixture.data_objects[1].behavior_links[0].behavior_ref = fixture.data_objects[0].behavior_links[0].behavior_ref;
    fixture.data_objects[1].behavior_links[1].behavior_ref = fixture.data_objects[0].behavior_links[0].behavior_ref;

    const fieldCatalog = fixture.data_objects.flatMap(dataObject =>
      dataObject.fields.map(dataField => ({ dataObject, dataField }))
    );
    fixture.forms = Array.from({ length: 10 }, (_value, formIndex) => ({
      form_ref: `form_perf_${formIndex + 1}`,
      form_name: `代表性表单${formIndex + 1}`,
      form_no: null,
      form_design_state: 'current_state',
      behavior_links: [{
        link_ref: `form_link_perf_${formIndex + 1}`,
        behavior_ref: `behavior_perf_${formIndex + 1}`,
        operations: ['fill'],
        notes: ''
      }],
      areas: [{
        area_ref: `form_area_perf_${formIndex + 1}`,
        area_type: '基本信息',
        area_title: '',
        items: Array.from({ length: 20 }, (_fieldValue, itemIndex) => {
          const formFieldNumber = formIndex * 20 + itemIndex + 1;
          const { dataObject, dataField } = fieldCatalog[formFieldNumber - 1];
          return {
            item_ref: `form_item_perf_${formFieldNumber}`,
            item_name: `代表性表单字段${formFieldNumber}`,
            item_type: '文本',
            required: formFieldNumber % 3 === 0,
            instructions: '',
            business_data_ref: dataObject.data_ref,
            data_field_ref: dataField.field_ref,
            value_usage_mode: 'reuse_existing',
            value_origin_mode: 'depends_on_data',
            source_links: [{
              source_link_ref: `field_source_perf_${formFieldNumber}`,
              source_type: 'process_data',
              source_data_ref: dataObject.data_ref,
              source_system_name: '',
              source_data_name: '',
              source_role: 'provides_value'
            }]
          };
        })
      }]
    }));
    fixture.terms = [];

    const validationResponse = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: fixture })
    });
    const validationBody = await validationResponse.json();
    if (!validationResponse.ok || validationBody.valid !== true) {
      throw new Error(`固定性能样本未通过严格校验：${JSON.stringify(validationBody.errors || validationBody)}`);
    }

    const visibleDataEdges = fixture.data_objects.reduce(
      (count, item) => count + globalThis.DataRelationDiagram.buildModel(fixture, item.data_ref).edges.length,
      0
    );
    const summary = {
      behaviors: fixture.behaviors.length,
      flow_relations: fixture.flow_relations.length,
      data_objects: fixture.data_objects.length,
      data_operations: fixture.data_objects.flatMap(item => item.behavior_links).length,
      visible_data_edges: visibleDataEdges,
      forms: fixture.forms.length,
      data_fields: fixture.data_objects.flatMap(item => item.fields).length,
      form_items: fixture.forms.flatMap(form => form.areas.flatMap(area => area.items)).length,
      strict_validation: true
    };
    globalThis.__v7PerfFixture = fixture;
    globalThis.__v7PerfObserverState = {
      longTasks: [],
      rafGaps: [],
      previousFrame: performance.now(),
      active: true
    };
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      globalThis.__v7PerfLongTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          globalThis.__v7PerfObserverState.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      globalThis.__v7PerfLongTaskObserver.observe({ type: 'longtask', buffered: false });
    }
    const frameTick = timestamp => {
      const state = globalThis.__v7PerfObserverState;
      if (!state?.active) return;
      const gap = timestamp - state.previousFrame;
      if (gap > 0) state.rafGaps.push({ startTime: state.previousFrame, duration: gap });
      state.previousFrame = timestamp;
      requestAnimationFrame(frameTick);
    };
    requestAnimationFrame(frameTick);
    return summary;
  });

  results.fixture = fixtureResult;
  assert(fixtureResult.behaviors === 40, `行为数量错误：${fixtureResult.behaviors}`);
  assert(fixtureResult.flow_relations === 80, `流程关系数量错误：${fixtureResult.flow_relations}`);
  assert(fixtureResult.data_objects === 30, `数据对象数量错误：${fixtureResult.data_objects}`);
  assert(fixtureResult.data_operations === 120, `数据操作数量错误：${fixtureResult.data_operations}`);
  assert(fixtureResult.visible_data_edges >= 60, `可见数据边不足：${fixtureResult.visible_data_edges}`);
  assert(fixtureResult.forms === 10, `表单数量错误：${fixtureResult.forms}`);
  assert(fixtureResult.data_fields === 200, `数据对象字段数量错误：${fixtureResult.data_fields}`);
  assert(fixtureResult.form_items === 200, `表单字段数量错误：${fixtureResult.form_items}`);

  const resetFixture = async () => {
    const reset = await page.evaluate(async () => {
      const payload = JSON.stringify(globalThis.__v7PerfFixture);
      const file = new File([payload], 'v7-browser-performance.json', { type: 'application/json' });
      await importJson(file);
      return {
        candidateCount: candidates.length,
        behaviorCount: currentDocument()?.behaviors?.length,
        dataObjectCount: currentDocument()?.data_objects?.length,
        busy,
        status: document.querySelector('#statusBox')?.textContent || ''
      };
    });
    assert(reset.candidateCount === 1, `性能样本重置后候选数量错误：${JSON.stringify(reset)}`);
    assert(reset.behaviorCount === 40, `性能样本重置后行为数量错误：${JSON.stringify(reset)}`);
    assert(reset.dataObjectCount === 30, `性能样本重置后数据对象数量错误：${JSON.stringify(reset)}`);
    assert(reset.busy === false, '性能样本重置完成后页面仍处于忙碌状态。');
  };

  const twoFrames = () => page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const measureFirstDisplay = async () => {
    await resetFixture();
    await page.evaluate(() => setActiveGovernanceStep('start', 'overview', { skipPendingGuard: true }));
    return page.evaluate(async () => {
      const waitUntil = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          if (predicate()) return resolve();
          if (performance.now() - startedAt > timeout) return reject(new Error('流程图真实绘制超时。'));
          requestAnimationFrame(check);
        };
        check();
      });
      const button = document.querySelector('[data-action="switch-governance-step"][data-step="skeleton"]');
      if (!button) throw new Error('未找到流程骨架步骤按钮。');
      const startedAt = performance.now();
      button.click();
      await waitUntil(() => diagramView?.cy && diagramView.cy.nodes('.behavior-node').length === 40);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    });
  };

  const prepareFlowDiagram = async () => {
    await resetFixture();
    await page.evaluate(() => setActiveGovernanceStep('skeleton', 'diagram', { skipPendingGuard: true }));
    await page.waitForFunction(() => diagramView?.cy && diagramView.cy.nodes('.behavior-node').length === 40);
    await twoFrames();
  };

  const measureFlowToData = async () => {
    await prepareFlowDiagram();
    await page.evaluate(() => { activeDataRef = 'data_perf_1'; });
    return page.evaluate(async () => {
      const waitUntil = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          if (predicate()) return resolve();
          if (performance.now() - startedAt > timeout) return reject(new Error('数据关系图真实绘制超时。'));
          requestAnimationFrame(check);
        };
        check();
      });
      const button = document.querySelector('[data-action="switch-governance-step"][data-step="data"]');
      if (!button) throw new Error('未找到数据步骤按钮。');
      const startedAt = performance.now();
      button.click();
      await waitUntil(() => dataDiagramView?.cy && dataDiagramView.model?.dataRef === 'data_perf_1');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    });
  };

  const measureDataToFlow = async () => {
    await resetFixture();
    await page.evaluate(() => {
      activeDataRef = 'data_perf_1';
      setActiveGovernanceStep('data', 'data', { skipPendingGuard: true });
    });
    await page.waitForFunction(() => dataDiagramView?.cy && dataDiagramView.model?.dataRef === 'data_perf_1');
    await twoFrames();
    return page.evaluate(async () => {
      const waitUntil = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          if (predicate()) return resolve();
          if (performance.now() - startedAt > timeout) return reject(new Error('流程关系图重新绘制超时。'));
          requestAnimationFrame(check);
        };
        check();
      });
      const button = document.querySelector('[data-action="switch-governance-step"][data-step="skeleton"]');
      if (!button) throw new Error('未找到流程骨架步骤按钮。');
      const startedAt = performance.now();
      button.click();
      await waitUntil(() => diagramView?.cy && diagramView.cy.nodes('.behavior-node').length === 40);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    });
  };

  const measureSelection = async runIndex => {
    await prepareFlowDiagram();
    return page.evaluate(async index => {
      const targetRef = `behavior_perf_${20 + index}`;
      const target = diagramView?.cy?.nodes('.behavior-node').filter(node => node.data('focusRef') === targetRef).first();
      if (!target || target.empty()) throw new Error(`流程图没有目标节点：${targetRef}`);
      const startedAt = performance.now();
      target.emit('tap');
      await new Promise((resolve, reject) => {
        const waitStartedAt = performance.now();
        const check = () => {
          const propertyInput = document.querySelector('[data-graph-property="behavior_name"]');
          if (graphSelection?.ref === targetRef && propertyInput) return resolve();
          if (performance.now() - waitStartedAt > 2000) return reject(new Error(`选择节点后属性区未显示：${targetRef}`));
          requestAnimationFrame(check);
        };
        check();
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    }, runIndex);
  };

  const measureGraphCommand = async runIndex => {
    await prepareFlowDiagram();
    return page.evaluate(async index => {
      const behaviorRef = `behavior_perf_command_${index}`;
      const startedAt = performance.now();
      const applied = await runGraphCommand({
        type: 'add_behavior',
        behavior: {
          behavior_ref: behaviorRef,
          node_type: 'action',
          behavior_name: `性能命令节点${index}`,
          behavior_description: '用于真实浏览器图命令计时',
          current_actor_role: '财务部会计员',
          actor_assignment_mode: 'fixed_department',
          actor_department_data_ref: null,
          actor_position_rule: '',
          trigger: '',
          precondition: '',
          input_description: '',
          timing: null,
          completion_standard: '性能命令已经完成',
          output_description: '',
          countersign_all_required: false,
          countersign_target_departments: []
        }
      }, { successLabel: '真实浏览器性能命令已完成' });
      if (!applied) throw new Error('真实浏览器图命令未执行。');
      await new Promise((resolve, reject) => {
        const waitStartedAt = performance.now();
        const check = () => {
          if (currentDocument()?.behaviors?.length === 41 && diagramView?.cy?.nodes('.behavior-node').length === 41) return resolve();
          if (performance.now() - waitStartedAt > 3000) return reject(new Error('图命令完成后流程图未显示41个行为节点。'));
          requestAnimationFrame(check);
        };
        check();
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - startedAt;
    }, runIndex);
  };

  const measureMerge = async () => {
    await resetFixture();
    await page.evaluate(() => {
      activeDataRef = 'data_perf_1';
      setActiveGovernanceStep('data', 'data', { skipPendingGuard: true });
    });
    await page.waitForFunction(() => dataDiagramView?.cy && dataDiagramView.model?.dataRef === 'data_perf_1');
    await twoFrames();
    return page.evaluate(async () => {
      const originalConfirm = window.confirm;
      const originalPrompt = window.prompt;
      window.confirm = () => true;
      window.prompt = () => '0';
      try {
        const startedAt = performance.now();
        const applied = await mergeCurrentDataObjects();
        if (!applied) throw new Error('同名数据归并未执行。');
        await new Promise((resolve, reject) => {
          const waitStartedAt = performance.now();
          const check = () => {
            const dataFieldCount = currentDocument()?.data_objects?.flatMap(item => item.fields || []).length;
            const formItems = currentDocument()?.forms?.flatMap(form => form.areas.flatMap(area => area.items)) || [];
            const staleRefs = formItems.filter(item => item.business_data_ref === 'data_perf_2'
              || item.source_links?.some(link => link.source_data_ref === 'data_perf_2')).length;
            if (currentDocument()?.data_objects?.length === 29
              && dataFieldCount === 200
              && formItems.length === 200
              && staleRefs === 0
              && dataDiagramView?.cy) return resolve();
            if (performance.now() - waitStartedAt > 5000) return reject(new Error('归并后对象、字段或表单引用未在期限内稳定。'));
            requestAnimationFrame(check);
          };
          check();
        });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - startedAt;
      } finally {
        window.confirm = originalConfirm;
        window.prompt = originalPrompt;
      }
    });
  };

  const measureDownloadReimport = async () => {
    await resetFixture();
    await page.evaluate(() => setActiveGovernanceStep('skeleton', 'diagram', { skipPendingGuard: true }));
    await page.waitForFunction(() => diagramView?.cy && diagramView.cy.nodes('.behavior-node').length === 40);
    await twoFrames();
    await page.evaluate(() => { globalThis.__v7RoundtripStartedAt = performance.now(); });
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.locator('#governanceHeader [data-action="download-current-stage"]').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString('utf8');
    const downloadedDocument = JSON.parse(content);
    assert(downloadedDocument.schema_version === 'process-governance-v7', '阶段下载没有生成V7 JSON。');
    await page.locator('#jsonInput').evaluate((input, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.text], payload.name, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name: download.suggestedFilename(), text: content });
    await page.waitForFunction(() => !busy && candidates.length === 1
      && currentDocument()?.behaviors?.length === 40
      && currentEntry()?.importInfo?.sha256);
    const measurement = await page.evaluate(async textValue => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bytes = new TextEncoder().encode(textValue);
      const expectedSha256 = await globalThis.GovernanceWorkflow.sha256Hex(bytes);
      return {
        duration: performance.now() - globalThis.__v7RoundtripStartedAt,
        expectedSha256,
        importedSha256: currentEntry()?.importInfo?.sha256 || ''
      };
    }, content);
    assert(measurement.importedSha256 === measurement.expectedSha256, '重导入文件摘要与下载内容不一致。');
    return measurement.duration;
  };

  await measureFirstDisplay();
  await measureFlowToData();
  await measureDataToFlow();
  await measureSelection(0);
  await measureGraphCommand(0);
  await measureMerge();
  await measureDownloadReimport();

  for (let index = 1; index <= 3; index += 1) {
    results.samples_ms.first_display.push(round(await measureFirstDisplay()));
    results.samples_ms.flow_to_data.push(round(await measureFlowToData()));
    results.samples_ms.data_to_flow.push(round(await measureDataToFlow()));
    results.samples_ms.selection.push(round(await measureSelection(index)));
    results.samples_ms.graph_command.push(round(await measureGraphCommand(index)));
    results.samples_ms.merge_200_fields.push(round(await measureMerge()));
    results.samples_ms.download_reimport.push(round(await measureDownloadReimport()));
  }

  Object.entries(results.samples_ms).forEach(([key, values]) => {
    results.medians_ms[key] = round(median(values));
  });
  results.medians_ms.mode_switch = round(Math.max(
    results.medians_ms.flow_to_data,
    results.medians_ms.data_to_flow
  ));

  const observerResult = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = globalThis.__v7PerfObserverState || { longTasks: [], rafGaps: [] };
    state.active = false;
    globalThis.__v7PerfLongTaskObserver?.disconnect();
    return {
      longTasks: state.longTasks.filter(item => item.duration > 1000),
      rafGaps: state.rafGaps.filter(item => item.duration > 1000)
    };
  });
  results.long_tasks_over_1000 = observerResult.longTasks.map(item => ({
    start_ms: round(item.startTime),
    duration_ms: round(item.duration)
  }));
  results.raf_gaps_over_1000 = observerResult.rafGaps.map(item => ({
    start_ms: round(item.startTime),
    duration_ms: round(item.duration)
  }));

  const currentOrigin = await page.evaluate(() => location.origin);
  results.unexpected_requests = [...new Set(requestUrls.filter(url => {
    const relativeUrl = url.startsWith(currentOrigin) ? url.slice(currentOrigin.length) : '';
    return !relativeUrl
      || ['/api/session', '/api/data', '/api/export'].some(path => relativeUrl.startsWith(path));
  }))];
  results.environment = await page.evaluate(() => ({
    url: location.href,
    viewport: `${innerWidth}x${innerHeight}`,
    user_agent: navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency,
    platform: navigator.platform
  }));
  results.environment.frame_scheduler_two_frames_samples_ms = frameSchedulerSamples.map(round);
  results.environment.frame_scheduler_two_frames_median_ms = round(frameSchedulerMedian);

  results.gates = {
    first_display: results.medians_ms.first_display <= 2000,
    mode_switch: results.medians_ms.mode_switch <= 2000,
    selection: results.medians_ms.selection <= 300,
    graph_command: results.medians_ms.graph_command <= 1000,
    merge_200_fields: results.medians_ms.merge_200_fields <= 2000,
    download_reimport: results.medians_ms.download_reimport <= 3000,
    no_long_task_over_1000: results.long_tasks_over_1000.length === 0,
    no_raf_gap_over_1000: results.raf_gaps_over_1000.length === 0,
    console_clean: consoleProblems.length === 0,
    page_errors_empty: pageErrors.length === 0,
    network_boundary: results.unexpected_requests.length === 0
  };
  results.passed = Object.values(results.gates).every(Boolean);
  console.log(`V7_BROWSER_PERFORMANCE_RESULT=${JSON.stringify(results)}`);

  assert(results.gates.first_display, `首次显示中位数超限：${results.medians_ms.first_display}ms`);
  assert(results.gates.mode_switch, `模式切换中位数超限：${results.medians_ms.mode_switch}ms`);
  assert(results.gates.selection, `选择中位数超限：${results.medians_ms.selection}ms`);
  assert(results.gates.graph_command, `图命令中位数超限：${results.medians_ms.graph_command}ms`);
  assert(results.gates.merge_200_fields, `200字段归并中位数超限：${results.medians_ms.merge_200_fields}ms`);
  assert(results.gates.download_reimport, `下载并重新导入中位数超限：${results.medians_ms.download_reimport}ms`);
  assert(results.gates.no_long_task_over_1000, `出现超过1秒的Long Task：${JSON.stringify(results.long_tasks_over_1000)}`);
  assert(results.gates.no_raf_gap_over_1000, `出现超过1秒的绘制帧间隔：${JSON.stringify(results.raf_gaps_over_1000)}`);
  assert(results.gates.console_clean, `控制台出现warning/error：${JSON.stringify(consoleProblems)}`);
  assert(results.gates.page_errors_empty, `页面出现未处理错误：${JSON.stringify(pageErrors)}`);
  assert(results.gates.network_boundary, `页面请求了3000、禁用接口或外部资源：${JSON.stringify(results.unexpected_requests)}`);
  return results;
}
