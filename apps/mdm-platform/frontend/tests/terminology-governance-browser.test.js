import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Explicit synthetic candidate only. The ordinary frontend unit run skips Edge.
test('Edge desktop terminology drafts, history, fixed references and failure recovery', {skip:process.env.MDM_TERMINOLOGY_BROWSER!=='1',timeout:120000},async()=>{
  const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),frontend=path.resolve(here,'..');
  require('../../scripts/testHelpers/ownedBrowserRuntime.js');
  let runtime;try{runtime=require('playwright');}catch{runtime=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}
  const outputAt=process.argv.indexOf('--output'),output=outputAt>=0?path.resolve(process.argv[outputAt+1]):path.resolve(frontend,'../../../artifacts/terminology-governance-20261020/frontend-browser-'+Date.now());
  assert(output.startsWith(path.resolve(frontend,'../../../artifacts')+path.sep));fs.mkdirSync(output,{recursive:true});
  const dist=path.resolve(frontend,'dist'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'),assetPath=url.pathname.replace(/^\/app\//,'/'),file=url.pathname==='/logo.png'?path.resolve(frontend,'../public/logo.png'):assetPath.startsWith('/assets/')?path.resolve(dist,'.'+assetPath):path.join(dist,'index.html');
    if(!file.startsWith(dist+path.sep)&&file!==path.resolve(frontend,'../public/logo.png')){res.writeHead(403);res.end();return;}
    try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,browser=await runtime.chromium.launch({channel:'msedge',headless:true,timeout:20000});
  const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const idA='11111111-1111-4111-8111-111111111111',idB='22222222-2222-4222-8222-222222222222',versionA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',versionB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const records={
    [idA]:{term_id:idA,version_id:versionA,term:'合成有效术语',definition:'合成标准的原定义，不自动替换业务文本。',context:'合成语境甲',concept_key:'SYNTHETIC_CONCEPT_A',source_kind:'gbt',source_status:'current',adoption_status:'adopted',usable:true,revision_no:3,usage_token:'token-a',source:{standard_number:'GB/T 00001',standard_version:'2026',standard_clause:'3.1',original_definition:'合成标准的原定义，不自动替换业务文本。',company_application:'公司合成适用说明，与标准原文分开保存。'},versions:[{version_id:versionA,created_at:'2026-10-20',content:{term:'合成有效术语',definition:'合成标准的原定义，不自动替换业务文本。',context:'合成语境甲',source_kind:'gbt',original_definition:'合成标准的原定义，不自动替换业务文本。'}}],events:[],allowed_actions:[]},
    [idB]:{term_id:idB,version_id:versionB,term:'合成同名语境乙',definition:'语境乙的独立概念。',context:'合成语境乙',source_kind:'custom',source_status:'current',adoption_status:'adopted',usable:true,revision_no:2,usage_token:'token-b',source:{},versions:[],events:[],allowed_actions:['create_challenge']}
  };
  let mode='reader',expireNext=false,slowA=false,createAttempt=0,fixed=false,usage={enabled:true,revision_no:0,source_digest:'synthetic-source-digest',items:[],reason:'',source_positions:[{location:'/process/process_name',source_text:'合成业务原文，原样保留',label:'流程名称'}],findings:[],allowed_actions:['save']};
  const writes=[],checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname,send=(json,status=200)=>route.fulfill({status,json});
    if(pathname==='/api/org/session')return send({authenticated:true});
    if(pathname==='/api/org/me')return send({personId:'41',departmentId:'91',personName:'合成测试人员',departmentName:'合成部门',employeeNo:'SYNTHETIC',permissions:mode==='contact'?['governance:read-department','governance:draft-department']:['governance:read-department'],roleCodes:[]});
    if(pathname==='/api/org/me/password-status')return send({is_default_password:false});
    if(pathname==='/api/org/login'||pathname==='/api/org/logout')return send({ok:true});
    if(pathname==='/api/csrf-token')return send({csrfToken:'synthetic-csrf'});
    if(pathname==='/api/terminology/17')return send({id:17,governance_term_id:idA});
    if(pathname==='/api/terminology-governance/capabilities'){
      if(expireNext){expireNext=false;return send({code:'SESSION_AUTHORIZATION_CHANGED',error:'合成会话已失效'},401);}
      return send({enabled:true,ready:true,allowed_actions:mode==='contact'?['create_term']:[]});
    }
    if(pathname==='/api/terminology-governance/terms'&&request.method()==='GET')return send({items:Object.values(records)});
    if(pathname==='/api/terminology-governance/terms'&&request.method()==='POST'){
      const body=request.postDataJSON();writes.push({pathname,body});createAttempt+=1;
      if(createAttempt===1)return send({code:'TERM_GOVERNANCE_CONCEPT_EXISTS',error:'合成重复概念，请修正语境核对信息'},409);
      if(createAttempt===2)return send({code:'TERM_GOVERNANCE_WRITE_UNKNOWN',error:'合成提交回执不明'},503);
      return send({...records[idA],term:body.term});
    }
    if(pathname.endsWith('/usages')&&pathname.includes('/terms/'))return send({items:[{target_type:'process_draft',target_id:'3',source_digest:'synthetic-impact-digest',revision_no:2,fixed:false,impact_allowed:mode==='mdm',impact_decisions:[],items:[{location:'/process/process_name',version_id:versionA,reason:'合成影响依据'}]}]});
    if(pathname==='/api/terminology-governance/usages'&&request.method()==='GET')return send({...usage,fixed,allowed_actions:fixed?[]:['save']});
    if(pathname==='/api/terminology-governance/usages'&&request.method()==='POST'){
      const body=request.postDataJSON();writes.push({pathname,body});usage={...usage,items:body.items,reason:body.reason,revision_no:usage.revision_no+1};return send({ok:true});
    }
    if(pathname==='/api/terminology-governance/usages/impacts'&&request.method()==='POST'){writes.push({pathname,body:request.postDataJSON()});return send({ok:true});}
    if(pathname.endsWith('/challenges'))return send({items:[]});
    const id=pathname.split('/').at(-1);
    if(records[id]){if(slowA&&id===idA)await new Promise(resolve=>setTimeout(resolve,400));return send(records[id]).catch(()=>{});}
    return send({});
  });
  const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
  async function screenshot(name){if(name==='desktop-public-dictionary')await page.locator('.workspace').evaluate(element=>element.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'desktop must not overflow horizontally');assert.equal(await page.evaluate(()=>visualViewport.scale),1);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
  try{
    await page.goto(base+'/app/terms?id='+idA);await page.locator('[data-term-governance-detail]').waitFor();
    assert.equal(await button('提报新术语').count(),0);assert.equal(await button('审核通过').count(),0);await page.getByText('公司合成适用说明，与标准原文分开保存。',{exact:true}).waitFor();
    await button('查看当前有权读取的引用').click();await page.getByRole('link',{name:'流程草稿 · 3',exact:true}).waitFor();await screenshot('desktop-public-dictionary');
    checks.push('effective dictionary is readable, standards and company application are separate, allowed_actions hide writes, reverse usage link is concrete');
    slowA=true;await page.getByRole('button',{name:/合成同名语境乙.*合成语境乙/}).click();await page.getByRole('heading',{name:/合成同名语境乙 ·/}).waitFor();await page.getByRole('button',{name:/合成有效术语.*合成语境甲/}).click();await page.getByRole('button',{name:/合成同名语境乙.*合成语境乙/}).click();await page.getByRole('heading',{name:/合成同名语境乙 ·/}).waitFor();await page.waitForTimeout(500);assert.equal(await page.locator('[data-term-governance-detail]').getAttribute('data-term-governance-detail'),idB);slowA=false;
    checks.push('late response from another term cannot overwrite the selected detail');
    mode='contact';await page.goto(base+'/app/terms');await button('提报新术语').click();
    await field('术语名称 *').fill('合成待提交术语');await field('业务语境 / 适用条件 *').fill('合成待确认语境');assert.equal(await field('概念标识 *').count(),0);await field('拟采用定义 *').fill('合成未提交定义，不得进入浏览器持久存储');
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('link',{name:'我的工作台',exact:true}).click();assert(page.url().includes('/app/terms'));assert.equal(await field('术语名称 *').inputValue(),'合成待提交术语');
    expireNext=true;await button('刷新词典').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await page.locator('#login-name').fill('SYNTHETIC');await page.locator('#login-password').fill('synthetic-test-only');await button('登录').click();await field('术语名称 *').waitFor();assert.equal(await field('术语名称 *').inputValue(),'合成待提交术语');
    checks.push('canceled route change and same-identity reauthentication retain the unsaved terminology draft');
    await button('确认提交').click();await page.getByText('TERM_GOVERNANCE_CONCEPT_EXISTS：合成重复概念，请修正语境核对信息',{exact:true}).waitFor();assert.equal(await field('术语名称 *').isEditable(),true);await field('术语名称 *').fill('合成修正术语');
    await button('确认提交').click();await page.getByText('办理结果尚未确认',{exact:true}).waitFor();assert.equal(await field('术语名称 *').isEditable(),false);assert.equal(writes.length,2);await screenshot('desktop-unknown-write-preserved');
    page.once('dialog',dialog=>dialog.accept());await button('按原请求核对结果').click();await page.getByText('本次术语办理已保存，请核对当前状态及留痕。',{exact:true}).waitFor();assert.notEqual(writes[0].body.request_id,writes[1].body.request_id);assert.deepEqual(writes[1].body,writes[2].body);
    const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!storage.includes('合成未提交定义'));
    checks.push('409 keeps input editable and specific error; ambiguous write freezes exact request and only explicit idempotent reconciliation reuses it; no business input persisted');
    await page.goto(base+'/app/terms?target_type=process_draft&target_id=3');await page.locator('[data-terminology-references]').waitFor();await button('记录术语引用判断').click();await field('加入具体来源位置').selectOption('/process/process_name');await field('人工核对结果').selectOption('unlisted');await field('判断依据 / 含义说明 / 差异原因').fill('合成业务含义已确认，当前无适用词条');await button('保存人工核对结果').click();await page.getByText('术语引用核对已保存。原文、来源位置和判断依据保留，请核对最新检查结果。',{exact:true}).waitFor();assert.equal(writes.at(-1).body.items[0].source_text,'合成业务原文，原样保留');assert.equal(writes.at(-1).body.items[0].term_id,null);
    checks.push('unlisted confirmed business meaning saves evidence and the exact source text without fabricating a term');
    fixed=true;usage={...usage,items:[{location:'/process/process_name',source_text:'合成历史原文',decision:'match',reason:'合成固定依据',term_id:idA,version_id:versionA,term_snapshot:records[idA]}]};await page.goto(base+'/app/terms?target_type=process_version&target_id=3');await page.getByText('当前为正式版本固定引用，只读查阅原定义与原判断。后续词典变化由影响检查提示，历史引用保持原样。',{exact:true}).waitFor();assert.equal(await button('记录术语引用判断').count(),0);await page.getByText('查看引用时的固定定义与来源',{exact:true}).click();await screenshot('desktop-fixed-reference-history');
    checks.push('formal reference remains read only while original fixed definition, standard source and company application remain inspectable');
    await page.goto(base+'/app/terms?target_type=data_definition&target_id=9007199254741001');await page.getByText('当前为固定数据定义版本，术语引用只读。是否经过审核发布以该定义版本的治理状态为准；历史引用保持原样。',{exact:true}).waitFor();assert.equal(await button('记录术语引用判断').count(),0);assert.equal(await page.getByText('当前为正式版本固定引用，只读查阅原定义与原判断。后续词典变化由影响检查提示，历史引用保持原样。',{exact:true}).count(),0);await screenshot('desktop-fixed-data-definition-status');checks.push('fixed data definition reference is read only without claiming that historical data has passed formal approval');
    mode='mdm';await page.goto(base+'/app/terms?id='+idA);await button('查看当前有权读取的引用').click();await button('记录该引用的影响处置').click();await field('引用影响处置').selectOption('later_revision');await field('原因 / 判断依据').fill('合成MDM已与责任部门确认安排后续修订，原固定版本保留');assert.equal(writes.filter(row=>row.pathname.endsWith('/usages/impacts')).length,0);await screenshot('desktop-explicit-impact-decision');await button('确认提交').click();await page.getByText('本次术语办理已保存，请核对当前状态及留痕。',{exact:true}).waitFor();const impact=writes.at(-1).body;assert.equal(impact.decision,'later_revision');assert.equal(impact.expected_revision,2);assert.equal(impact.source_digest,'synthetic-impact-digest');assert.equal(impact.term_id,idA);checks.push('MDM impact disposition requires an explicit choice and evidence and sends the original target revision without changing historical text or creating tasks');
    await page.goto(base+'/app/terms?term=17');await page.locator('[data-term-governance-detail="'+idA+'"]').waitFor();checks.push('numeric historical todo link resolves through the explicit old-to-new mapping');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:true,checks,errors,viewport:{width:1699,height:828,scale:1},channel:'msedge',syntheticApi:true,realMysql:false},null,2)+'\n');
  }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,checks,errors,url:page.url(),text:await page.locator('body').innerText().catch(()=>'' )},null,2));throw error;}
  finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
