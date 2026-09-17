// P04 real API/MySQL/Edge verification. --output must be a NEW artifacts directory.
// Uses only owned tmpfs MySQL, synthetic workbooks/identities and free loopback
// ports. No private config, production DB, external workbook or browser download.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {fixture:workbookFixture}=require('./testHelpers/masterDataTemplateFixture');
const {applyDefinitions}=require('../server/dataMapDefinitionMigration');
const {tables}=require('../server/dataMapDefinitionSchema');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
const index=process.argv.indexOf('--output');
assert(index>=0&&process.argv[index+1],'--output is required');
const output=path.resolve(process.argv[index+1]),artifacts=path.resolve(__dirname,'../../../artifacts');
assert(output.startsWith(artifacts+path.sep)&&!fs.existsSync(output),'use a new directory inside repository artifacts');
fs.mkdirSync(output,{recursive:true});
const checks=[];
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){
  await withStage05Fixture(async({pool,fixture})=>{
    const pw=runtime(),clients=[],base=fixture.baseURL,endpoint='/api/master-data-template';
    let browser,page;
    async function client(name){
      const context=await pw.request.newContext({baseURL:base});clients.push(context);
      assert.equal((await context.post('/api/org/login',{data:{loginName:'SYNTHETIC_'+name,password:fixture.loginPassword}})).status(),200);
      const token=(await (await context.get('/api/csrf-token')).json()).csrfToken;
      return {context,token};
    }
    async function upload(who,action,bytes,options={},status=200){
      const response=await who.context.post(endpoint+'/'+action,{headers:{'X-CSRF-Token':who.token},multipart:{file:{name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes},options:JSON.stringify(options)}});
      const body=await response.json();assert.equal(response.status(),status,`${action}: ${JSON.stringify(body)}`);return body;
    }
    async function get(who,url,status=200){const response=await who.context.get(endpoint+url);const body=await response.json();assert.equal(response.status(),status,JSON.stringify(body));return body;}
    const allTables=['data_map_objects','data_map_fields','data_map_contexts','data_map_import_batches',...tables];
    async function counts(){const out={};for(const table of allTables)out[table]=(await pool.execute(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n;return out;}
    const opts=(p,requestId=crypto.randomUUID())=>({links:p.links,preview_digest:p.preview_digest,request_id:requestId,confirm:true});
    const wb=workbookFixture(),bytes=await wb.bytes();
    try {
      const contact=await client('contact'),admin=await client('admin'),adminMulti=await client('adminMulti'),reader=await client('reviewA');
      await check('missing migration fails closed without startup DDL',async()=>{
        assert.equal((await get(contact,'/capabilities',503)).code,'DEFINITION_MIGRATION_REQUIRED');
      });
      await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn,owner_dept_id,description) VALUES (600,'p04_legacy','合成对象',91,'旧台账原文')");
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES (600,'p04_context','旧场景',91)");
      await pool.execute("INSERT INTO data_map_fields(id,context_id,object_id,field_key,field_name_cn) VALUES (600,600,600,'p04_legacy_field','旧字段'),(601,600,NULL,'p04_orphan','未归属字段')");
      const connection=await pool.getConnection();try{await applyDefinitions(connection);}finally{connection.release();}
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 86,role_id,'department',93,'P04 synthetic writer',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 88,role_id,'department',91,'P04 synthetic admin writer',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
      const other=await client('outsider');
      const legacy=await get(contact,'/definition/object/600');
      await check('permission, multi-role admin read-only, anonymous and CSRF boundaries',async()=>{
        await upload(admin,'preview',bytes,{},403);await upload(adminMulti,'preview',bytes,{},403);await upload(reader,'preview',bytes,{},403);
        const anon=await pw.request.newContext({baseURL:base});try{assert.equal((await anon.get(endpoint+'/capabilities')).status(),401);}finally{await anon.dispose();}
        assert.equal((await contact.context.post(endpoint+'/preview',{multipart:{file:{name:'s.xlsx',mimeType:'application/octet-stream',buffer:bytes},options:'{}'}})).status(),403);
        await get(admin,'/definition/object/600');
      });
      let preview,result;
      await check('real preview performs no business writes and ignores samples/reserved rows',async()=>{
        const before=await counts();preview=await upload(contact,'preview',bytes,{links:[]});
        assert.equal(preview.preview.status,'preview_ready');assert.equal(preview.preview.summary.object_count,1);assert.equal(preview.preview.summary.field_count,1);assert.deepEqual(await counts(),before);
        const unicode=await contact.context.post(endpoint+'/preview',{headers:{'X-CSRF-Token':contact.token},multipart:{file:{name:'主数据合成填报.xlsx',mimeType:'application/octet-stream',buffer:bytes},options:'{}'}});
        assert.equal(unicode.status(),200);assert.equal((await unicode.json()).preview.source.original_name,'主数据合成填报.xlsx');
        const large=workbookFixture();for(const key of ['creation_scenario','source_location','usage_scope','usage_scenario','storage_location','current_source'])large.set('object',17,key,'合成'.repeat(2300));
        const tooLarge=await upload(contact,'preview',await large.bytes(),{});assert(tooLarge.preview.issues.some(i=>i.code==='TEMPLATE_DEFINITION_LIMIT'));assert.equal(tooLarge.preview.validation_passed,false);
      });
      await check('confirmation reparses original bytes and rejects invalid fields, stale previews and no consent',async()=>{
        const before=await counts(),bad=workbookFixture();bad.set('field',53,'object_local_id','MISSING');
        const invalid=await upload(contact,'preview',await bad.bytes(),{});assert(invalid.preview.issues.some(i=>i.code==='TEMPLATE_OBJECT_REFERENCE'));
        await upload(contact,'confirm',await bad.bytes(),opts(preview),400);
        await upload(contact,'confirm',bytes,{...opts(preview),preview_digest:'0'.repeat(64)},409);
        await upload(contact,'confirm',bytes,{...opts(preview),confirm:false},400);
        await upload(contact,'confirm',bytes,{...opts(preview),department_id:'93'},400);
        assert.deepEqual(await counts(),before);
      });
      await check('one transaction rolls back source, object, field, version and request on partial write failure',async()=>{
        const before=await counts();
        await pool.query("CREATE TRIGGER p04_fail_field BEFORE INSERT ON data_map_fields FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='P04_SYNTHETIC_FIELD_FAILURE'");
        try{const failed=await upload(contact,'confirm',bytes,opts(preview),503);assert(!JSON.stringify(failed).includes('SQL'));}finally{await pool.query('DROP TRIGGER p04_fail_field');}
        assert.deepEqual(await counts(),before);
      });
      await check('same request concurrent retries create exactly one batch, stable objects and fields',async()=>{
        const options=opts(preview);const [a,b]=await Promise.all([upload(contact,'confirm',bytes,options),upload(contact,'confirm',bytes,options)]);
        assert.deepEqual(a,b);result=a;assert.equal(a.mappings.length,2);assert.equal(a.verification_status,'pending_verification');
        const object=a.mappings.find(m=>m.record_type==='object');assert.notEqual(object.entity_id,'600');
        assert.equal((await get(contact,'/definition/object/600')).content_digest,legacy.content_digest);
        assert.equal((await get(contact,'/definition/object/'+object.entity_id)).definition.governance,null);
        const changed=workbookFixture();changed.set('object',17,'name','另一个合成对象');const changedBytes=await changed.bytes();
        const pp=await upload(contact,'preview',changedBytes,{});await upload(contact,'confirm',changedBytes,opts(pp,options.request_id),409);
      });
      await check('new request returns existing batch; different departments retain their own OBJ-001',async()=>{
        const before=await counts();const repeat=await upload(contact,'confirm',bytes,opts(preview));assert.equal(repeat.batch_id,result.batch_id);assert(repeat.duplicate);
        const after=await counts();for(const table of allTables.filter(t=>t!=='data_map_definition_requests'))assert.equal(after[table],before[table],table);
        const p=await upload(other,'preview',bytes,{}),separate=await upload(other,'confirm',bytes,opts(p));assert.notEqual(separate.batch_id,result.batch_id);
        assert.notEqual(separate.mappings[0].entity_id,result.mappings[0].entity_id);
        await get(other,'/source/'+result.batch_id,403);await get(other,'/definition/object/'+result.mappings[0].entity_id,403);
        await upload(other,'confirm',bytes,opts(preview),409);
      });
      await check('source cells, local ID mappings and fixed versions can be queried without changing old rows',async()=>{
        const source=await get(contact,'/source/'+result.batch_id);assert.equal(source.raw_sha256,preview.preview.source.raw_sha256);
        assert.equal(source.mappings.length,2);assert(source.cells.some(c=>c.cell_address==='J53'&&c.raw_value==='00107'));
        for(const mapping of source.mappings){assert(mapping.source_cell_ids.length>0);const v=await get(contact,'/version/'+mapping.platform_version_id);assert.equal(v.entity_id,mapping.platform_entity_id);}
        assert.equal((await get(contact,'/definition/object/600')).base_snapshot.row.object_key,'p04_legacy');
      });
      let revisedBytes,revisedPreview;
      await check('explicit existing object and field revisions keep stable IDs and prior version bytes',async()=>{
        const updated=workbookFixture();updated.set('object',17,'name','明确修订后的对象');updated.set('field',53,'meaning','修订后的字段含义');revisedBytes=await updated.bytes();
        const links=result.mappings.map(m=>({record_type:m.record_type,source_row:m.source_row,entity_id:m.entity_id,expected_revision:m.revision_no}));
        revisedPreview=await upload(contact,'preview',revisedBytes,{links});
        const saved=await upload(contact,'confirm',revisedBytes,opts(revisedPreview));
        for(const m of saved.mappings){assert.equal(m.revision_no,2);assert.equal(m.entity_id,result.mappings.find(x=>x.record_type===m.record_type).entity_id);}
        const original=await get(contact,'/version/'+result.mappings[0].version_id);assert.equal(original.definition.name,'合成对象');
        assert.equal((await get(contact,'/definition/object/'+result.mappings[0].entity_id)).definition.name,'明确修订后的对象');
        const incompatible=await upload(contact,'preview',revisedBytes,{});await upload(contact,'confirm',revisedBytes,opts(incompatible),409);
      });
      await check('stale revisions and orphan target fields cannot partially revise an object',async()=>{
        const altered=workbookFixture();altered.set('object',17,'name','冲突合成对象');const changed=await altered.bytes();
        const p=await upload(contact,'preview',changed,{}),before=await counts();
        // Obtain a preview at revision 2, then append a competing revision.
        const target=result.mappings.find(m=>m.record_type==='object');
        const links=[{record_type:'object',source_row:17,entity_id:target.entity_id,expected_revision:2}];
        const stale=await upload(contact,'preview',changed,{links});
        const repo=require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository(pool);
        await repo.saveDefinition({personId:83,accountId:183,authVersion:1},{request_id:crypto.randomUUID(),entity_type:'object',entity_id:target.entity_id,expected_revision:2,definition:{business_meaning:'合成并发修订'}});
        const afterEdit=await counts();await upload(contact,'confirm',changed,opts(stale),409);assert.deepEqual(await counts(),afterEdit);
        const orphan=await upload(contact,'preview',changed,{links:[{record_type:'field',source_row:53,entity_id:'601',expected_revision:1}]});
        await upload(contact,'confirm',changed,opts(orphan),400);assert.deepEqual(await counts(),afterEdit);
      });

      browser=await pw.chromium.launch({channel:'msedge',headless:true});
      const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(15000);
      const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
      async function login(){await page.locator('#login-name').fill('SYNTHETIC_contact');await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'导入本部门主数据模板',exact:true}).waitFor();}
      const uiWb=workbookFixture();uiWb.set('object',17,'name','页面导入的合成对象');const uiBytes=await uiWb.bytes();
      const uiFile={name:'synthetic-ui.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:uiBytes};
      const select=()=>page.getByLabel('选择主数据模板文件').setInputFiles(uiFile);
      const inspect=async()=>{await page.getByRole('button',{name:'检查文件与关联',exact:true}).click();await page.getByRole('button',{name:'明确确认导入',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='正在处理…'));};
      const assertFile=async()=>assert((await page.locator('.file-name').innerText()).includes(uiFile.name));
      async function dismiss(action){const dialog=page.waitForEvent('dialog');const pending=action();await(await dialog).dismiss();await pending;await assertFile();}
      async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);}
      await check('Edge real upload preview and cancelled back, reload, replacement and cancellation preserve input',async()=>{
        await page.goto(base+'/app/template-import');await login();
        await page.getByRole('link',{name:'当前身份',exact:true}).click();await page.getByRole('link',{name:'模板导入',exact:true}).click();await page.getByRole('heading',{name:'导入本部门主数据模板',exact:true}).waitFor();
        await select();await inspect();await assertFile();
        await page.getByRole('button',{name:'返回修正，保留当前文件'}).click();await assertFile();assert(await page.getByRole('button',{name:'明确确认导入',exact:true}).isDisabled());
        assert.equal(await page.getByRole('button',{name:'更换模板文件'}).evaluate(el=>el===document.activeElement),true);await inspect();
        await dismiss(()=>page.getByRole('link',{name:'当前身份',exact:true}).click());
        await dismiss(()=>page.goBack().catch(()=>{}));await page.waitForURL('**/app/template-import');
        await dismiss(()=>page.reload().catch(()=>{}));
        await dismiss(()=>page.getByLabel('选择主数据模板文件').setInputFiles({...uiFile,name:'replacement.xlsx'}));
        await dismiss(()=>page.getByRole('button',{name:'取消本次导入'}).click());
        await noOverflow();await page.screenshot({path:path.join(output,'preview-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:844});await noOverflow();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'preview-mobile.png'),fullPage:true});
        await page.setViewportSize({width:1699,height:828});
      });
      await check('403/409/503 and network errors retain file and preview without automatic write retries',async()=>{
        for(const status of [403,409,503]){
          await page.route('**'+endpoint+'/confirm',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_ERROR'})}),{times:1});
          await page.getByRole('button',{name:'明确确认导入',exact:true}).click();await page.getByRole('alert').waitFor();await assertFile();assert(await page.getByRole('heading',{name:'检查结果',exact:true}).isVisible());
        }
        await page.route('**'+endpoint+'/confirm',route=>route.abort('failed'),{times:1});await page.getByRole('button',{name:'明确确认导入',exact:true}).click();await page.getByRole('alert').waitFor();await assertFile();
      });
      await check('real 401 and same-user reauthentication preserve selected bytes and require a new preview',async()=>{
        await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=83');
        await page.getByRole('button',{name:'明确确认导入',exact:true}).click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login();await assertFile();
        assert(await page.getByRole('button',{name:'明确确认导入',exact:true}).isDisabled());await inspect();
      });
      await check('page imports into real MySQL then queries stable IDs and original source cells',async()=>{
        await page.getByRole('button',{name:'明确确认导入',exact:true}).click();await page.getByRole('heading',{name:'导入完成，待核实',exact:true}).waitFor();
        assert(await page.getByRole('button',{name:'结束查看',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'取消本次导入',exact:true}).count(),0);
        await page.getByRole('button',{name:'重新查询对象、字段与来源'}).click();await page.getByRole('button',{name:/OBJ-001 → 平台对象/}).waitFor();
        await page.getByRole('button',{name:/OBJ-001 → 平台对象/}).click();await page.getByText(/平台编号.*修订 1.*待核实/).waitFor();
        await page.screenshot({path:path.join(output,'imported-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:844});await noOverflow();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'imported-mobile.png'),fullPage:true});
        const [[actual]]=await pool.execute("SELECT CAST(id AS CHAR) AS id,status FROM data_map_objects WHERE object_name_cn='页面导入的合成对象'");assert(actual&&actual.status==='draft');
        assert.equal((await pool.execute("SELECT description FROM data_map_objects WHERE id=600"))[0][0].description,'旧台账原文');
      });
      await check('page explicit revision selection, actual replacement, stale preview cancellation and long source details',async()=>{
        await page.setViewportSize({width:1699,height:828});
        const [[object]]=await pool.execute("SELECT CAST(id AS CHAR) AS id FROM data_map_objects WHERE object_name_cn='页面导入的合成对象'");
        const [[field]]=await pool.execute('SELECT CAST(id AS CHAR) AS id FROM data_map_fields WHERE object_id=?',[object.id]);
        const replacement=workbookFixture();replacement.set('object',17,'name','页面明确修订的合成对象');replacement.set('field',53,'meaning','中文字段含义'.repeat(50));const replacementBytes=await replacement.bytes();
        const accept=page.waitForEvent('dialog');const choosing=page.getByLabel('选择主数据模板文件').setInputFiles({...uiFile,name:'revision.xlsx',buffer:replacementBytes});await(await accept).accept();await choosing;
        assert.equal(await page.getByRole('heading',{name:'检查结果',exact:true}).count(),0);await inspect();
        for(const [local,id] of [['OBJ-001',object.id],['FLD-001',field.id]]){
          await page.getByLabel(local+'入库方式',{exact:true}).selectOption('revision');await page.getByLabel(local+'平台编号',{exact:true}).fill(id);
          await page.getByRole('button',{name:'核对 '+local+' 关联',exact:true}).click();await page.getByText(new RegExp('已核对：.*平台编号 '+id+'，修订 1')).waitFor();
        }
        await inspect();await page.setViewportSize({width:390,height:844});await noOverflow();
        await page.locator('details').last().locator('summary').click();await noOverflow();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'revision-source-mobile.png'),fullPage:true});
        await page.getByRole('button',{name:'明确确认导入',exact:true}).click();await page.getByRole('heading',{name:'导入完成，待核实',exact:true}).waitFor();
        const [[head]]=await pool.execute("SELECT revision_no FROM data_map_definition_heads WHERE entity_type='object' AND entity_id=?",[object.id]);assert.equal(head.revision_no,2);
        // Delay a real preview response, navigate with explicit consent, and
        // ensure the late response cannot reintroduce a discarded file.
        const prompt=page.waitForEvent('dialog');const change=select();await(await prompt).accept();await change;
        let release;const gate=new Promise(resolve=>{release=resolve;});let reached;
        const intercepted=new Promise(resolve=>{reached=resolve;});
        await page.route('**'+endpoint+'/preview',async route=>{const response=await route.fetch();reached();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});
        await page.getByRole('button',{name:'检查文件与关联',exact:true}).click();await intercepted;
        const leaving=page.waitForEvent('dialog');const click=page.getByRole('link',{name:'当前身份',exact:true}).click();await(await leaving).accept();await click;release();
        await page.getByRole('link',{name:'模板导入',exact:true}).click();await page.getByRole('heading',{name:'导入本部门主数据模板',exact:true}).waitFor();assert.equal(await page.locator('.file-name').count(),0);
      });
      await check('browser rendering has no page errors or unexpected console errors',async()=>{
        assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors.filter(e=>!/Failed to load resource:.*(401|403|409|503|ERR_FAILED)/.test(e)),[]);
      });
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,viewport:[1699,828,390,844],browser:'Microsoft Edge, 100% zoom',mysql:'owned tmpfs fixture; real HTTP and persisted synthetic data',browserFailureInjection:[403,409,503,'network'],realSessionExpiry:true,counts:await counts(),pageErrors:errors,consoleErrors,human_acceptance:false},null,2));
    }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,checks},null,2));throw error;}
    finally{if(browser)await browser.close();for(const c of clients)await c.dispose();}
  },{evidenceDir:output,previewOnly:true});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
