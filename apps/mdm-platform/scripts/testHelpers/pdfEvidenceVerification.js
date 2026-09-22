// P18 owned MySQL/API/Edge checks using synthetic workbooks only. Restore prior data on exit.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {fixture:workbook}=require('../test-pdf-evidence');
module.exports=async function({repo,lead,pool,fixture,source,field,check,save,backup,restore,output}){
 const uuid=()=>crypto.randomUUID(),own=[],test=async(n,f)=>{await check('P18 Pdf '+n,f);own.push(n);};
 const migration=require('../../server/pdfEvidenceMigration'),schema=require('../../server/pdfEvidenceSchema');
 const apply=async()=>{const c=await pool.getConnection();try{return await migration.applyPdfEvidence(c);}finally{c.release();}};
 const bytes=await workbook();
 const payload=()=>({request_id:uuid(),original_name:'合成读取.pdf',links:[]});
 await test('missing migration fails closed; partial DDL, repeat apply and drift checked',async()=>{
  await assert.rejects(repo.registerPdfEvidence(lead,payload(),bytes),e=>e.code==='DEFINITION_PDF_MIGRATION_REQUIRED');
  const before=await migration.inspectPdfEvidence(pool);assert.deepEqual(before.drift,[]);assert.equal(before.missing.length,1);
  const cfg=pool.pool.config.connectionConfig,target=`${cfg.host}:${cfg.port}/${cfg.database}`;
  const env=require('./isolatedProcess').isolatedEnvironment({MYSQL_HOST:cfg.host,MYSQL_PORT:String(cfg.port),MYSQL_USER:cfg.user,MYSQL_PASSWORD:cfg.password,MYSQL_DATABASE:cfg.database});
  const cli=args=>require('node:child_process').execFileSync(process.execPath,[require.resolve('../manage-pdf-evidence'),...args],{env,encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']});
  assert.deepEqual(JSON.parse(cli(['--target',target])),before);assert.throws(()=>cli(['--apply','--target','wrong']));
  await pool.execute(schema.statements()[0]);assert.equal((await migration.inspectPdfEvidence(pool)).ready,false);
  assert.equal((await apply()).ready,true);assert.equal((await apply()).ready,true);
  await pool.execute('ALTER TABLE data_map_pdf_evidence ADD COLUMN synthetic_drift INT');await assert.rejects(apply(),e=>e.code==='DEFINITION_ANALYSIS_SCHEMA_DRIFT');await pool.execute('ALTER TABLE data_map_pdf_evidence DROP COLUMN synthetic_drift');
  save('p18-pdf-migration.json',{before,after:await migration.inspectPdfEvidence(pool),partial_resumed:true,repeat:true,drift_rejected:true});
 });
 await require('../../server/analysisQueueMigration').applyAnalysisQueue(pool);
 const setup=await pool.getConnection();try{await require('../../server/analysisIssueMigration').applyAnalysisIssues(setup);await require('../../server/officeSchema').manageOfficeSchema(setup,'apply');await require('../../server/analysisTaskMigration').applyAnalysisTasks(setup);await require('../../server/analysisClosureMigration').applyAnalysisClosure(setup);}finally{setup.release();}
 const dump=backup(),clients={};let browser,server,context,worker;
 const events=[],errors=[],consoleErrors=[];
 const http=async(who,url,method='GET',body)=>{const c=clients[who]||(clients[who]={});const form=body instanceof FormData;
  const r=await fetch(fixture.baseURL+url,{method,headers:{...(form?{}:{'Content-Type':'application/json'}),...(c.cookie?{Cookie:c.cookie}:{}),...(c.csrf?{'X-CSRF-Token':c.csrf}:{})},body:body===undefined?undefined:form?body:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))c.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};};
 const ok=async(w,u,m,b,status=200)=>{const r=await http(w,u,m,b);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
 const root='/api/analysis/materials/pdf';
 const form=(p=payload(),b=bytes)=>{const f=new FormData();f.append('file',new Blob([b]),p.original_name);f.append('request_id',p.request_id);f.append('links',JSON.stringify(p.links));return f;};
 const wait=async fn=>{const end=Date.now()+45000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('P18_WAIT_TIMEOUT');};
 let batch,runId,meta;
 try{
  for(const who of ['lead','outsider','adminMulti','contact']){await ok(who,'/api/org/login','POST',{loginName:'SYNTHETIC_'+who,password:fixture.loginPassword});clients[who].csrf=(await ok(who,'/api/csrf-token')).csrfToken;}
  await test('upload identity, scope, CSRF and administrator protections',async()=>{
   await ok('anonymous',root,'POST',form(),401);await ok('adminMulti',root,'POST',form(),404);
   const token=clients.lead.csrf;clients.lead.csrf=null;await ok('lead',root,'POST',form(),403);clients.lead.csrf=token;
  });
  await test('fixed file digest, explicit ledger and V7 mappings, idempotency and no inferred mappings',async()=>{
   const p=payload();p.links=[{kind:'definition',ref_id:field.version_id,anchor_id:'a4',basis:'合成显式字段对应'},{kind:'v7_source',ref_id:source.source_id,anchor_id:'a6',basis:'合成显式来源对应'}];
   const r=await ok('lead',root,'POST',form(p));batch=r.batch_id;assert.deepEqual(await ok('lead',root,'POST',form(p)),r);
   assert.equal((await ok('lead',root,'POST',form({...p,request_id:uuid()}))).batch_id,batch);
   await ok('lead',root,'POST',form({...p,original_name:'different.pdf'}),409);
   meta=await ok('lead',root+'/'+batch);assert.equal(meta.links.length,2);assert.equal(meta.source.raw_sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
   const unlinked=await ok('lead',root,'POST',form());assert.notEqual(unlinked.batch_id,batch);assert.deepEqual((await ok('lead',root+'/'+unlinked.batch_id)).links,[]);
   save('p18-pdf-fixed-source.json',meta);
  });
  await test('page/text locator, repeated headers, invalid locator and source-range protection',async()=>{
   const c=await ok('lead',root+'/'+batch+'?anchor=a0');assert.equal(c.anchor.text,'Synthetic_unique_title_19');assert.equal(c.anchor.page,1);const repeated=await ok('lead',root+'/'+batch+'?anchor=a7');assert.equal(repeated.anchor.text,c.anchor.text);assert.equal(repeated.anchor.page,2);
   await ok('lead',root+'/'+batch+'?anchor=missing',undefined,undefined,404);await ok('lead',root+'/'+batch+'?anchor=a999',undefined,undefined,404);
   await ok('outsider',root+'/'+batch,undefined,undefined,404);await ok('outsider','/api/analysis/sources/template/'+batch,undefined,undefined,404);
   assert.equal((await http('lead',root+'/'+batch)).cache,'no-store');
   assert.deepEqual((await ok('lead',root+'/'+batch+'?page=3')).anchors,[]);assert((await ok('lead',root+'/'+batch+'?page=2')).anchors.every(a=>a.page===2));await ok('lead',root+'/'+batch+'?page=0',undefined,undefined,400);
  });
  await test('invalid mapping and damaged upload leave no source or receipt',async()=>{
   const count=async()=>Number((await pool.execute('SELECT COUNT(*) n FROM data_map_source_files'))[0][0].n),n=await count();
   await ok('lead',root,'POST',form({...payload(),links:[{kind:'definition',ref_id:field.version_id,anchor_id:'a999',basis:'bad'}]}),404);
   await ok('lead',root,'POST',form(payload(),Buffer.from('damaged')),400);assert.equal(await count(),n);
  });
  await test('non-PDF names, renamed binary files and oversized uploads rejected without source rows',async()=>{
   const count=async()=>Number((await pool.execute('SELECT COUNT(*) n FROM data_map_source_files'))[0][0].n),n=await count();
   const binary=Buffer.from('d0cf11e0a1b11ae100000000','hex');
   for(const [name,b] of [['forbidden.doc',bytes],['renamed.pdf',binary],['forbidden.docm',bytes]]){
    const response=await ok('lead',root,'POST',form({...payload(),original_name:name},b),400);assert.equal(response.code,'DEFINITION_PDF_TYPE');
   }
   await ok('lead',root,'POST',form(payload(),Buffer.alloc(5*1024*1024+1)),413);assert.equal(await count(),n);
  });
  await test('snapshot corruption rejected and in-memory recovery restores fixed source',async()=>{
   const [[row]]=await pool.execute('SELECT snapshot_json,snapshot_digest FROM data_map_pdf_evidence WHERE batch_id=?',[batch]);
   await pool.execute("UPDATE data_map_pdf_evidence SET snapshot_digest=REPEAT('0',64) WHERE batch_id=?",[batch]);await ok('lead',root+'/'+batch,undefined,undefined,409);
   await pool.execute('UPDATE data_map_pdf_evidence SET snapshot_digest=? WHERE batch_id=?',[row.snapshot_digest,batch]);assert.deepEqual(await ok('lead',root+'/'+batch),meta);
  });
  await test('mid-transaction storage failure rolls back source and request; same request can retry',async()=>{
   const p=payload();p.links=[{kind:'v7_source',ref_id:source.source_id,anchor_id:'a4',basis:'事务回滚合成依据'}];
   const count=async()=>Number((await pool.execute('SELECT COUNT(*) n FROM data_map_source_files'))[0][0].n),n=await count();
   await pool.query("CREATE TRIGGER p18_synthetic_fail BEFORE INSERT ON data_map_pdf_evidence FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'");
   try{await ok('lead',root,'POST',form(p),503);assert.equal(await count(),n);assert.equal((await pool.execute('SELECT request_id FROM data_map_definition_requests WHERE request_id=?',[p.request_id]))[0].length,0);}finally{await pool.query('DROP TRIGGER p18_synthetic_fail');}
   await ok('lead',root,'POST',form(p));
  });
  await test('real worker creates partial extraction findings and resolvable evidence; export excludes raw content',async()=>{
   const r=require('../../server/pdfEvidenceRules');const p={request_id:uuid(),inputs:[{input_key:'source',kind:'template',ref_id:batch}],check_scope:{description:'P18合成证据读取',check_ids:r.CHECKS},rule_version:r.VERSION,parser_versions:{[r.PARSER]:r.VERSION},steps:[{step_key:'check',input_keys:['source'],check_ids:r.CHECKS,parser_key:r.PARSER}],ai_metadata:null,rerun_of_run_id:null};
   runId=(await ok('lead','/api/analysis/runs','POST',p)).run_id;
   const c=pool.pool.config.connectionConfig;
   worker=require('node:child_process').fork(require.resolve('../analysis-worker'),['start','--target',`${c.host}:${c.port}/${c.database}`],{env:require('./isolatedProcess').isolatedEnvironment({MYSQL_HOST:c.host,MYSQL_PORT:String(c.port),MYSQL_USER:c.user,MYSQL_PASSWORD:c.password,MYSQL_DATABASE:c.database}),silent:true,windowsHide:true,execArgv:[]});
   worker.stderr.on('data',b=>events.push({event:'worker_stderr',code:String(b).trim()}));
   worker.stdout.on('data',b=>{for(const line of String(b).trim().split('\n'))try{events.push(JSON.parse(line));}catch{}});
   const detail=await wait(async()=>{const d=await ok('lead','/api/analysis/runs/'+runId);return d.status==='partial'?d:null;});
   const f=await ok('lead','/api/analysis/runs/'+runId+'/findings');assert.equal(f.items.length,2);
   const ev=await ok('lead',`/api/analysis/runs/${runId}/evidence/${f.items[1].evidence_ids[0]}`);assert.equal(ev.extraction_status,'resolved');
   const exportData=await ok('lead',`/api/analysis/runs/${runId}/export`);assert(!JSON.stringify(exportData).includes('Synthetic_unique_title_19'));assert(!JSON.stringify(exportData).includes('viewport_transform'));assert(exportData.evidence.every(e=>!Object.hasOwn(e,'excerpt')));
   save('p18-pdf-worker.json',{detail,findings:f,evidence:ev,events});
  });
  await test('Pdf finding reuses existing issue entity and closure source context',async()=>{
   const f=(await ok('lead','/api/analysis/runs/'+runId+'/findings')).items[1];
   const result=await repo.decideAnalysisFinding(lead,{request_id:uuid(),run_id:runId,finding_id:f.finding_id,expected_revision:1,action:'create',title:'P18合成证据问题',owner_department_id:'91',owner_basis:'合成明确归口',reason:'合成材料人工核对',evidence_ids:f.evidence_ids});
   assert(result.issue_id);const issue=await repo.getAnalysisIssue(lead,result.issue_id);assert(issue);
   const closure=await repo.getAnalysisIssueClosure(lead,result.issue_id);assert(closure);
   save('p18-pdf-issue.json',{result,issue,closure});
  });
  await test('linked source scope changes revoke Pdf and entire run reads',async()=>{
   await ok('contact',root+'/'+batch);
   const [[original]]=await pool.execute('SELECT scope_department_id FROM data_map_v7_sources WHERE source_id=?',[source.source_id]);
   await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?',[source.source_id]);
   try{await ok('contact',root+'/'+batch,undefined,undefined,404);await ok('contact','/api/analysis/runs/'+runId,undefined,undefined,404);}finally{await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=? WHERE source_id=?',[original.scope_department_id,source.source_id]);}
   await assert.rejects(repo.getPdfEvidence({...lead,authVersion:999},batch),e=>e.statusCode===401);
  });
  await test('Edge PDF-only upload, structure and issue evidence navigation, failure inputs and narrow viewport',async()=>{
   let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}
   server=await pw.chromium.launchServer({channel:'msedge',headless:true});browser=await pw.chromium.connect(server.wsEndpoint());context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});const page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});page.setDefaultTimeout(15000);
   await page.goto(fixture.baseURL+'/app/analysis#run='+runId+'&pdf='+batch);await page.locator('#login-name').fill('SYNTHETIC_lead');await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.getByLabel('PDF物理页',{exact:true}).selectOption('3');await page.getByText('当前页没有提取到文字片段；请核对原件，不能据此认定没有内容。',{exact:true}).waitFor();await page.getByLabel('PDF物理页',{exact:true}).selectOption('');await page.getByRole('button',{name:'查看结构 a4',exact:true}).click();await page.getByText('原文结构 a4',{exact:true}).waitFor();
   await page.locator('[data-finding]').nth(1).click();await page.getByRole('button',{name:'查看证据 1',exact:true}).click();await page.getByRole('link',{name:'浏览该 PDF 固定证据的文本位置',exact:true}).waitFor();
   await page.getByRole('region',{name:'关联问题',exact:true}).getByRole('button',{name:/追溯运行/}).click();
   await page.getByRole('button',{name:'查看证据 1',exact:true}).click();await page.getByRole('link',{name:'浏览该 PDF 固定证据的文本位置',exact:true}).click();
   await page.getByText('原文结构 a0',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);await page.screenshot({path:path.join(output,'p18-pdf-desktop.png'),fullPage:true});
   const upload=page.getByLabel('PDF 文件',{exact:true}),submit=page.getByRole('button',{name:'登记 PDF 证据',exact:true});assert.equal(await upload.getAttribute('accept'),'.pdf');
   await upload.setInputFiles({name:'不允许.doc',mimeType:'application/mspdf',buffer:bytes});await submit.click();await page.getByText('只允许上传 .pdf 文件。',{exact:true}).waitFor();
   await upload.setInputFiles([]);
   await upload.setInputFiles({name:'浏览器样本.pdf',mimeType:'application/pdf',buffer:bytes});
   for(const status of [503,403,409]){
    await page.route('**/api/analysis/materials/pdf',r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify({code:'DEFINITION_PDF_TEST'})}));await submit.click();await page.getByText('PDF 操作未完成，输入保留',{exact:true}).waitFor();
    await wait(async()=>!await submit.isDisabled());assert(await page.getByText('待登记：浏览器样本.pdf',{exact:true}).isVisible());await page.unroute('**/api/analysis/materials/pdf');
   }
   const dialog=page.waitForEvent('dialog'),navigation=page.getByRole('link',{name:'当前身份',exact:true}).click();await(await dialog).dismiss();await navigation;
   const reloadDialog=page.waitForEvent('dialog'),reloading=page.reload().catch(()=>{});await(await reloadDialog).dismiss();await reloading;assert(await page.getByText('待登记：浏览器样本.pdf',{exact:true}).isVisible());
   await page.route('**/api/analysis/materials/pdf',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));await submit.click();await page.locator('#login-name').waitFor();await page.unroute('**/api/analysis/materials/pdf');await page.locator('#login-name').fill('SYNTHETIC_lead');await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByText('待登记：浏览器样本.pdf',{exact:true}).waitFor();
   await submit.click();await wait(async()=>new URL(page.url()).hash.includes('pdf=')&&!await page.getByText('待登记：浏览器样本.pdf',{exact:true}).count());
   await wait(async()=>!await page.getByRole('button',{name:'刷新分析记录',exact:true}).isDisabled());await page.getByRole('button',{name:'查看结构 a0',exact:true}).click();await page.getByText('原文结构 a0',{exact:true}).waitFor();assert.equal(await upload.inputValue(),'');
   await page.getByLabel('本轮范围说明',{exact:true}).fill('登记PDF后保留范围');
   await upload.setInputFiles({name:'再次登记.pdf',mimeType:'application/pdf',buffer:bytes});await submit.click();await wait(async()=>!await page.getByText('待登记：再次登记.pdf',{exact:true}).count());
   assert.equal(await page.getByLabel('本轮范围说明',{exact:true}).inputValue(),'登记PDF后保留范围');
   await wait(async()=>!await page.getByRole('button',{name:'创建并排队分析',exact:true}).isDisabled());
   await page.getByRole('button',{name:'创建并排队分析',exact:true}).click();
   await wait(async()=>await page.locator('[data-finding]').count()===2);
   await page.locator('[data-finding]').nth(1).click();await page.getByRole('button',{name:'查看证据 1',exact:true}).click();
   await page.getByRole('link',{name:'浏览该 PDF 固定证据的文本位置',exact:true}).click();await page.getByText('原文结构 a0',{exact:true}).waitFor();
   await wait(async()=>!await submit.isDisabled());
   await page.getByRole('region',{name:'PDF证据',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'p18-pdf-pdf-desktop-panel.png')});
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'p18-pdf-mobile.png'),fullPage:true});
   await page.getByRole('region',{name:'PDF证据',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'p18-pdf-pdf-mobile-panel.png')});assert.deepEqual(errors,[]);
   assert(consoleErrors.every(e=>/Failed to load resource:.*(401|403|409|503)/.test(e)),consoleErrors.join('\n'));
   save('p18-pdf-browser.json',{errors,expected_console_errors:consoleErrors,desktop:[1699,828],mobile:[390,844],zoom:1,doc_rejected:true,upload:true,failed_upload_input_preserved:true,same_identity_relogin_preserved:true,analysis_description_preserved:true,create_analysis_from_browser:true,issue_trace_and_evidence_jump:true});
  });
  save('p18-pdf-results.json',{passed:true,checks:own,formal_environment:false,human_acceptance:false});
 }finally{
  if(worker&&worker.exitCode===null&&worker.signalCode===null){const stopped=require('node:events').once(worker,'exit');worker.send('stop');const t=setTimeout(()=>worker.kill('SIGKILL'),10000);await stopped;clearTimeout(t);}
  let forced=false;const pid=server?.process()?.pid;
  const timer=setTimeout(()=>{forced=true;if(process.platform==='win32'&&pid){const command="$owned=Get-CimInstance Win32_Process -Filter 'ProcessId="+pid+"'; if ($owned -and $owned.ParentProcessId -eq "+process.pid+" -and $owned.Name -eq 'msedge.exe' -and $owned.CommandLine -like '*playwright_chromiumdev_profile-*') { $r=Invoke-CimMethod -InputObject $owned -MethodName Terminate; if ($r.ReturnValue -ne 0) { exit 1 } }";try{require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,stdio:'ignore'});}catch{}}server?.kill().catch(()=>{});},10000);
  try{if(context)await context.close();if(browser)await browser.close();if(server)await server.close();}finally{clearTimeout(timer);}
  save('p18-pdf-owned-browser-shutdown.json',{forced,pid,browser_closed:!browser||!browser.isConnected()});restore(dump);
  save('p18-pdf-worker-events.json',events);
  save('p18-pdf-cleanup.json',{worker_stopped:true,browser_closed:true,prior_database_restored:true});
 }
};
