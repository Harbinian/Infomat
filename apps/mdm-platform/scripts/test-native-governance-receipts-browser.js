// Input: optional --output <new directory inside artifacts/...-20261020-02>.
// Run: node apps/mdm-platform/scripts/test-native-governance-receipts-browser.js
// Output: screenshots, source hashes and JSON evidence in a new browser-UUID directory.
// Side effects: one owned random loopback Vite server and one owned Edge process, closed
// in finally. Real React components/API client, synthetic API responses; no MySQL,
// formal services, private configuration, migrations, deployment or feature activation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const net = require('node:net');

const repository = path.resolve(__dirname, '../../..');
const frontend = path.join(repository, 'apps/mdm-platform/frontend');
const evidenceRoot = path.join(repository, 'artifacts/mdm-data-governance-handoff-implementation-20261020-02');
const outputFlag = process.argv.indexOf('--output');
const output = outputFlag >= 0 ? path.resolve(process.argv[outputFlag + 1] || '') : path.join(evidenceRoot, 'browser-' + randomUUID());
assert.ok(output.startsWith(evidenceRoot + path.sep), 'evidence must stay inside the owned increment directory');
assert.ok(!fs.existsSync(output), 'preserve previous evidence');
fs.mkdirSync(output, { recursive: true });
const frontendRequire = createRequire(path.join(frontend, 'package.json'));
function playwright() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
const fileImport = name => '/@fs/' + path.join(frontend, 'src', name).replaceAll('\\', '/');
const root = '/api/process-data-governance';
const checks = [], requests = [], pageErrors = [], consoleErrors = [], externalRequests = [], requestFailures = [], screenshots = [], focus = [];
const state = { revision: 1, writePlan: [], receipts: new Map() };
const writeRequests = () => requests.filter(item => !['GET', 'HEAD'].includes(item.method));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = ['generate_candidates', 'decide_detail', 'request_business_fact', 'close_business_fact', 'complete_work_package'];
function packageData(factView = false) {
  const pkg = { id:'100', package_ref:'SYNTHETIC-RECEIPT-100', process_version_id:'200', source_content_hash:'synthetic-fixed-source-digest', rule_version:'v7-deterministic-v4', revision_no:state.revision, status:'mdm_review', process_name:'合成工作包：原请求回执核对', owning_department_name:'合成甲部', risk_level:'normal' };
  const row = { id:'101', detail_ref:'detail_101', detail_type:'data_object_identity', source_ref:'data_record', status:'confirmed', source:{data_name:'合成记录'}, candidate:{reason_codes:['source_data_object']}, governance:{conclusion:'已核对合成对象',basis:'合成依据'}, responsible_department_id:'21' };
  const fact = { id:'301', detail_id:'101', question_text:'请说明合成记录的来源', request_reason:'仅用于界面回归', target_department_id:'21', target_department_name:'合成甲部', status:factView ? 'open' : 'answered', answer_text:factView ? '' : '合成答复', evidence_ref:'合成表单第 1 页' };
  return { package:pkg, details:[row], fact_requests:[fact], ...(factView ? {fact_request:fact,source_context:row} : {}), source_version:{document_no:'SYNTHETIC-200',document_title:'合成固定流程',schema_version:'process-governance-v8'}, allowed_actions:factView ? ['answer_targeted_business_fact'] : actions, reviews:[],events:[] };
}
function json(route, value, status = 200) { return route.fulfill({ status, contentType:'application/json', body:JSON.stringify(value) }); }
async function freeLoopbackPort() {
  const probe = net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port = probe.address().port;
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  assert.ok(port > 1024 && ![3000,3001,5173].includes(port));
  return port;
}
async function apiRoute(route) {
  const request = route.request(), parsed = new URL(request.url()), method = request.method();
  let body = null;
  if (request.postData()) body = JSON.parse(request.postData());
  const entry = { method, path:parsed.pathname + parsed.search, body };
  requests.push(entry);
  if (!['GET','HEAD'].includes(method)) {
    assert.ok(uuidPattern.test(body?.request_id || ''), 'every native write carries a UUID');
    assert.equal(request.headers()['x-csrf-token'], 'synthetic-csrf', 'real API client sends CSRF');
    const planned = state.writePlan.shift();
    assert.ok(planned, 'every synthetic write must have an explicit plan');
    entry.injected = planned;
    if (planned === 'abort') return route.abort('failed');
    if (planned === '503') return json(route, { code:'HANDOFF_COMMIT_UNKNOWN', error:'Synthetic acknowledgement loss' }, 503);
    assert.equal(planned, 'success');
    return json(route, { request_id:body.request_id, business_outcome:parsed.pathname.endsWith('/complete') ? 'native_review_bound_pending_generation' : 'native_write_committed' });
  }
  if (parsed.pathname === '/api/csrf-token') return json(route, {csrfToken:'synthetic-csrf'});
  if (parsed.pathname === root + '/status') return json(route, {enabled:true,read_only:false});
  if (parsed.pathname === root + '/workbench') return json(route, {allowed_actions:['reconcile'],published_versions:[],work_items:[],work_packages:[],fact_requests:[]});
  if (parsed.pathname === root + '/work-packages/100') return json(route, packageData());
  if (parsed.pathname === root + '/fact-requests/301') return json(route, packageData(true));
  if (parsed.pathname === '/api/org/departments') return json(route, [{id:'21',name:'合成甲部'}]);
  if (parsed.pathname === '/api/governance-responsibilities/work-packages/100') return json(route, {target_type:'work_package',target_id:'100',source_revision:state.revision,source_hash:'synthetic-fixed-source-digest',allowed_actions:[],assignments:{},history:[],work_records:[]});
  if (parsed.pathname === '/api/terminology-governance/usages') return json(route, {enabled:false});
  if (parsed.pathname.startsWith('/api/data-map-handoffs/requests/')) {
    const id = parsed.pathname.split('/').at(-1), receipt = state.receipts.get(id);
    assert.ok(receipt, 'every receipt query has an explicit synthetic response');
    return json(route, {request_id:id,...receipt});
  }
  throw new Error('Unexpected synthetic API request: ' + method + ' ' + parsed.pathname);
}
async function main() {
  let server, browserServer, browser, context, page, failure;
  const harness = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DataGovernance} from ${JSON.stringify(fileImport('DataGovernance.jsx'))};
