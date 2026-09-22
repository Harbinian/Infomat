async page => {
 const assert=(v,m)=>{if(!v)throw new Error(m);};
 const initial=await page.evaluate(()=>JSON.parse(JSON.stringify(currentDocument())));
 const decision=initial.behaviors.find(b=>b.node_type==='decision');const report=initial.data_objects.find(d=>d.data_name==='合格报告');
 await page.getByRole('tab',{name:/全流程数据与表单/}).click();
 await page.getByRole('button',{name:'整理数据对象与关联',exact:true}).click();
 await page.getByRole('combobox',{name:/当前数据对象/}).selectOption(report.data_ref);
 await page.getByRole('button',{name:'建立数据关系',exact:true}).click();
 await page.locator('[data-graph-data-behavior]').selectOption(decision.behavior_ref);
 await page.getByRole('button',{name:'继续',exact:true}).click();
 await page.locator('[data-graph-data-operation][value="use"]').check();
 await page.getByRole('button',{name:'应用数据操作',exact:true}).click();
 const added=await page.evaluate(()=>JSON.parse(JSON.stringify(currentDocument())));
 assert(added.behaviors.length===initial.behaviors.length && added.data_objects.length===initial.data_objects.length,'No auto-created objects or steps');
 const link=added.data_objects.find(d=>d.data_ref===report.data_ref).behavior_links.find(l=>l.behavior_ref===decision.behavior_ref);
 assert(link?.operation==='use' && link.link_ref,'Wizard must add decision use with stable ID');
 await page.getByRole('button',{name:'转到流程骨架',exact:true}).click();
 await page.locator('[data-action="review-edit"]').first().click();
 await page.locator('[data-graph-property="node_type"]').selectOption('parallel_split');
 await page.locator('[data-action="apply-flow-property"]').click();
 assert(await page.locator('[data-graph-property="node_type"]').inputValue()==='parallel_split','Invalid node type edit must remain visible');
 assert(await page.evaluate(expected=>JSON.stringify(currentDocument())===JSON.stringify(expected),added),'Node-type conflict must preserve relations and document');
 assert((await page.locator('body').innerText()).includes('节点类型未修改'),'Impact explanation required');
 await page.getByRole('tab',{name:/全流程数据与表单/}).click();
 await page.getByRole('button',{name:'放弃修改并继续',exact:true}).click();
 await page.getByRole('button',{name:'整理数据对象与关联',exact:true}).click();
 await page.getByRole('combobox',{name:/当前数据对象/}).selectOption(report.data_ref);
 await page.getByRole('button',{name:'打开批量编辑',exact:true}).click();

 await page.getByRole('tab',{name:/数据行为关系/}).click();
 await (async page => {
 const before=await page.evaluate(()=>JSON.parse(JSON.stringify(currentDocument())));
 const decision=before.behaviors.find(b=>b.node_type==='decision');
 const row=await page.locator('[data-grid-cell][data-grid-column=behavior_ref]').evaluateAll((els,ref)=>els.find(e=>e.value===ref).dataset.gridRowId,decision.behavior_ref);
 const cell=page.locator(`[data-grid-cell][data-grid-column=operation][data-grid-row-id=${row}]`);
 await cell.selectOption('create');
 await page.getByRole('button',{name:'应用本次修改',exact:true}).click();
 if(await cell.inputValue()!=='create')throw new Error('Pending grid value lost');
 if(!await page.evaluate(expected=>JSON.stringify(currentDocument())===JSON.stringify(expected),before))throw new Error('Invalid grid mutated document');
 if(!(await page.locator('body').innerText()).includes('判断节点'))throw new Error('Missing error');
 await cell.selectOption('use');
})(page);
}
