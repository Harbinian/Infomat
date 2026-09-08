async page => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const problems = [];
  const requests = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) problems.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  const runtime = await page.evaluate(() => ({agent:navigator.userAgent,scale:visualViewport.scale}));
  assert(/Edg\//.test(runtime.agent) && runtime.scale === 1, 'Use Microsoft Edge at 100% zoom');
  await page.setViewportSize({width:1699,height:828});
  await page.locator('#jsonInput').setInputFiles('artifacts/review-safety/fixture.json');
  await page.waitForFunction(() => !busy && Boolean(currentDocument()));
  const seed = await page.evaluate(() => clone(currentDocument()));
  const upload = async (value, name = 'review-safety.json') => page.evaluate(async payload => {
    await importJson(new File([JSON.stringify(payload.value)],payload.name,{type:'application/json'}));
  }, {value,name});
  const download = async action => {
    const pending = page.waitForEvent('download');
    await action();
    const file = await pending;
    const stream = await file.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString('utf8');
    return JSON.parse(content);
  };
  const dataTask = () => page.getByRole('tab',{name:/全流程数据与表单/}).click();
  const detail = page.locator('#reviewDetail');
  await dataTask();
  await page.getByRole('button',{name:'费用申请单',exact:true}).click();
  await page.getByRole('button',{name:'修改表单信息',exact:true}).click();
  await page.getByLabel('表单或记录名称',{exact:true}).fill('Explicitly discarded');
  await page.getByRole('button',{name:'放大详情',exact:true}).click();
  await page.getByRole('button',{name:'放弃修改并继续',exact:true}).click();
  assert(await detail.locator('[data-review-property]').count() === 0, 'Discard must return to a summary, never leave untracked inputs');
  await page.getByRole('button',{name:'修改表单信息',exact:true}).click();
  await page.getByLabel('表单或记录名称',{exact:true}).fill('第二次输入必须保留');
  await page.getByRole('button',{name:'恢复并排',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert(await page.getByLabel('表单或记录名称',{exact:true}).inputValue() === '第二次输入必须保留', 'Continue editing must preserve the new input');
  const saved = await download(async () => {
    await page.getByRole('button',{name:'保存当前草稿',exact:true}).click();
    await page.getByRole('button',{name:'应用修改并继续',exact:true}).click();
  });
  assert(saved.forms[0].form_name === '第二次输入必须保留', 'The actual downloaded bytes must contain the applied input');
  assert(await page.evaluate(() => !hasUnappliedChanges() && !currentEntry().dirty), 'Only the downloaded snapshot may be marked saved');
  await upload(saved);
  assert(await page.evaluate(() => currentDocument().forms[0].form_name) === saved.forms[0].form_name, 'Saved edits must reopen');

  const twoFields = JSON.parse(JSON.stringify(seed));
  twoFields.data_objects[0].fields.push({field_ref:'field_paid',field_name:'已支付金额',field_type:'金额',definition:'已支付部分的金额'});
  await upload(twoFields);
  await dataTask();
  await page.getByRole('button',{name:'费用申请',exact:true}).click();
  await detail.getByRole('button',{name:'已支付金额',exact:true}).click();
  await page.getByRole('button',{name:'修改对象字段定义',exact:true}).click();
  await page.getByLabel('对象字段名称',{exact:true}).fill('申请金额');
  await page.getByRole('button',{name:'应用修改',exact:true}).click();
  const invalidDownload = await download(() => page.getByRole('button',{name:'保存当前草稿',exact:true}).click());
  const beforeKey = await page.evaluate(() => candidateStateKey());
  await upload(invalidDownload);
  const recovered = await page.evaluate(async () => ({key:candidateStateKey(),data:clone(currentDocument()),valid:(await validateGraphDocument(currentDocument())).valid}));
  assert(recovered.key !== beforeKey, 'An invalid native draft must actually be installed, not leave the previous candidate');
  assert(JSON.stringify(recovered.data) === JSON.stringify(invalidDownload), 'Native draft recovery must not merge fields, normalize values or rewrite references');
  assert(!recovered.valid, 'Recovery must not turn validation failures into a pass');
  await dataTask();
  await page.getByRole('button',{name:'费用申请',exact:true}).click();
  await detail.locator('[data-action="review-open"][data-ref="field_paid"]').click();
  await page.getByRole('button',{name:'修改对象字段定义',exact:true}).click();
  await page.getByLabel('对象字段名称',{exact:true}).fill('已支付金额');
  await page.getByRole('button',{name:'应用修改',exact:true}).click();
  assert(await page.evaluate(async () => (await validateGraphDocument(currentDocument())).valid), 'The recovered field must remain editable for explicit repair');

  for (const change of [
    data => { data.forms[0].areas[0].items[0].data_field_ref = 'missing_field'; },
    data => { data.flow_relations[0].to_behavior_ref = data.flow_relations[0].from_behavior_ref; }
  ]) {
    const broken = JSON.parse(JSON.stringify(seed));
    change(broken);
    await upload(broken);
    const restored = await page.evaluate(() => clone(currentDocument()));
    assert(JSON.stringify(restored) === JSON.stringify(broken), 'Semantic errors must survive reopening without mutation');
    const again = await download(() => page.getByRole('button',{name:'保存当前草稿',exact:true}).click());
    broken.export_meta.exported_at = again.export_meta.exported_at;
    assert(JSON.stringify(again) === JSON.stringify(broken), 'Re-downloading a recovered draft must preserve all original facts');
    if (broken.flow_relations[0].from_behavior_ref === broken.flow_relations[0].to_behavior_ref) {
      await page.locator('.diagram-warning-button[data-focus-kind="relation"][data-focus-ref="flow_submit_review"]').scrollIntoViewIfNeeded();
      await page.screenshot({path:'artifacts/review-safety/self-loop-warning.png',fullPage:true});
      await page.locator('.diagram-warning-button[data-focus-kind="relation"][data-focus-ref="flow_submit_review"]').click();
      const editRelation = page.locator('[data-action="review-edit"][data-group="relation"]');
      if (await editRelation.isVisible()) await editRelation.click();
      await page.locator('[data-graph-property="to_behavior_ref"]').selectOption(seed.flow_relations[0].to_behavior_ref);
      await page.locator('[data-action="apply-flow-property"]').click();
      assert(await page.evaluate(async () => (await validateGraphDocument(currentDocument())).valid), 'A skipped self-loop must retain a working correction entry');
    }
  }

  await upload(seed);
  await dataTask();
  await page.getByRole('button',{name:'费用申请单',exact:true}).click();
  await page.waitForFunction(() => ensureStructureScoreState().status === 'ready');
  await page.getByRole('button',{name:'检查本轮',exact:true}).click();
  const checked = await page.evaluate(() => ({count:governanceReviewQueueManager.get(candidateStateKey()).total,view:activeStepView}));
  assert(checked.count > 0 && checked.view === 'detail', 'The fixture must produce real issues in the detail view');
  assert(await page.locator('.governance-queue').isVisible(), 'Detail views must show the actual check queue');
  assert(await page.locator('[data-governance-queue-focus]').isVisible(), 'The detail check queue must expose its correction action');
  await page.screenshot({path:'artifacts/review-safety/detail-check-queue.png',fullPage:true});

  await page.getByRole('button',{name:'修改表单信息',exact:true}).click();
  await page.getByLabel('表单或记录名称',{exact:true}).fill('Failed import must preserve this input');
  const stateBefore = await page.evaluate(() => ({key:candidateStateKey(),data:clone(currentDocument()),session:editSessionManager.get(),target:reviewTarget()}));
  await upload({...seed,data_objects:null},'malformed-shape.json');
  const stateAfter = await page.evaluate(() => ({key:candidateStateKey(),data:clone(currentDocument()),session:editSessionManager.get(),target:reviewTarget()}));
  assert(JSON.stringify(stateBefore) === JSON.stringify(stateAfter), 'Rejected file must preserve the current document, target and unapplied input');
  const ambiguous = JSON.parse(JSON.stringify(seed));
  ambiguous.behaviors[1].behavior_ref = ambiguous.behaviors[0].behavior_ref;
  await upload(ambiguous,'duplicate-identities.json');
  assert(JSON.stringify(stateBefore) === JSON.stringify(await page.evaluate(() => ({key:candidateStateKey(),data:clone(currentDocument()),session:editSessionManager.get(),target:reviewTarget()}))), 'Ambiguous identities must be rejected without changing the current editor');
  assert(await page.getByLabel('表单或记录名称',{exact:true}).inputValue() === 'Failed import must preserve this input', 'Rejected file must keep the visible input');
  await page.getByRole('button',{name:'返回摘要',exact:true}).click();
  await page.getByRole('button',{name:'放弃修改并继续',exact:true}).click();
  const viewports = [];
  for (const [width,height] of [[1920,1080],[1920,900],[1699,828],[1536,864],[1280,720]]) {
    await page.setViewportSize({width,height});
    const geometry = await page.evaluate(() => ({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth > innerWidth + 1,workspaceOverflow:workspace.scrollWidth > workspace.clientWidth + 1}));
    assert(!geometry.overflow && !geometry.workspaceOverflow, 'Check results must not create horizontal overflow: '+JSON.stringify(geometry));
    viewports.push(geometry);
  }
  const storage = await page.evaluate(async () => ({local:localStorage.length,session:sessionStorage.length,databases:(await indexedDB.databases()).length}));
  assert(Object.values(storage).every(value => value === 0), 'Browser business storage must stay empty');
  assert(!await page.evaluate(urls => urls.some(url => new URL(url).port === '3000'), requests), 'The editor must not call 3000');
  assert(problems.length === 0, 'Browser errors: '+problems.join('; '));
  return {passed:true,checks:['discard and resume','pending apply download','native error recovery and explicit repair','failed import atomicity','visible detail checks','viewport overflow','stateless boundary'],viewports,storage};
}