import {createApiClient} from ${JSON.stringify(fileImport('api.js'))};
import ${JSON.stringify(fileImport('styles.css'))};
import ${JSON.stringify(fileImport('presentation/tech-ui.css'))};
const api=createApiClient();
function Harness(){const [draft,setDraft]=useState(null);return <main className="workspace"><h1>合成 API 浏览器回归</h1><p>真实 DataGovernance 组件；数据仅为测试夹具。</p><DataGovernance api={api} draft={draft} setDraft={setDraft} user={{person_id:'14',department_id:'21'}}/></main>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
  fs.writeFileSync(path.join(output, 'harness.jsx'), harness);
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Native receipt synthetic regression</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>');
  try {
    const {createServer} = await import(pathToFileURL(frontendRequire.resolve('vite')).href);
    const react = (await import(pathToFileURL(frontendRequire.resolve('@vitejs/plugin-react')).href)).default;
    const modules = path.join(frontend,'node_modules');
    const port = await freeLoopbackPort();
    server = await createServer({configFile:false,root:output,base:'/',envDir:false,envPrefix:[],publicDir:false,plugins:[react()],
      resolve:{alias:[{find:'react-dom/client',replacement:path.join(modules,'react-dom/client.js')},{find:'react-dom',replacement:path.join(modules,'react-dom')},{find:'react',replacement:path.join(modules,'react')}]},
      optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime']},server:{host:'127.0.0.1',port,strictPort:true,cors:false,hmr:false,fs:{allow:[repository]}},logLevel:'error'});
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(address.address, '127.0.0.1'); assert.ok(address.port > 1024 && ![3000,3001,5173].includes(address.port));
    const origin = 'http://127.0.0.1:' + address.port;
    fs.writeFileSync(path.join(output,'server-owner.json'),JSON.stringify({runner_pid:process.pid,address:address.address,port:address.port,owned:true},null,2));
    browserServer = await playwright().chromium.launchServer({channel:'msedge',headless:true});
    browser = await playwright().chromium.connect(browserServer.wsEndpoint());
    fs.writeFileSync(path.join(output,'browser-owner.json'),JSON.stringify({runner_pid:process.pid,browser_pid:browserServer.process().pid,owned:true},null,2));
    context = await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('requestfailed', request => requestFailures.push({url:request.url(),error:request.failure()?.errorText}));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { externalRequests.push(request.url()); return route.abort('blockedbyclient'); }
      if (url.pathname.startsWith('/api/')) {
        try { await apiRoute(route); }
        catch (error) { pageErrors.push(error.stack || error.message); await json(route,{error:error.message},500); }
      } else await route.continue();
    });
    const button = name => page.getByRole('button',{name,exact:true});
    const field = name => page.getByLabel(name,{exact:true});
    const editor = () => page.locator('.data-governance > .preview-editor');
    const operationError = () => page.getByRole('alert').filter({hasText:'操作未完成'});
    async function idle() {await button('刷新工作包状态').waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='刷新工作包状态')?.disabled);}
    async function capture(name) {
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'desktop must not overflow horizontally');
      assert.equal(await page.evaluate(()=>visualViewport.scale),1,'Edge zoom 100%');
      assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight})),{width:1699,height:828});
      if(await editor().count()) await editor().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});screenshots.push(name+'.png');
      fs.writeFileSync(path.join(output,name+'.txt'),await page.locator('body').innerText());
    }
    async function start(name) {await button(name).click();await editor().waitFor();assert.equal(await editor().evaluate(el=>el===document.activeElement),true,'new editor receives focus');focus.push({action:name,editor_focused:true});}
    async function submit(plan) {state.writePlan.push(plan);const count=writeRequests().length;await button('确认提交本次操作').click();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='刷新工作包状态')?.disabled);assert.equal(writeRequests().length,count+1);return writeRequests().at(-1);}
    async function observe(receipt,text) {const write=writeRequests().at(-1),count=writeRequests().length;state.receipts.set(write.body.request_id,receipt);await button('查询原请求回执').click();await page.getByText(text,{exact:true}).waitFor();assert.equal(writeRequests().length,count,'GET receipt must never auto-submit');}
    async function discard() {page.once('dialog',dialog=>dialog.accept());await button('放弃本次输入').click();assert.equal(await editor().count(),0);}
    async function direct(name,fill) {await start(name);if(fill)await fill();const write=await submit('success');await page.getByText('本次操作已完成',{exact:true}).waitFor();await idle();assert.equal(await editor().count(),0);return write;}

    await page.goto(origin+'/?package=100');await idle();await button('完成工作包审核').waitFor();
    await start('完成工作包审核');
    const basis='合成审核依据：明细、事实和固定来源已逐项核对。';await field('完成审核依据').fill(basis);
    const first=await submit('abort');await operationError().waitFor();
    assert.equal(first.body.expected_revision,1);assert.equal(first.body.basis,basis);assert.equal(await field('完成审核依据').inputValue(),basis);assert.equal(await field('完成审核依据').isDisabled(),true);
    assert.equal(await button('按原请求重试').count(),0);await capture('complete-unknown');
    checks.push('completion sends UUID and fixed original payload; network failure retains and locks input');
    await observe({state:'in_progress'},'原请求正在办理。请稍后查询回执，暂不重复提交。');assert.equal(await button('按原请求重试').count(),0);
    await observe({state:'prepared',observation:'retryable'},'已确认原请求尚未提交，可按原请求和原载荷重试。');
    state.writePlan.push('503');await button('按原请求重试').click();await operationError().waitFor();assert.deepEqual(writeRequests().at(-1).body,first.body);assert.equal(writeRequests().at(-1).path,first.path);assert.equal(await field('完成审核依据').inputValue(),basis);
    checks.push('in_progress prevents retries; prepared permits only original UUID and exact original payload; 503 retains input');
    await observe({state:'committed',result:{request_id:first.body.request_id,business_outcome:'native_review_bound_pending_generation'}},'已查到本次操作的成功回执。请核对后确认结束本次输入。');
    assert.equal(await field('完成审核依据').inputValue(),basis);assert.equal(await field('完成审核依据').isDisabled(),true);await capture('complete-committed-awaiting-confirmation');
    const beforeConfirm=writeRequests().length;await button('确认结果并结束本次输入').click();await idle();assert.equal(writeRequests().length,beforeConfirm);assert.equal(await editor().count(),0);await page.getByText('工作包审核已保存，承接草案待生成；数据地图尚未发布。',{exact:true}).waitFor();
    checks.push('committed receipt keeps visible original input until explicit confirmation; confirmation does not POST');

    await start('完成工作包审核');await field('完成审核依据').fill('拒绝前原始输入');const rejected=await submit('503');
    await observe({state:'rejected',result:{code:'PROCESS_DATA_GOVERNANCE_REVIEW_BLOCKED'}},'已确认原请求被拒绝，没有提交本次业务变更。可修改输入后另行提交。');
    assert.equal(await field('完成审核依据').isEnabled(),true);await field('完成审核依据').fill('拒绝后修正输入');const changed=await submit('success');await idle();assert.notEqual(changed.body.request_id,rejected.body.request_id);assert.equal(changed.body.basis,'拒绝后修正输入');assert.equal(await editor().count(),0);
    checks.push('terminal rejection unlocks editing and a changed submission receives a new UUID');

    await start('记录治理结论');await field('治理结论').fill('合成治理结论，保留原修订');await field('判断依据').fill('原修订依据');const stale=await submit('503');
    state.revision=2;await button('刷新工作包状态').click();await idle();await page.getByText('来源或修订已变化',{exact:true}).waitFor();assert.equal(await field('治理结论').inputValue(),'合成治理结论，保留原修订');
    await observe({state:'prepared',observation:'retryable'},'已确认原请求尚未提交，可按原请求和原载荷重试。');
    state.writePlan.push('503');await button('按原请求重试').click();await operationError().waitFor();assert.deepEqual(writeRequests().at(-1).body,stale.body);assert.equal(writeRequests().at(-1).body.expected_revision,1);await capture('stale-original-request');await discard();
    checks.push('state refresh retains a stale draft; original receipt remains queryable and retry cannot rebind its revision');

    const generated=await direct('生成待核对明细');assert.ok(generated.path.endsWith('/generate-candidates'));
    const decided=await direct('记录治理结论',async()=>{await field('治理结论').fill('合成新修订结论');await field('判断依据').fill('合成新依据');});assert.equal(decided.method,'PATCH');assert.equal(decided.body.expected_revision,2);
    const asked=await direct('向业务部门提问',async()=>{await field('目标部门').selectOption('21');await field('需要的事实').selectOption('source_evidence');await field('具体问题').fill('请核对合成来源');await field('提出原因').fill('合成原因');});assert.ok(asked.path.endsWith('/fact-requests'));
    const closed=await direct('核对并关闭问题 301',async()=>{await field('采用情况和关闭依据').fill('合成答复已逐项核对');});assert.ok(closed.path.endsWith('/301/close'));
    checks.push('generate, MDM decision, targeted question and MDM close all send UUID through actual component controls');

    await page.goto(origin+'/?factRequest=301');await idle();await start('答复业务事实');
    const answer='合成部门答复，逐项记录实际做法。'.repeat(12)+'<script>不可执行的合成文字</script>';await field('事实答复').fill(answer);await field('来源依据').fill('合成表单第 1 页');const answered=await submit('503');
    assert.equal(await field('事实答复').inputValue(),answer);assert.equal(await field('事实答复').isDisabled(),true);assert.equal(await page.locator('textarea[aria-label="事实答复"] script').count(),0);await capture('department-answer-unknown');
    await observe({state:'not_observed'},'暂未查到原请求，不能据此认定失败。可继续查询，或仅按原请求和原载荷重试。');
    state.writePlan.push('success');await button('按原请求重试').click();await page.getByText('本次操作已完成',{exact:true}).waitFor();await idle();assert.deepEqual(writeRequests().at(-1).body,answered.body);assert.equal(await editor().count(),0);
    checks.push('department answer sends UUID, long Chinese input survives 503, and not_observed retries exact original request');
    assert.equal(state.writePlan.length,0);assert.equal(pageErrors.length,0);assert.equal(externalRequests.length,0);
    const unexpectedConsoleErrors=consoleErrors.filter(text=>!/^Failed to load resource: (the server responded with a status of 503|net::ERR_FAILED)/.test(text));
    assert.deepEqual(unexpectedConsoleErrors,[],'no unexpected console errors');
    assert.ok(writeRequests().every(request=>uuidPattern.test(request.body.request_id)));
    await capture('department-answer-saved');
    checks.push('Edge 100%, 1699 x 828 CSS viewport, editor focus, no horizontal overflow or JavaScript exceptions');
  } catch (error) {
    failure=error;
    if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  } finally {
    if(context)await context.close().catch(()=>{});
    if(browser){let timer;await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,8000);})]).finally(()=>clearTimeout(timer));}
    if(browserServer)await browserServer.kill().catch(()=>{});
    if(server)await server.close().catch(()=>{});
    const sourceFiles=['DataGovernance.jsx','nativeGovernanceRequest.js','api.js','styles.css','presentation/tech-ui.css'];
    const sources=sourceFiles.map(file=>({path:path.relative(repository,path.join(frontend,'src',file)).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(path.join(frontend,'src',file))).digest('hex')}));
    const cleanup={browser_main_process_exited:!browserServer||browserServer.process().exitCode!==null||browserServer.process().signalCode!==null,server_stopped_listening:!server||!server.httpServer?.listening};
    if(!Object.values(cleanup).every(Boolean)&&!failure)failure=new Error('Owned resources did not fully close');
    const report={passed:!failure,checks,check_count:checks.length,viewport:{width:1699,height:828,device_scale_factor:1,zoom:1,browser:'Microsoft Edge'},scope:'actual React component and API client with synthetic API responses; no backend integration, real authorization, MySQL or manual IME acceptance',sources,screenshots,focus,page_errors:pageErrors,console_errors:consoleErrors,external_requests:externalRequests,request_failures:requestFailures,owned_resources_closed:Object.values(cleanup).every(Boolean),cleanup,...(failure?{failure:{message:failure.message,stack:failure.stack}}:{})};
    fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify(requests,null,2));fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:!failure,check_count:checks.length,output}));
  }
  if(failure)throw failure;
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
