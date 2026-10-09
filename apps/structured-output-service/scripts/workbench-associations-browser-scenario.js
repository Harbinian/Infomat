async page => {
  const origin = '__BASE_URL__', output = '__OUTPUT_DIR__', fixture = '__FIXTURE_PATH__';
  const candidate = new URL(origin);
  if (!['127.0.0.1','localhost'].includes(candidate.hostname) || !candidate.port || ['3000','3001'].includes(candidate.port)) throw new Error('Explicit local candidate required.');
  const result = { passed:false, browser:'msedge', viewport:{width:1699,height:828}, checks:[], downloads:[], consoleProblems:[], pageErrors:[], forbiddenRequests:[] };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const check = message => result.checks.push(message);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('console', message => { if (['error','warning'].includes(message.type())) result.consoleProblems.push(message.text()); });
  page.on('request', request => { const url = new URL(request.url()); if (/^https?:$/.test(url.protocol) && url.origin !== origin || /\/api\/(session|data|export|process-design|v7-mappings|data-map-definitions)(\/|$)/.test(url.pathname)) result.forbiddenRequests.push(url.pathname); });
  page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else await dialog.dismiss(); });
  await page.context().addInitScript(() => {
    window.__associationStorage = []; window.__associationHashes = [];
    for (const key of ['setItem','removeItem','clear']) { const previous = Storage.prototype[key]; Storage.prototype[key] = function(...args) { window.__associationStorage.push(key); return previous.apply(this,args); }; }
    const open = indexedDB.open.bind(indexedDB); indexedDB.open = (...args) => { window.__associationStorage.push('indexedDB'); return open(...args); };
    const digest = crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest = async (algorithm,bytes) => { const hash=await digest(algorithm,bytes); window.__associationHashes.push({bytes:bytes.byteLength,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}); return hash; };
  });
  try {
  await page.setViewportSize(result.viewport); await page.bringToFront();
  await page.goto(`${origin}/workbench/`, {waitUntil:'networkidle'});
  const runtime = await page.evaluate(() => ({userAgent:navigator.userAgent,zoom:visualViewport.scale,width:innerWidth,height:innerHeight}));
  assert(/Edg\//.test(runtime.userAgent) && runtime.zoom===1 && runtime.width===1699 && runtime.height===828,'Edge desktop baseline differs'); result.runtime=runtime;
  await page.getByLabel('导入文件',{exact:true}).setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试：判断分支与并行阅读') || [...document.querySelectorAll('.ant-modal-title')].some(x=>x.textContent==='先保留尚未下载的内容'));
  const discard = page.getByRole('button',{name:'放弃未下载内容并继续',exact:true}); if (await discard.isVisible()) await discard.click();
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent === '虚构测试：判断分支与并行阅读');
  await page.locator('.busy-strip').waitFor({state:'hidden'});
  const ready = () => page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.layoutStatus==='ready'); await ready();
  const detail = () => page.getByRole('complementary',{name:'对象详情'});
  const stable = async () => { await page.waitForTimeout(350); await page.waitForFunction(() => !document.querySelector('.graph-canvas')?._cyreg?.cy?.animated()); };
  const viewport = () => page.evaluate(() => { const cy=document.querySelector('.graph-canvas')._cyreg.cy; return {pan:cy.pan(),zoom:cy.zoom()}; });
  const download = async name => {
    const waiting=page.waitForEvent('download'); await page.getByRole('button',{name:'↓ 下载草稿',exact:true}).click(); const file=await waiting; assert(await file.failure()===null,'Download failed');
    await file.saveAs(`${output}/${name}.json`); const stream=await file.createReadStream(),chunks=[]; for await(const chunk of stream) chunks.push(chunk);
    const bytes=Buffer.concat(chunks), text=bytes.toString('utf8'); const hash=await page.evaluate(async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join(''),text);
    const actual=await page.evaluate(()=>window.__associationHashes.at(-2)); assert(actual?.bytes===bytes.length && actual?.sha256===hash,'Download baseline differs from actual bytes');
    result.downloads.push({name,bytes:bytes.length,sha256:hash}); await page.locator('.ant-drawer-close:visible').click(); await page.locator('.ant-drawer-content-wrapper:visible').waitFor({state:'hidden'}); return JSON.parse(text);
  };
  const before = await download('before-association-reading');
  await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click(); await page.getByPlaceholder('按名称或所属范围查找').fill('测试起点：提交资料'); await page.locator('.object-name').first().click(); await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click(); await ready(); await stable();
  await detail().getByText('关联数据与表单',{exact:true}).waitFor();
  for (const name of ['创建的数据','更新的数据','使用的数据','处理的表单','待确认的数据操作']) assert(await detail().getByText(`${name} · 1`,{exact:true}).count()===1,`Incorrect ${name} count`);
  assert(await page.locator('.association-list:visible').count()===0,'Groups should start collapsed');
  result.nodeLabels=await page.evaluate(()=>document.querySelector('.graph-canvas')._cyreg.cy.nodes('.behavior-node').map(node=>node.data('label')));
  assert(result.nodeLabels.every(label=>!/数据\s+创\d|更\d|用\d|表单\s+\d|待确认\d/.test(label)),'Statistics remain in graph nodes');
  check('Four collapsed groups and pending facts appear in detail, with no statistics in actual graph labels');
  for(const name of ['创建的数据','更新的数据','使用的数据','处理的表单','待确认的数据操作']) await detail().getByText(`${name} · 1`,{exact:true}).click();
  assert(await detail().locator('.association-list').getByRole('button',{name:'虚构测试资料',exact:true}).count()===3,'Recorded data objects not shown in all actual groups');
  assert(await detail().locator('.association-list').getByRole('button',{name:'虚构待确认资料',exact:true}).count()===1,'Pending data facts are missing');
  assert(await detail().getByText('处理方式：填写、复核、归档',{exact:true}).count()===1,'Recorded form operations not retained');
  await detail().locator('.behavior-associations').scrollIntoViewIfNeeded(); await page.screenshot({path:`${output}/association-detail.png`,scale:'css'});
  check('Expanded groups show business names and merged form operations, without duplicate object counts');
  await detail().getByRole('button',{name:'编辑本对象',exact:true}).click(); await page.locator('#detail-behavior_name').fill('测试起点：未应用名称'); await detail().locator('.behavior-associations').scrollIntoViewIfNeeded(); await stable();
  const positionBefore=await viewport(); await detail().locator('.association-list').getByRole('button',{name:'虚构测试资料',exact:true}).first().click(); await page.getByRole('dialog',{name:'先处理当前修改'}).waitFor();
  await page.getByRole('button',{name:'继续编辑',exact:true}).click(); await stable();
  assert(await page.locator('#detail-behavior_name').inputValue()==='测试起点：未应用名称','Cancel lost visible input'); assert(JSON.stringify(await viewport())===JSON.stringify(positionBefore),'Cancel changed viewport');
  assert(await detail().locator('.association-list:visible').count()===5,'Cancel changed expanded groups');
  check('Following an association protects visible input, expanded groups and exact viewport on cancel');
  await detail().getByRole('button',{name:'取消修改',exact:true}).click(); await detail().getByRole('button',{name:'退出编辑',exact:true}).click();
  await detail().locator('.association-list').getByRole('button',{name:'虚构测试资料',exact:true}).first().click(); await detail().getByRole('heading',{name:'虚构测试资料',exact:true}).waitFor();
  await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click(); await page.getByPlaceholder('按名称或所属范围查找').fill('测试起点：提交资料'); await page.locator('.object-name').first().click(); await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click(); await ready(); await stable();
  await detail().getByText('处理的表单 · 1',{exact:true}).click(); await detail().locator('.association-list').getByRole('button',{name:'虚构测试表单',exact:true}).click(); await detail().getByRole('heading',{name:'虚构测试表单',exact:true}).waitFor();
  const after=await download('after-association-reading'); const content=doc=>{const copy=JSON.parse(JSON.stringify(doc));delete copy.export_meta.exported_at;return copy;}; assert(JSON.stringify(content(before))===JSON.stringify(content(after)),'Association reading changed JSON');
  check('Data and form links navigate to exact owned objects; reading and canceled input preserve exported JSON');
  await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click(); await page.getByPlaceholder('按名称或所属范围查找').fill('测试起点：提交资料'); await page.locator('.object-name').first().click(); await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click(); await ready(); await stable();
  await detail().getByRole('button',{name:'查看关系图',exact:true}).click(); await page.waitForFunction(()=>{const canvas=document.querySelector('.graph-canvas');return canvas?.dataset.layoutEngine==='direct-relations'&&canvas.dataset.layoutStatus==='ready'&&canvas._cyreg?.cy?.nodes().length>0;}); await page.screenshot({path:`${output}/association-relations.png`,scale:'css'});
  check('Existing direct relation diagram remains available for the selected behavior');
  const audit=await page.evaluate(()=>({writes:window.__associationStorage,cookies:document.cookie,overflow:document.documentElement.scrollWidth>innerWidth,visible:document.body.innerText}));
  assert(audit.writes.length===0&&!audit.cookies&&!audit.overflow,'Storage or desktop overflow detected'); assert(!/association_data_|association_form_|behavior_fixture_submit|graph_form_link|data_ref|link_ref/.test(audit.visible),'Internal identities leaked');
  assert(!result.pageErrors.length&&!result.consoleProblems.length&&!result.forbiddenRequests.length,'Console or network boundary failed');
  check('Edge desktop, no horizontal overflow, identity leaks, persistence writes, foreign requests or console errors');
  result.passed=true; return result;
  } catch (error) { result.error=error.message; result.failureState=await page.evaluate(()=>({body:document.body.innerText,search:document.querySelector('.ant-input-search input')?.value,view:document.querySelector('.workspace-nav input:checked')?.value,heading:document.querySelector('.detail-heading h2')?.textContent,modal:document.querySelector('.ant-modal-title')?.textContent})); await page.screenshot({path:`${output}/failed.png`,scale:'css'}); return result; }
}
