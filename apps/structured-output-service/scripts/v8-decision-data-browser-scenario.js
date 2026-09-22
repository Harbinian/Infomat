// Run with Playwright CLI run-code --filename after importing a V7 decision/use copy into an isolated V8 service.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if(message.type()==='error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1699, height: 828 });
  const initial = await page.evaluate(() => JSON.parse(JSON.stringify(currentDocument())));
  assert(initial?.schema_version === 'process-governance-v8', 'Import must upgrade to V8');
  const proof = initial.data_objects.find(d => d.data_name === '软件合格证明');
  const basis = proof.behavior_links.find(l => initial.behaviors.find(b => b.behavior_ref === l.behavior_ref)?.node_type === 'decision');
  assert(basis?.operation === 'use', 'Decision basis must survive import');
  const dataRef = proof.data_ref, behaviorRef = basis.behavior_ref;
  await page.getByRole('tab', { name: /全流程数据与表单/ }).click();
  await page.getByRole('button', { name: '整理数据对象与关联', exact: true }).click();
  await page.getByRole('combobox', {name:/当前数据对象/}).selectOption(dataRef);
  await page.waitForFunction(() => dataDiagramView?.cy?.nodes().length > 1);
  const geometry = await page.evaluate(({dataRef,behaviorRef}) => {
    const cy = dataDiagramView.cy;
    const edge = cy.edges().filter(e => e.data('behaviorRef') === behaviorRef)[0];
    if(!edge) throw new Error('Decision use edge missing');
    if(edge.data('source') !== `data:${dataRef}` || edge.data('target') !== `behavior:${behaviorRef}`) throw new Error('Wrong use arrow direction');
    if(!edge.data('label').includes('判断依据')) throw new Error('Missing basis label');
    const boxes=cy.nodes().map(n=>n.boundingBox());
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j]; if(a.x1<b.x2 && a.x2>b.x1 && a.y1<b.y2 && a.y2>b.y1) throw new Error('Data graph nodes overlap');
    }
    return {nodes:cy.nodes().length,edges:cy.edges().length};
  },{dataRef,behaviorRef});
  const canvas = page.getByRole('application',{name:'当前数据对象的直接关系图'});
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({path:'E:/CA001/Infomat/artifacts/decision-use-v8/verified-data-graph.png'});
  const clickPoint = await page.evaluate(behaviorRef => {
    const cy=dataDiagramView.cy, node=cy.getElementById(`behavior:${behaviorRef}`), p=node.renderedPosition(), r=cy.container().getBoundingClientRect();
    return {x:r.left+p.x,y:r.top+p.y};
  },behaviorRef);
  await page.mouse.click(clickPoint.x,clickPoint.y);
  await page.locator('[data-graph-data-operation][value="use"]').waitFor();
  assert(await page.locator('[data-graph-data-operation][value="use"]').isChecked(),'Graph click must select use relationship');
  await page.locator('[data-graph-data-operation][value="create"]').check();
  await page.getByRole('button',{name:'应用数据操作',exact:true}).click();
  assert(await page.locator('[data-graph-data-operation][value="create"]').isChecked(),'Rejected selection must remain visible');
  assert(await page.evaluate(snapshot=>JSON.stringify(currentDocument())===JSON.stringify(snapshot),initial),'Invalid operation must not mutate JSON');
  assert((await page.locator('body').innerText()).includes('判断节点仅允许'),'Actionable decision error required');
  await page.getByRole('button',{name:'保存当前草稿',exact:true}).click();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();
  assert(await page.locator('[data-graph-data-operation][value="create"]').isChecked(),'Continue editing must preserve pending input');
  await page.locator('[data-graph-data-operation][value="create"]').uncheck();
  await page.locator('[data-graph-data-operation][value="update"]').check();
  assert(await page.locator('[data-graph-data-operation][value="update"]').isChecked(),'Update selection must be preserved');
  assert(await page.evaluate(snapshot=>JSON.stringify(currentDocument())===JSON.stringify(snapshot),initial),'Unsupported update must not mutate JSON');
  await page.locator('[data-graph-data-operation][value="update"]').uncheck();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'保存当前草稿',exact:true}).click();
  const download=await downloadPromise, stream=await download.createReadStream(); let content='';for await(const chunk of stream)content+=chunk.toString();
  const downloaded=JSON.parse(content);
  const expected=JSON.parse(JSON.stringify(initial));expected.export_meta.exported_at=downloaded.export_meta.exported_at;
  assert(JSON.stringify(expected)===JSON.stringify(downloaded),'Download must preserve business data and stable IDs');
  await page.locator('#jsonInput').evaluate((input,payload)=>{const transfer=new DataTransfer();transfer.items.add(new File([payload], 'v8-roundtrip.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));},content);
  await page.waitForFunction(expected=>JSON.stringify(currentDocument())===JSON.stringify(expected),downloaded);
  assert(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),'No browser persistence');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Horizontal overflow');
  assert(errors.length===0,`Browser errors: ${errors.join(';')}`);
  console.log(JSON.stringify({passed:true,geometry,download:download.suggestedFilename(),checks:['import','real-canvas-selection','arrow','geometry','create-rejected-input-retained','update-input-retained','pending-download-guard','download-reimport','no-browser-storage','no-horizontal-overflow']}));
}
