// P06 API/MySQL/Edge regression. Only synthetic data, owned tmpfs MySQL and
// random loopback ports. --output must be a new directory under artifacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {applyDefinitions}=require('../server/dataMapDefinitionMigration');
const {applyFacts,inspectFacts,MIGRATION_KEY,tables}=require('../server/dataMapFactMigration');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function browserPort(){const net=require('node:net');for(let n=0;n<20;n++){const port=crypto.randomInt(42000,49000),s=net.createServer();if(await new Promise(r=>{s.once('error',()=>r(false));s.listen(port,'127.0.0.1',()=>r(true));})){await new Promise(r=>s.close(r));return port;}}throw new Error('No owned browser port');}
async function bounded(p){let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error('Owned browser close timeout')),10000);})]);}finally{clearTimeout(t);}}
const arg=process.argv.indexOf('--output');assert(arg>=0&&process.argv[arg+1]);const output=path.resolve(process.argv[arg+1]);assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const root='/api/data-map-facts',defs='/api/data-map-definitions',uuid=()=>crypto.randomUUID(),checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function main(){await withStage05Fixture(async({pool,fixture,expect,request,backup,restore})=>{
  let browserServer,browser,page;const pw=runtime();
  const get=(url='',who='lead',status=200)=>expect(who,root+url,'GET',undefined,status);
  const post=(url,body,who='lead',status=200)=>expect(who,root+url,'POST',body,status);
  const act=async(r,a,body={},who='lead',status=200)=>post('/'+r.fact_id+'/'+a,{request_id:uuid(),expected_revision:r.revision_no,...body},who,status);
  const save=(body,who='contact')=>expect(who,defs+'/save','POST',{request_id:uuid(),...body});
  const current=async(type,id)=>(await expect('contact',defs+'/detail/'+type+'/'+id,'GET')).current;
  let obj,field,checked;
  try{
    await check('missing migrations fail closed and startup performs no fact DDL',async()=>{await get('', 'lead',503);assert.equal((await pool.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_fact_requests'"))[0].length,0);});
    const db=await pool.getConnection();try{
      await applyDefinitions(db);
      const inherited=await save({entity_type:'object',definition:{name:'P06迁移前的合成对象',business_meaning:'保留原有事实',source:{description:'迁移前来源说明'}}});
      const inheritedBefore=await expect('contact',defs+'/version/'+inherited.version_id,'GET');
      await check('dry-run, interrupted additive DDL, empty compensation and repeat migration',async()=>{
        const before=await inspectFacts(db);assert.equal(before.missing.length,2);assert.equal(before.ready,false);
        await assert.rejects(applyFacts({execute:(sql,args)=>{if(sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_fact_events'))throw new Error('SYNTHETIC_DDL_FAILURE');return db.execute(sql,args);},query:(...a)=>db.query(...a)}),/SYNTHETIC_DDL_FAILURE/);
        const partial=await inspectFacts(db);assert.deepEqual(partial.missing,['data_map_fact_events']);
        assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM data_map_fact_requests'))[0][0].n),0);
        await db.execute('DROP TABLE data_map_fact_requests'); // this fixture's verified empty increment only
        const first=await applyFacts(db),second=await applyFacts(db);assert(first.ready&&second.ready);
        assert.deepEqual(await expect('contact',defs+'/version/'+inherited.version_id,'GET'),inheritedBefore);
        await db.execute('ALTER TABLE data_map_fact_events ADD COLUMN synthetic_drift INT NULL');assert((await inspectFacts(db)).drift.length);await assert.rejects(applyFacts(db),e=>e.code==='DEFINITION_FACT_SCHEMA_DRIFT');await db.execute('ALTER TABLE data_map_fact_events DROP COLUMN synthetic_drift');
        fs.writeFileSync(path.join(output,'migration.json'),JSON.stringify({before,partial,first,second,empty_compensation:true,drift_rejected:true},null,2));
      });
    }finally{db.release();}
    await check('actual maintenance CLI inspect, default dry-run and repeat apply with explicit owned target',async()=>{
      const config=pool.pool.config.connectionConfig,env=isolatedEnvironment({MYSQL_HOST:config.host,MYSQL_PORT:String(config.port),MYSQL_USER:config.user,MYSQL_PASSWORD:config.password,MYSQL_DATABASE:config.database});
      const target=config.host+':'+config.port+'/'+config.database,results=[];
      for(const mode of ['--inspect',null,'--apply']){const result=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'manage-data-map-facts.js'),...(mode?[mode]:[]),'--target',target],{env,encoding:'utf8',windowsHide:true,timeout:30000}));assert(result.ready);results.push({mode:mode||'default dry-run',...result});}
      fs.writeFileSync(path.join(output,'migration-cli.json'),JSON.stringify(results,null,2));
    });
    obj=await save({entity_type:'object',definition:{name:'合成订单对象',business_meaning:'不应向跨部门收件人展示的整对象说明',storage:{current_source:'合成当前来源'},authority_suggestion:{name:'仅为建议的来源'}}});
    field=await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'合成订单编号',business_meaning:'最初字段说明',enum_values:['甲','乙'],source:{description:'限制披露的字段来源'}}});
    const create=(extra={})=>post('',{request_id:uuid(),subject_version_id:field.version_id,object_version_id:obj.version_id,focus:['business_meaning'],question:'请说明订单编号实际取自哪里，并定位证据。',target_department_id:'91',target_person_id:'83',...extra});
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 86,role_id,'department',93,'P06 synthetic scope',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 88,role_id,'global',NULL,'P06 synthetic multi-admin',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    await check('permissions, CSRF, admin with structure role read-only, explicit valid target and minimal cross-department context',async()=>{
      const anon=await pw.request.newContext({baseURL:fixture.baseURL});try{assert.equal((await anon.get(root)).status(),401);await anon.post('/api/org/login',{data:{loginName:'SYNTHETIC_lead',password:fixture.loginPassword}});assert.equal((await anon.post(root,{data:{}})).status(),403);}finally{await anon.dispose();}
      assert.equal((await get('/capabilities','adminMulti')).can_manage,false);await post('',{},'adminMulti',403);await post('',{},'contact',403);
      const foreign=await create({target_department_id:'93',target_person_id:'86'});await get('/'+foreign.fact_id,'outsider',404);
      await act(foreign,'send');const visible=await get('/'+foreign.fact_id,'outsider');
      assert(!JSON.stringify(visible).includes('不应向跨部门'));assert(!JSON.stringify(visible).includes('限制披露'));assert.equal(visible.latest,null);assert(visible.history.every(e=>e.snapshot.status!=='draft'));
      await expect('outsider',defs+'/version/'+field.version_id,'GET',undefined,403);
      await get('/'+foreign.fact_id,'contact',404);await act({...foreign,revision_no:2},'answer',{answer:'越权',evidence_refs:['某表第1行'],needs_more_info:false,missing_reason:''},'contact',404);
      await post('',{request_id:uuid(),subject_version_id:field.version_id,object_version_id:obj.version_id,focus:['business_meaning'],question:'无效目标',target_department_id:'93',target_person_id:'83'},'lead',409);
      await act({...foreign,revision_no:2},'approve',{},'lead',403);
      assert.equal((await get('/targets')).items.length,3);assert((await get('/targets?department_id=91')).items.some(p=>p.id==='83'));
    });
    await check('draft save and explicit send; missing target remains draft; input whitelist blocks imported approval',async()=>{
      const d=await create({target_department_id:null,target_person_id:null});await act(d,'send',{},'lead',400);assert.equal((await get('/'+d.fact_id)).status,'draft');
      await act(d,'edit',{question:'明确目标后再发出',target_department_id:'91',target_person_id:'83'});await act({...d,revision_no:2},'send');
      await post('',{request_id:uuid(),approved:true},'lead',400);
    });
    await check('duplicate requests, partial-write rollback and optimistic concurrency',async()=>{
      const body={request_id:uuid(),subject_version_id:field.version_id,object_version_id:obj.version_id,focus:['business_meaning'],question:'幂等问题',target_department_id:'91',target_person_id:'83'};
      const r=await post('',body);assert.deepEqual(await post('',body),r);await post('',{...body,question:'不同内容'},'lead',409);
      const count=async()=>Number((await pool.execute('SELECT COUNT(*) n FROM data_map_fact_requests'))[0][0].n),before=await count();
      await pool.query("CREATE TRIGGER p06_fact_failure BEFORE INSERT ON data_map_fact_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_FACT_FAILURE'");
      await post('',{...body,request_id:uuid()},'lead',503);assert.equal(await count(),before);await pool.query('DROP TRIGGER p06_fact_failure');
      const results=await Promise.all([request('lead',root+'/'+r.fact_id+'/send','POST',{request_id:uuid(),expected_revision:1}),request('lead',root+'/'+r.fact_id+'/send','POST',{request_id:uuid(),expected_revision:1})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    });
    await check('missing evidence, follow-up, answer, revision, stale refusal, explicit rebind and MDM check',async()=>{
      let r=await create();r=await act(r,'send');
      await act(r,'answer',{answer:'说明',evidence_refs:[],needs_more_info:false,missing_reason:''},'contact',400);
      r=await act(r,'answer',{answer:'暂缺凭据',evidence_refs:[],needs_more_info:true,missing_reason:'待查表单具体位置'},'contact');
      await act(r,'check',{reason:'不能核对',evidence_refs:['伪依据']},'lead',400);
      r=await act(r,'more_info',{reason:'请补充实际表单位置'});
      r=await act(r,'answer',{answer:'实际来自登记表编号列',evidence_refs:['合成登记表 第2页 编号列'],needs_more_info:false,missing_reason:''},'contact');
      field=await save({entity_type:'field',entity_id:field.entity_id,expected_revision:1,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{business_meaning:'依据答复修订：登记表编号'}});
      const stale=await get('/'+r.fact_id);assert(stale.stale);await act(r,'check',{reason:'旧意见不可沿用',evidence_refs:['合成依据']},'lead',409);
      r=await act(r,'rebind',{subject_version_id:field.version_id,object_version_id:obj.version_id,reason:'核对台账修订后的实际取值说明'});
      assert.equal((await get('/'+r.fact_id)).data.answer,null);
      r=await act(r,'answer',{answer:'已核对修订后的事实',evidence_refs:['合成登记表 第2页 编号列'],needs_more_info:false,missing_reason:''},'contact');
      await act(r,'check',{reason:'部门不能代MDM核对',evidence_refs:['合成依据']},'contact',403);
      checked=await act(r,'check',{reason:'结构与证据定位一致，本次仅核对字段事实',evidence_refs:['合成登记表 第2页 编号列']});
      const done=await get('/'+r.fact_id);assert.equal(done.status,'checked');assert.equal(done.formal_governance.status,'pending');assert.equal(done.data.review.checked_subject_version_id,field.version_id);assert(done.history.length>=8);
      assert.equal((await current('field',field.entity_id)).definition.governance,null);
      fs.writeFileSync(path.join(output,'fact-complete.json'),JSON.stringify(done,null,2));
    });
    await check('unrelated updates and enum ordering retain checks; relevant changes require recheck; current org is enforced',async()=>{
      field=await save({entity_type:'field',entity_id:field.entity_id,expected_revision:field.revision_no,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{masking:'不涉及当前事实范围'}});assert.equal((await get('/'+checked.fact_id)).stale,false);
      let e=await create({focus:['enum_values'],question:'核对允许值集合'});e=await act(e,'send');e=await act(e,'answer',{answer:'甲和乙',evidence_refs:['合成枚举表 第1行'],needs_more_info:false,missing_reason:''},'contact');
      field=await save({entity_type:'field',entity_id:field.entity_id,expected_revision:field.revision_no,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{enum_values:['乙','甲']}});assert.equal((await get('/'+e.fact_id)).stale,false);
      e=await act(e,'check',{reason:'集合一致',evidence_refs:['合成枚举表 第1行']});
      field=await save({entity_type:'field',entity_id:field.entity_id,expected_revision:field.revision_no,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{enum_values:['乙','丙']}});assert.equal((await get('/'+e.fact_id)).stale,true);
      await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=83');await get('/'+checked.fact_id,'contact',404);await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=83');
      const impact=await expect('contact',defs+'/impact/field/'+field.entity_id,'GET');assert(impact.counts.fact_requests>0);
    });
    await check('append-only history integrity and full owned database backup restoration preserve old versions and source',async()=>{
      const saved=await get('/'+checked.fact_id),old=await expect('contact',defs+'/version/'+obj.version_id,'GET');const dump=backup();
      await pool.execute("UPDATE data_map_fact_requests SET data_json=JSON_SET(data_json,'$.question','SYNTHETIC_CORRUPTION') WHERE fact_id=?",[checked.fact_id]);await get('/'+checked.fact_id,'lead',409);
      restore(dump);assert.deepEqual(await get('/'+checked.fact_id),saved);assert.deepEqual(await expect('contact',defs+'/version/'+obj.version_id,'GET'),old);
      fs.writeFileSync(path.join(output,'backup-restore.json'),JSON.stringify({sha256:crypto.createHash('sha256').update(dump).digest('hex'),restored:true,backup_persisted:false}));
    });
    browserServer=await pw.chromium.launchServer({channel:'msedge',headless:true,host:'127.0.0.1',port:await browserPort()});browser=await pw.chromium.connect(browserServer.wsEndpoint());
    const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(12000);
    const pageErrors=[],consoleErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
    const button=n=>page.getByRole('button',{name:n,exact:true}),label=n=>page.getByLabel(n,{exact:true});
    const idle=()=>page.waitForFunction(()=>!document.body.textContent.includes('正在处理事实核对…'));
    const login=async who=>{await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await page.getByRole('heading',{name:'定向事实核对',exact:true}).waitFor();await idle();};
    const dismiss=async fn=>{const d=page.waitForEvent('dialog');const a=fn();await(await d).dismiss();await a;};
    const overflow=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);};
    const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,name),fullPage:true});};
    let uiFact;
    await check('Edge create targeted field question, focus, draft/send separation and minimal business reply',async()=>{
      await page.goto(fixture.baseURL+'/app/fact-checks?version='+field.version_id);await login('lead');await button('起草定向问题').click();assert.equal(await label('具体事实问题').evaluate(e=>e===document.activeElement),true);
      await label('具体事实问题').fill('页面问题：请提供编号来源的事实与证据。'+('请保留中文内容。'.repeat(8)));await label('目标部门').selectOption('91');await idle();await label('指定答复人员').selectOption('83');
      await dismiss(()=>page.getByRole('link',{name:'当前身份',exact:true}).click());await dismiss(()=>page.reload().catch(()=>{}));assert((await label('具体事实问题').inputValue()).startsWith('页面问题'));
      await button('保存问题草稿').click();await idle();await button('发出定向问题').click();await button('确认发出问题').click();await idle();uiFact=(await get()).items.find(r=>r.question.startsWith('页面问题'));
      await shot('requested-desktop.png');await overflow();await button('退出登录').click();await login('contact');await button('答复具体事实').click();await label('事实答复').fill('页面输入：实际来自合成登记表编号列。');await label('证据定位（每行一条）').fill('合成登记表 第3页 编号列');
    });
    await check('Edge 403/409/503/network, cancelled navigation and real 401 re-login preserve reply',async()=>{
      for(const status of [403,409,503]){await page.route('**'+root+'/'+uiFact.fact_id+'/answer',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_FAILURE'})}),{times:1});await button('提交事实答复').click();await page.getByRole('alert').waitFor();await idle();assert.equal(await label('事实答复').inputValue(),'页面输入：实际来自合成登记表编号列。');}
      await page.route('**'+root+'/'+uiFact.fact_id+'/answer',route=>route.abort(),{times:1});await button('提交事实答复').click();await idle();assert((await label('事实答复').inputValue()).includes('页面输入'));
      await dismiss(()=>button('取消本次办理').click());await dismiss(()=>page.getByRole('link',{name:'对象与字段',exact:true}).click());
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');await button('提交事实答复').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('contact');assert((await label('事实答复').inputValue()).includes('页面输入'));
      await page.setViewportSize({width:390,height:844});await overflow();await shot('reply-mobile.png');await button('提交事实答复').click();await idle();
    });
    await check('Edge locate exact field, preserve return position, revise via existing editor, rebind and complete check',async()=>{
      await page.setViewportSize({width:1699,height:828});await page.getByRole('link',{name:'定位台账并修订',exact:true}).click();await button('修订字段').click();await label('字段含义').fill('页面修订：来源为合成登记表编号列');await button('保存字段').click();await button('修订字段').waitFor();await page.getByRole('link',{name:'返回事实核对办理位置',exact:true}).click();await idle();await button('退出登录').click();await login('lead');await button('查看修订并重新核对').click();await label('重新核对理由').fill('已对照答复修订字段说明，请核对新版本');await button('确认重新发起').click();await idle();
      await button('退出登录').click();await login('contact');await button('答复具体事实').click();await label('事实答复').fill('修订后内容与登记表一致');await label('证据定位（每行一条）').fill('合成登记表 第3页 编号列');await button('提交事实答复').click();await idle();await button('退出登录').click();await login('lead');
      await button('核对事实答复').click();await label('核对理由').fill('字段事实和依据定位一致');await label('核对依据（每行一条）').fill('合成登记表 第3页 编号列');await button('完成事实核对').click();await idle();assert.equal((await get('/'+uiFact.fact_id)).status,'checked');
      await page.getByText('全程办理记录',{exact:true}).click();await overflow();await shot('checked-desktop.png');await page.setViewportSize({width:390,height:844});await overflow();await shot('checked-mobile.png');
    });
    await check('Edge late response cannot overwrite selected fact; no unexpected console errors',async()=>{
      let release;const gate=new Promise(r=>{release=r;});await page.route('**'+root+'/'+checked.fact_id,async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});
      await page.locator('.fact-choice').filter({hasText:'核对 '+checked.fact_id+' ·'}).click();await page.locator('.fact-choice').filter({hasText:'核对 '+uiFact.fact_id+' ·'}).click();await idle();release();await page.unrouteAll({behavior:'wait'});assert((await page.locator('.fact-detail h2').innerText()).includes('核对 '+uiFact.fact_id+'：'));assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors.filter(e=>!/Failed to load resource:.*(401|403|409|503|net::ERR_FAILED)/.test(e)),[]);
    });
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,browser:'Microsoft Edge 100%',viewports:[{width:1699,height:828},{width:390,height:844}],consoleErrors,human_acceptance:false,scope:'owned MySQL and real API; synthetic identities; HTTP fault injection labelled in checks'},null,2));
  }catch(e){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:e.message,checks},null,2));throw e;}
  finally{const cleanup={owned_browser_pid:browserServer?.process().pid||null};try{if(browser)await bounded(browser.close());cleanup.client_closed=true;}catch{cleanup.client_close_timeout=true;}if(browserServer){try{await bounded(browserServer.close());cleanup.graceful=true;}catch{await bounded(browserServer.kill());cleanup.forced_owned_browser_only=true;}assert(browserServer.process().exitCode!==null||browserServer.process().signalCode!==null);}fs.writeFileSync(path.join(output,'browser-cleanup.json'),JSON.stringify(cleanup,null,2));}
},{evidenceDir:output,previewOnly:true});}
main().catch(e=>{console.error(e);process.exitCode=1;});
