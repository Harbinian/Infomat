// P05 actual API/MySQL/Edge path; synthetic identities/data, owned tmpfs MySQL,
// random non-business ports. --output is a new directory under artifacts.
// No private .env, external material, production connection or browser download.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {applyDefinitions}=require('../server/dataMapDefinitionMigration');
const {fixture:workbookFixture}=require('./testHelpers/masterDataTemplateFixture');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function browserPort(){
  const net=require('node:net');
  for(let attempt=0;attempt<20;attempt++){
    const port=crypto.randomInt(42000,49000),probe=net.createServer();
    const available=await new Promise(resolve=>{probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>resolve(true));});
    if(available){await new Promise(resolve=>probe.close(resolve));return port;}
  }
  throw new Error('No isolated browser transport port available');
}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned browser close timed out')),10000);})]);}finally{clearTimeout(timer);}}
const index=process.argv.indexOf('--output');assert(index>=0&&process.argv[index+1],'--output required');
const output=path.resolve(process.argv[index+1]);assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output),'new artifacts directory required');fs.mkdirSync(output,{recursive:true});
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const root='/api/data-map-definitions',req=()=>crypto.randomUUID();
async function main(){await withStage05Fixture(async({pool,fixture,expect,request})=>{
  const pw=runtime();let browser,page,browserServer;
  const get=(url,status=200,who='contact')=>expect(who,root+url,'GET',undefined,status);
  const post=(url,body,status=200,who='contact')=>expect(who,root+url,'POST',body,status);
  const save=(data,status=200,who='contact')=>post('/save',{request_id:req(),...data},status,who);
  const detail=(type,id)=>get('/detail/'+type+'/'+id);
  let obj,other,field,second;
  try{
    await check('missing migration fails closed; no startup DDL',async()=>{await get('/objects',503);});
    const connection=await pool.getConnection();try{await applyDefinitions(connection);}finally{connection.release();}
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 88,role_id,'department',91,'P05 synthetic multi admin',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
    await check('read/write permission, multi-role admin read-only and no-data-scope boundaries',async()=>{
      assert.equal((await get('/capabilities')).can_write,true);assert.equal((await get('/capabilities',200,'adminMulti')).can_write,false);
      for(const who of ['admin','adminMulti','reviewA'])await save({entity_type:'object',definition:{name:'禁止建档'}},403,who);
      assert.equal((await get('/objects')).items.length,0);
      const anon=await pw.request.newContext({baseURL:fixture.baseURL});try{assert.equal((await anon.get(root+'/objects')).status(),401);}finally{await anon.dispose();}
      const session=await pw.request.newContext({baseURL:fixture.baseURL});try{
        assert.equal((await session.post('/api/org/login',{data:{loginName:'SYNTHETIC_contact',password:fixture.loginPassword}})).status(),200);
        assert.equal((await session.post(root+'/save',{data:{request_id:req(),entity_type:'object',definition:{name:'缺CSRF'}}})).status(),403);
        const token=(await(await session.get('/api/csrf-token')).json()).csrfToken;
        assert.equal((await session.delete(root+'/detail/object/1',{headers:{'X-CSRF-Token':token}})).status(),404);
      }finally{await session.dispose();}
    });
    await check('new stable object, same-name separation, idempotency and invalid payload rollback',async()=>{
      const body={request_id:req(),entity_type:'object',definition:{name:'API合成对象',business_meaning:null}};
      obj=await post('/save',body);assert.deepEqual(await post('/save',body),obj);
      other=await save({entity_type:'object',definition:{name:'API合成对象'}});assert.notEqual(other.entity_id,obj.entity_id);
      await post('/save',{...body,definition:{name:'其他内容'}},409);
      await save({entity_type:'object',definition:{name:'',business_meaning:null}},400);
      await save({entity_type:'object',entity_id:0,definition:{name:'无效ID不能当新建'}},400);
      await save({entity_type:'object',definition:{name:'错误标识',unique_identifiers:[null]}},400);
      await save({entity_type:'object',department_id:'93',definition:{name:'越权'}},400);
      assert.equal((await get('/objects')).items.length,2);
      const count=async()=>Number((await pool.execute('SELECT COUNT(*) n FROM data_map_contexts'))[0][0].n),before=await count();
      await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:''}},400);assert.equal(await count(),before);
      await get('/detail/object/'+obj.entity_id,403,'outsider');assert.equal((await get('/objects',200,'outsider')).items.length,0);
    });
    await check('fields bind exact parent; unknown, false and empty enums are distinct',async()=>{
      field=await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'字段甲',required:null,enum_values:null,source:{description:'独立字段来源'}}});
      let v=(await detail('field',field.entity_id)).current;assert.equal(v.definition.required,null);assert.equal(v.definition.enum_values,null);assert.equal(v.base_snapshot.row.object_id,obj.entity_id);
      second=await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'字段乙',required:false,enum_values:[]}});
      v=(await detail('field',second.entity_id)).current;assert.equal(v.definition.required,false);assert.deepEqual(v.definition.enum_values,[]);
      await save({entity_type:'field',entity_id:field.entity_id,expected_revision:1,object_id:other.entity_id,object_version_id:other.version_id,definition:{name:'错误父对象'}},400);
      await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'错误类型',required:'unknown'}},400);
      await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'错误枚举',enum_values:{a:1}}},400);
      assert.equal((await detail('object',obj.entity_id)).fields.length,2);
    });
    await check('single/composite identifiers use fixed versions; malformed and foreign references rejected',async()=>{
      const groups=[{group_id:req(),kind:'single',field_version_ids:[field.version_id]},{group_id:req(),kind:'composite',field_version_ids:[field.version_id,second.version_id]}];
      obj=await save({entity_type:'object',entity_id:obj.entity_id,expected_revision:1,definition:{unique_identifiers:groups}});
      assert.equal((await detail('object',obj.entity_id)).current.definition.unique_identifiers.length,2);
      await save({entity_type:'object',entity_id:other.entity_id,expected_revision:1,definition:{unique_identifiers:groups}},400);
      await save({entity_type:'object',entity_id:obj.entity_id,expected_revision:2,definition:{unique_identifiers:[{group_id:req(),kind:'composite',field_version_ids:[field.version_id]}]}},400);
    });
    await check('concurrent revisions yield one winner; history, original ID/key and null clearing persist',async()=>{
      const before=(await detail('object',obj.entity_id)).current;
      const results=await Promise.all(['一','二'].map(x=>request('contact',root+'/save','POST',{request_id:req(),entity_type:'object',entity_id:obj.entity_id,expected_revision:2,definition:{business_meaning:'并发'+x}})));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const after=(await detail('object',obj.entity_id)).current;assert.equal(after.revision_no,3);assert.equal(after.base_snapshot.row.object_key,before.base_snapshot.row.object_key);
      assert.equal((await get('/version/'+before.version_id)).content_digest,before.content_digest);
      obj=await save({entity_type:'object',entity_id:obj.entity_id,expected_revision:3,definition:{business_meaning:null}});
      assert.equal((await detail('object',obj.entity_id)).current.definition.business_meaning,null);
      assert.equal((await get('/history/object/'+obj.entity_id)).items.length,4);
    });
    await check('template source survives manual revision; source cells cannot be forged',async()=>{
      const bytes=await workbookFixture().bytes(),repository=require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository(pool);
      const session={personId:83,accountId:183,authVersion:1};const who=await repository.templateImportActor(session);
      const prepared=await require('../server/masterDataTemplateImport').prepareImport(bytes,'合成来源.xlsx',[],who);
      const imported=await repository.importTemplate(session,{request_id:req(),original_name:'合成来源.xlsx',links:[],preview_digest:prepared.preview_digest,confirm:true},bytes);
      const target=imported.mappings.find(m=>m.record_type==='object'),original=(await detail('object',target.entity_id)).current;
      const revised=await save({entity_type:'object',entity_id:target.entity_id,expected_revision:1,definition:{source:{description:'人工补充来源'},maintenance:{role_text:'待业务确认'}}});
      const now=(await detail('object',target.entity_id)).current;assert.deepEqual(now.definition.source.cells,original.definition.source.cells);assert.equal(now.definition.source.batch_id,imported.batch_id);
      await save({entity_type:'object',entity_id:target.entity_id,expected_revision:revised.revision_no,definition:{source:{batch_id:'999'}}},400);
      assert((await get('/source/'+imported.batch_id)).cells.length>0);
    });
    await check('retirement impact rechecked; no cascade or deletion; inactive parents reject new fields',async()=>{
      const firstImpact=await get('/impact/object/'+other.entity_id);
      await save({entity_type:'field',object_id:other.entity_id,object_version_id:other.version_id,definition:{name:'影响变化'}});
      const body={request_id:req(),expected_revision:1,confirm:true,reason:'合成停用验证',impact_digest:firstImpact.impact_digest};
      await post('/retire/object/'+other.entity_id,body,409);
      const impact=await get('/impact/object/'+other.entity_id);assert.equal(impact.counts.fields,1);
      const retired=await post('/retire/object/'+other.entity_id,{...body,request_id:req(),impact_digest:impact.impact_digest});
      assert.equal(retired.status,'inactive');assert.equal((await detail('object',other.entity_id)).fields.length,1);
      await save({entity_type:'field',object_id:other.entity_id,object_version_id:retired.version_id,definition:{name:'不能增加'}},409);
      const affected=await get('/impact/field/'+field.entity_id);assert(affected.counts.identifier_versions>=1);
      const retiredField=await post('/retire/field/'+field.entity_id,{request_id:req(),expected_revision:1,confirm:true,reason:'字段停用',impact_digest:affected.impact_digest});
      assert.equal(retiredField.status,'archived');assert.equal((await get('/version/'+field.version_id)).definition.name,'字段甲');
      await save({entity_type:'field',entity_id:field.entity_id,expected_revision:2,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'不可修订停用字段'}},409);
    });
    await check('formal field states and changed legacy base fail closed',async()=>{
      await pool.execute("UPDATE data_map_fields SET status='confirmed' WHERE id=?",[second.entity_id]);
      await save({entity_type:'field',entity_id:second.entity_id,expected_revision:1,object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'越过审核'}},409);
      await get('/detail/field/'+second.entity_id,409);
      await pool.execute("UPDATE data_map_fields SET status='draft' WHERE id=?",[second.entity_id]);
    });
    browserServer=await pw.chromium.launchServer({channel:'msedge',headless:true,host:'127.0.0.1',port:await browserPort()});
    browser=await pw.chromium.connect(browserServer.wsEndpoint());
    const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
    const button=name=>page.getByRole('button',{name,exact:true}),label=name=>page.getByLabel(name,{exact:true});
    const login=async()=>{await page.locator('#login-name').fill('SYNTHETIC_contact');await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await page.getByRole('heading',{name:'管理对象与字段事实',exact:true}).waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('正在处理，请稍候'));};
    const idle=()=>page.waitForFunction(()=>!document.body.textContent.includes('正在处理，请稍候'));
    const longName='页面合成对象：'+('中文长文用于核对显示与换行，'.repeat(9));
    const dismiss=async fn=>{const wait=page.waitForEvent('dialog');const action=fn();await(await wait).dismiss();await action;};
    const noOverflow=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);};
    let uiObject;
    await check('Edge create object, focus, empty-name validation and leave/reload/back protection',async()=>{
      await page.goto(fixture.baseURL+'/app/objects');await login();await page.getByRole('link',{name:'当前身份',exact:true}).click();await page.getByRole('link',{name:'对象与字段',exact:true}).click();await button('新增对象').click();
      assert.equal(await label('对象名称 *').evaluate(el=>el===document.activeElement),true);await button('保存对象').click();await page.getByRole('alert').waitFor();
      await label('对象名称 *').fill(longName);await label('业务含义').fill('此次输入需要在失败、切换与重新登录时保留。');
      await dismiss(()=>page.getByRole('link',{name:'当前身份',exact:true}).click());await dismiss(()=>page.reload().catch(()=>{}));await dismiss(()=>page.goBack().catch(()=>{}));
      assert.equal(await label('对象名称 *').inputValue(),longName);await button('保存对象').click();await idle();await button('修订对象').waitFor();
      const list=await get('/objects?search='+encodeURIComponent(longName));uiObject=list.items[0];assert(uiObject);
    });
    await check('Edge add field under correct parent, true API persistence and refresh',async()=>{
      await button('字段明细').click();assert.equal(await page.getByRole('button',{name:/^新增「/}).count(),1);await page.getByRole('button',{name:/^新增「/}).click();
      assert.equal(await label('字段名称 *').evaluate(el=>el===document.activeElement),true);await label('字段名称 *').fill('页面字段一');await label('字段含义').fill('明确属于页面对象');await label('是否必填').selectOption('unknown');
      // Current form retains its parent if another object is selected and cancelled.
      await dismiss(()=>page.locator('.object-choice').first().click());assert.equal(await label('字段名称 *').inputValue(),'页面字段一');
      await button('保存字段').click();await idle();await button('修订字段').waitFor();
      const read=await detail('object',uiObject.entity_id);assert.equal(read.fields.length,1);assert.equal((await detail('field',read.fields[0].entity_id)).current.definition.required,null);
      await page.reload();await page.getByRole('heading',{name:'管理对象与字段事实',exact:true}).waitFor();await idle();await page.locator('.object-choice').filter({hasText:longName}).click();await idle();await button('字段明细').click();await page.getByRole('button',{name:/^页面字段一 · 字段/}).click();await idle();await button('修订字段').waitFor();
    });
    await check('Edge 403/409/503 and network failures preserve edits; actual 401 re-login restores draft',async()=>{
      await button('修订字段').click();await label('字段含义').fill('失败后必须完整保留的中文修改');
      for(const status of [403,409,503]){await page.route('**'+root+'/save',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_FAILURE'})}),{times:1});await button('保存字段').click();await page.getByRole('alert').waitFor();await idle();assert.equal(await label('字段含义').inputValue(),'失败后必须完整保留的中文修改');}
      await page.route('**'+root+'/save',route=>route.abort(),{times:1});await button('保存字段').click();await page.getByRole('alert').waitFor();await idle();assert.equal(await label('字段含义').inputValue(),'失败后必须完整保留的中文修改');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');await button('保存字段').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login();
      assert.equal(await label('字段含义').inputValue(),'失败后必须完整保留的中文修改');await button('保存字段').click();await idle();await button('修订字段').waitFor();
    });
    await check('Edge explicitly registers single and composite identifiers and revises object without changing its ID',async()=>{
      await page.getByRole('button',{name:/^新增「/}).click();await label('字段名称 *').fill('页面字段二');await button('保存字段').click();await idle();
      await button('对象详情').click();await button('修订对象').click();await page.getByText('单字段与组合唯一标识',{exact:true}).click();await label('标识确认范围').selectOption('defined');
      await button('登记标识组').click();const choices=await page.locator('[aria-label="加入标识字段"] option').evaluateAll(elements=>elements.map(e=>e.value).filter(Boolean));assert.equal(choices.length,2);
      await label('加入标识字段').selectOption(choices[0]);await button('登记标识组').click();await label('标识类型').nth(1).selectOption('composite');await label('加入标识字段').nth(1).selectOption(choices[0]);await label('加入标识字段').nth(1).selectOption(choices[1]);
      await button('保存对象').click();await idle();const response=await page.request.get(fixture.baseURL+root+'/detail/object/'+uiObject.entity_id);assert.equal(response.status(),200);const current=(await response.json()).current;assert.equal(current.entity_id,uiObject.entity_id);assert.equal(current.revision_no,2);assert.equal(current.definition.unique_identifiers.length,2);
      await page.getByText('唯一标识',{exact:true}).click();assert((await page.locator('.definition-detail').innerText()).includes('组合唯一标识'));await button('字段明细').click();await page.getByRole('button',{name:/^页面字段一 · 字段/}).click();await idle();
    });
    await check('Edge immutable history, desktop/mobile layout and explicit retirement cancellation/confirmation',async()=>{
      await button('查看版本历史').click();await idle();await page.locator('.history-list button').filter({hasText:'修订 1 ·'}).click();await idle();assert((await page.locator('.definition-detail').innerText()).includes('明确属于页面对象'));
      await button('返回当前版本').click();await noOverflow();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'field-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});await noOverflow();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'field-mobile.png'),fullPage:true});
      await button('查看停用影响').click();await idle();await label('停用原因').fill('仅合成数据的停用验证');await dismiss(()=>button('确认停用并保留历史').click());assert.equal(await label('停用原因').inputValue(),'仅合成数据的停用验证');
      await noOverflow();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'retirement-mobile.png'),fullPage:true});
      page.once('dialog',dialog=>dialog.accept());await button('确认停用并保留历史').click();await idle();assert((await page.locator('.definition-detail').innerText()).includes('已停用'));assert.equal(await button('修订字段').count(),0);
      await page.setViewportSize({width:1699,height:828});await button('对象详情').click();await button('查看停用影响').click();await idle();assert((await page.locator('.management-main').innerText()).includes('所属字段'));await label('停用原因').fill('对象演示结束');page.once('dialog',dialog=>dialog.accept());await button('确认停用并保留历史').click();await idle();await noOverflow();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'object-retired-desktop.png'),fullPage:true});
    });
    await check('Edge template source remains locatable in groups with original cells and unchanged bytes',async()=>{
      await page.locator('.object-choice').filter({hasText:'合成对象'}).filter({hasNotText:'API合成对象'}).filter({hasNotText:'页面合成对象'}).click();await idle();await button('查看源单元格原值').click();await idle();assert((await page.locator('.definition-detail').innerText()).includes('主数据对象名称'));
      await page.setViewportSize({width:390,height:844});await noOverflow();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'source-mobile.png'),fullPage:true});await page.setViewportSize({width:1699,height:828});
    });
    await check('Edge replaced async response cannot restore old selection and browser stays clean',async()=>{
      let release;const gate=new Promise(resolve=>{release=resolve;});
      await page.route('**'+root+'/detail/object/'+obj.entity_id,async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});
      await page.locator('.object-choice').filter({hasText:'对象 '+obj.entity_id+' ·'}).click();await page.locator('.object-choice').filter({hasText:longName}).click();await idle();release();await page.unrouteAll({behavior:'wait'});
      assert((await page.locator('.management-main h2').first().innerText()).includes(longName));assert.deepEqual(errors,[]);
      const unexpected=consoleErrors.filter(e=>!/Failed to load resource:.*(401|403|409|503|net::ERR_FAILED)/.test(e));assert.deepEqual(unexpected,[]);
    });
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,viewport:[{width:1699,height:828},{width:390,height:844}],browser:'Microsoft Edge, 100% zoom',consoleErrors,scope:'owned MySQL and real API; synthetic data; failure statuses 403/409/503/network explicitly injected',human_acceptance:false},null,2));
  }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,checks},null,2));throw error;}
  finally{
    const cleanup={owned_browser_pid:browserServer?.process().pid||null};
    try{if(browser)await bounded(browser.close());cleanup.client_closed=true;}catch{cleanup.client_close_timeout=true;}
    if(browserServer){
      try{await bounded(browserServer.close());cleanup.graceful=true;}
      catch{await bounded(browserServer.kill());cleanup.forced_owned_browser_only=true;}
      assert(browserServer.process().exitCode!==null||browserServer.process().signalCode!==null,'owned browser process exited');
    }
    fs.writeFileSync(path.join(output,'browser-cleanup.json'),JSON.stringify(cleanup,null,2));
  }
},{evidenceDir:output,previewOnly:true});}
main().catch(error=>{console.error(error);process.exitCode=1;});
