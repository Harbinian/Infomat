// Input: --output <new artifacts directory>, optional --frontend-dist/--test-node-path.
// Owned tmpfs MySQL, synthetic identities and real Edge 100%, 1699x828 only.
// --require-legacy-person-forms also checks retained v4 create/move forms.
// No formal services, private configuration, real people or notifications.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
const at=process.argv.indexOf('--output'),output=path.resolve(process.argv[at+1]||'');
assert(at>0&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
async function main(){await withStage05Fixture(async({fixture,pool,expect})=>{
  const passwordHash=require('bcryptjs').hashSync(fixture.loginPassword,10);
  for(const id of [101,102]){
    await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,91)",[id,'SYNTHETIC_HEAD_'+id,'合成负责人'+id]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(?,?,?,?,'active',0)",[id+1000,id,'SYNTHETIC_HEAD_'+id,passwordHash]);
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,'department',91,'synthetic existing contact','2000-01-01' FROM roles WHERE role_code='department_contact'",[id]);
  }
  await pool.execute('UPDATE departments SET final_responsible_person_id=NULL WHERE id=91');
  const browserServer=await runtime().chromium.launchServer({channel:'msedge',headless:true,timeout:20000}),browserProcess=browserServer.process();
  fs.writeFileSync(path.join(output,'owned-browser.json'),JSON.stringify({browserPid:browserProcess.pid,runnerPid:process.pid,startedAt:new Date().toISOString(),ownerScript:__filename,channel:'msedge',launchMethod:'launchServer'},null,2)+'\n');
  let browser=null,testFailure=null;
  try{
  browser=await runtime().chromium.connect(browserServer.wsEndpoint());
  const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1}),page=await context.newPage();page.setDefaultTimeout(15000);
  const checks=[],errors=[],button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true}),editor=page.locator('[data-account-editor]');page.on('pageerror',error=>errors.push(error.message));
  async function login(){await page.locator('#login-name').fill('SYNTHETIC_admin');await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await page.locator('[data-accounts-ready]').waitFor();}
  async function ready(){await page.locator('[data-accounts-ready]').waitFor();}
  async function open(id){await ready();await field('搜索账号').fill(id>=100?'SYNTHETIC_HEAD_'+id:'SYNTHETIC_reviewA');await page.locator('[data-account-id="'+id+'"]').getByRole('button',{name:'新增角色授权',exact:true}).click();await field('选择角色').selectOption('department_mdm_reviewer');await editor.waitFor();}
  async function cancel(){page.once('dialog',dialog=>dialog.accept());await button('取消本次办理').click();await editor.waitFor({state:'hidden'});}
  async function submit(){page.once('dialog',dialog=>dialog.accept());await button('授权并登记部门负责人').click();await editor.waitFor({state:'hidden'});await ready();}
  async function shot(name){await editor.scrollIntoViewIfNeeded();if(name.includes('stale')||name.includes('failed'))await button('授权并登记部门负责人').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
  async function finalId(){return String((await pool.execute('SELECT final_responsible_person_id id FROM departments WHERE id=91'))[0][0].id);}
  async function grant(id){return (await pool.execute("SELECT pr.* FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=? AND r.role_code='department_mdm_reviewer' ORDER BY pr.person_role_id",[id]))[0];}
  try{
    await page.goto(fixture.baseURL+'/app/accounts');await login();await open(101);
    assert.equal(await field('所选人员所属部门').inputValue(),'合成甲部');assert.equal(await field('现任部门负责人').inputValue(),'未登记');
    const today=await field('生效日期').inputValue();await field('生效日期').fill('2099-01-01');assert(await button('授权并登记部门负责人').isDisabled());await field('生效日期').fill(today);
    await field('授权依据（可选）').fill('合成首次授权并登记依据');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('link',{name:'我的工作台',exact:true}).click();assert(page.url().includes('/app/accounts'));assert.equal(await field('授权依据（可选）').inputValue(),'合成首次授权并登记依据');
    page.once('dialog',dialog=>dialog.dismiss());await button('授权并登记部门负责人').click();assert.equal(await finalId(),'null');assert.equal((await grant(101)).length,0);
    await shot('desktop-new-department-head');await submit();assert.equal(await finalId(),'101');assert.equal((await grant(101)).length,1);
    checks.push('new current role and organization registration commit together; future appointment is disabled; canceled navigation and confirmation preserve inputs');

    await open(102);await field('授权依据（可选）').fill('合成交接草稿在并发变化后保留');assert((await field('现任部门负责人').inputValue()).includes('合成负责人101'));assert(await button('授权并登记部门负责人').isDisabled());
    const handover=editor.getByRole('checkbox');assert((await handover.locator('..').innerText()).includes('合成负责人101'));assert((await handover.locator('..').innerText()).includes('合成负责人102'));await handover.check();
    await shot('desktop-explicit-handover');await page.route('**/api/org/accounts/102/role-assignments',async route=>{await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');await route.continue();},{times:1});
    page.once('dialog',dialog=>dialog.accept());await button('授权并登记部门负责人').click();await page.getByText('部门负责人已变化',{exact:true}).waitFor();await ready();assert.equal(await field('授权依据（可选）').inputValue(),'合成交接草稿在并发变化后保留');assert(await button('授权并登记部门负责人').isDisabled());assert.equal((await grant(102)).length,0);assert.equal(await finalId(),'84');await shot('desktop-stale-handover-input');await cancel();
    checks.push('handover names are explicit and opt-in; a real concurrent incumbent change returns conflict, keeps draft and prevents stale submission without granting');

    await open(102);await field('授权依据（可选）').fill('合成失败请求保留依据');await editor.getByRole('checkbox').check();await page.route('**/api/org/accounts/102/role-assignments',route=>route.fulfill({status:503,json:{code:'IDENTITY_ACCESS_SERVICE_UNAVAILABLE'}}),{times:1});page.once('dialog',dialog=>dialog.accept());await button('授权并登记部门负责人').click();await page.getByText('操作结果尚未确定',{exact:true}).waitFor();assert.equal(await field('授权依据（可选）').inputValue(),'合成失败请求保留依据');assert(await button('授权并登记部门负责人').isDisabled());await shot('desktop-failed-handover-input');await cancel();
    checks.push('ambiguous service failure preserves the handover basis and prevents an unreviewed retry');

    await pool.execute('UPDATE departments SET final_responsible_person_id=101 WHERE id=91');await button('刷新账号资料').click();await ready();const beforeGrant=await grant(84);await open(84);
    assert.equal(await field('授权依据（可选）').isEditable(),false);assert.equal(await field('生效日期').isEditable(),false);assert.equal(await field('失效日期（可选）').isEditable(),false);assert.equal(await field('授权依据（可选）').inputValue(),beforeGrant[0].authorization_basis);
    assert(await button('授权并登记部门负责人').isDisabled());await editor.getByRole('checkbox').check();await shot('desktop-existing-grant-registration');await submit();assert.equal(await finalId(),'84');assert.deepEqual(await grant(84),beforeGrant);assert.equal((await grant(101)).length,1);
    await field('搜索账号').fill('SYNTHETIC_HEAD_101');assert((await page.locator('[data-accounts-ready]').innerText()).includes('部门负责人（未登记为现任）'));
    checks.push('an existing effective role uses the same entry to register the head, preserving the original role row dates and basis; previous head grant is retained');

    await open(102);await field('授权依据（可选）').fill('合成同身份重新登录保留的任命草稿');await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=181');await button('刷新账号资料').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login();assert.equal(await field('授权依据（可选）').inputValue(),'合成同身份重新登录保留的任命草稿');assert.equal(await editor.getByRole('checkbox').isChecked(),false);await cancel();
    checks.push('session expiry preserves only the same-identity appointment draft and does not silently confirm a handover');

    await field('搜索账号').fill('SYNTHETIC_reviewA');const row=page.locator('[data-account-id="84"]');await row.locator('summary').click();await row.getByRole('button',{name:'撤销该授权',exact:true}).click();await page.getByText('撤销角色授权后，当前人员不再具备部门最终确认资格；组织中的部门负责人登记仍保留，不表示已经免职。',{exact:false}).waitFor();await field('办理原因').fill('合成撤销角色权限');await editor.getByRole('checkbox').check();page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'撤销角色授权',exact:true}).click();await editor.waitFor({state:'hidden'});await ready();assert.equal(await finalId(),'84');assert.equal((await grant(84))[0].assignment_status,'revoked');
    checks.push('role revocation is clearly distinguished from organizational dismissal and leaves the head registration intact');

    const legacy=await button('新建人员及账号').count();if(process.argv.includes('--require-legacy-person-forms'))assert.equal(legacy,1);
    if(legacy){await button('新建人员及账号').click();assert.equal(editor.getByRole('checkbox',{name:'部门负责人',exact:true})&&await editor.getByRole('checkbox',{name:'部门负责人',exact:true}).count(),0);await page.getByText('部门负责人请在人员建好或调入后',{exact:false}).waitFor();await field('工号').fill('SYNTHETIC_LEGACY_NEW');await field('姓名').fill('合成保留创建人员');await field('部门').selectOption('91');await editor.getByRole('checkbox',{name:'部门主对接人',exact:true}).check();page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'创建待启用账号',exact:true}).click();await editor.waitFor({state:'hidden'});await ready();await field('搜索账号').fill('SYNTHETIC_LEGACY_NEW');const [created]=await pool.execute("SELECT person_id FROM person WHERE employee_no='SYNTHETIC_LEGACY_NEW'");const createdRow=page.locator('[data-account-id="'+created[0].person_id+'"]');await createdRow.getByRole('button',{name:'维护人员',exact:true}).click();await field('部门').selectOption('92');assert.equal(await editor.getByRole('checkbox',{name:'部门负责人',exact:true}).count(),0);await field('部门变更原因（变更部门时必填）').fill('合成保留调部门行为');await editor.getByRole('checkbox',{name:'部门主对接人',exact:true}).check();page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'保存人员信息',exact:true}).click();await editor.waitFor({state:'hidden'});await ready();assert.equal(String((await pool.execute('SELECT current_department_id id FROM person WHERE person_id=?',[created[0].person_id]))[0][0].id),'92');await createdRow.getByRole('button',{name:'维护人员',exact:true}).click();await field('部门').selectOption('91');await field('部门变更原因（变更部门时必填）').fill('合成明确暂不授新部门角色');assert(await editor.getByRole('button',{name:'保存人员信息',exact:true}).isDisabled());await field('暂不授新部门角色，调入后另行授权').check();await shot('desktop-explicit-move-without-role');page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'保存人员信息',exact:true}).click();await editor.waitFor({state:'hidden'});await ready();assert.equal(String((await pool.execute('SELECT current_department_id id FROM person WHERE person_id=?',[created[0].person_id]))[0][0].id),'91');assert.equal((await pool.execute("SELECT COUNT(*) n FROM person_roles WHERE person_id=? AND scope_type='department' AND assignment_status='active'",[created[0].person_id]))[0][0].n,0);checks.push('live v4 create and department move stay usable for other roles; moving without a new role requires explicit opt-in and head appointment uses the single entry');}
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:true,checks,errors,viewport:{width:1699,height:828,scale:1},realHttp:true,realMysql:true,legacyPersonForms:Boolean(legacy)},null,2)+'\n');console.log('DEPARTMENT_HEAD_BROWSER_PASS '+checks.length);
  }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true,timeout:5000}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-state.json'),JSON.stringify({checks,errors,message:error.message,text:await page.locator('body').innerText().catch(()=>''),url:page.url()},null,2));throw error;}
  }catch(error){testFailure=error;throw error;}
  finally{
    let closeSettled=!browser,closeError=null,killError=null,timer;
    if(browser){await Promise.race([browser.close().then(()=>{closeSettled=true;}).catch(error=>{closeError=error.message;}),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);}
    // The server owns this exact browser process tree, including after a client disconnect.
    try{await browserServer.kill();}catch(error){killError=error.message;}
    const processExited=browserProcess.exitCode!==null||browserProcess.signalCode!==null;
    const cleanup={browserPid:browserProcess.pid,runnerPid:process.pid,closeSettled,closeError,closeTimeoutMs:5000,serverKillSettled:!killError,killError,processExited,exitCode:browserProcess.exitCode,signalCode:browserProcess.signalCode,finishedAt:new Date().toISOString(),ownership:'BrowserServer created by this runner only'};
    fs.writeFileSync(path.join(output,'browser-close.json'),JSON.stringify(cleanup,null,2)+'\n');
    if(!testFailure){assert.equal(killError,null,'owned browser cleanup must settle');assert.equal(processExited,true,'owned browser process must have exited');}
  }
},{evidenceDir:output,departmentAccountability:true,createDocument:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-v8.json'),'utf8'))});}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
