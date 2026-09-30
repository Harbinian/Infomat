// Synthetic data only: owned tmpfs MySQL, real HTTP/session and Edge 1699x828.
// Input: built frontend, local mysql:8.4 and existing Playwright runtime.
// Output: --output <new directory under artifacts>; closes all owned resources.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { manageTodoTermSource, inspectTodoTermSource } = require('../server/todoTermSourceMigration');
const { makeTodoMysqlRepository } = require('../server/todoMysqlRepository');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const arg = process.argv.indexOf('--output');
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const checks = [];
async function main() {
  await withStage05Fixture(async ({ pool, fixture, expect, backup, restore }) => {
    const connection = await pool.getConnection();
    try {
      await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,related_mapping_id,content) VALUES(9001,91,'terminology',501,'合成历史术语待办')");
      await pool.execute('ALTER TABLE mdm_todos DROP COLUMN related_term_id');
      const [legacy] = await pool.query('SELECT * FROM mdm_todos ORDER BY id');
      const dump = backup();
      await expect('lead', '/api/todos', 'GET', undefined, 503);
      assert.equal((await inspectTodoTermSource(connection)).state, 'absent');
      assert.equal((await manageTodoTermSource(connection, 'inspect')).state, 'absent');
      assert.equal((await manageTodoTermSource(connection, 'apply')).state, 'applied');
      assert.equal((await manageTodoTermSource(connection, 'apply')).state, 'applied');
      const withoutSource = row => { const { related_term_id, ...rest } = row; assert.equal(related_term_id, null); return rest; };
      assert.deepEqual((await pool.query('SELECT * FROM mdm_todos ORDER BY id'))[0].map(withoutSource), legacy);
      assert.equal((await manageTodoTermSource(connection, 'rollback')).state, 'absent');
      assert.deepEqual((await pool.query('SELECT * FROM mdm_todos ORDER BY id'))[0], legacy);
      // Restore the actual mysqldump only into the ownership-checked fixture.
      restore(dump);
      assert.equal((await inspectTodoTermSource(connection)).state, 'absent');
      assert.deepEqual((await pool.query('SELECT * FROM mdm_todos ORDER BY id'))[0], legacy);
      await pool.execute('ALTER TABLE mdm_todos ADD COLUMN related_term_id BIGINT NULL AFTER related_field_id');
      assert.equal((await inspectTodoTermSource(connection)).state, 'unrecorded');
      await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,related_term_id,content) VALUES(8999,91,'terminology',701,'合成未登记引用')");
      await assert.rejects(manageTodoTermSource(connection,'apply'),/TODO_TERM_SCHEMA_UNRECORDED_LINKS/);
      assert.equal((await pool.query('SELECT related_term_id FROM mdm_todos WHERE id=8999'))[0][0].related_term_id,701);
      await pool.execute('DELETE FROM mdm_todos WHERE id=8999');
      assert.equal((await manageTodoTermSource(connection, 'apply')).state, 'applied');
      await pool.execute('ALTER TABLE mdm_todos MODIFY related_term_id VARCHAR(30) NULL');
      assert.equal((await inspectTodoTermSource(connection)).state, 'drift');
      await assert.rejects(manageTodoTermSource(connection, 'apply'), /TODO_TERM_SCHEMA_DRIFT/);
      await pool.execute('ALTER TABLE mdm_todos MODIFY related_term_id BIGINT NULL');
      assert.equal((await manageTodoTermSource(connection, 'apply')).state, 'applied');
      assert.deepEqual((await pool.query('SELECT * FROM mdm_todos ORDER BY id'))[0].map(withoutSource), legacy);
      checks.push('real backup/restore, inspect/apply/repeat/unused rollback, interrupted DDL recovery, schema drift refusal, old values preserved and missing schema 503 without startup DDL');
    } finally { connection.release(); }
    await require('../server/terminologyMysqlRepository').seedDefaultTerminologyTermTypes(pool);
    await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(1,'synthetic-terms.json','synthetic','{}')");
    await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,dept_name,l3_name,status) VALUES(501,'synthetic_term_source_a','l3',1,1,'合成甲部','合成甲流程','active'),(502,'synthetic_term_source_b','l3',1,1,'合成乙部','合成乙流程','active')");
    await pool.execute("INSERT INTO terminology_terms(id,term,term_type_code,definition,process_mapping_record_id,created_by,created_by_person_id) VALUES(701,'合成关联术语','noun','明确术语来源',501,83,83),(702,'合成乙部受限术语','noun','不得跨部门披露',502,85,85),(703,'合成待删除术语','noun','删除后引用仍保留',501,83,83)");
    const body = (overrides = {}) => ({ type: 'terminology', related_term_id: '701', to_dept_id: '91', content: '核对合成术语定义', request_id: crypto.randomUUID(), ...overrides });
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 88,role_id,'global','synthetic composite admin test',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    const composite = await expect('adminMulti','/api/org/me','GET');
    assert.ok(composite.permissions.includes('governance:assign-work') && composite.permissions.includes('identity:manage-account'));
    assert.equal((await fetch(fixture.baseURL + '/api/todos')).status, 401);
    for (const who of ['contact', 'outsider', 'admin', 'adminMulti']) await expect(who, '/api/todos', 'POST', body(), 403);
    for (const invalid of [{ related_term_id:'9007199254740993' }, { related_term_id:['701'] }, { related_term_id:'0701' }, { type:'general' }, { related_mapping_id:701 }, { request_id:'bad' }, { content:' ' }, { to_dept_id:9999 }, { due_date:'2026-02-30' }]) await expect('lead', '/api/todos', 'POST', body(invalid), 400);
    await expect('lead', '/api/todos', 'POST', body({ related_term_id:'9999' }), 404);
    await assert.rejects(makeTodoMysqlRepository(pool).createTodo(body(), { actor_user_id:86, actor_person_id:86, can_assign_work:true, is_admin:false, term_scope:{ userId:86, departmentId:93, departmentName:'合成丙部' } }), error => error.code === 'TODO_TERM_UNAVAILABLE');
    await assert.rejects(makeTodoMysqlRepository(pool).createTodo(body(), { actor_user_id:88, can_assign_work:true, is_admin:true, term_scope:{ canViewAll:true } }), error => error.code === 'TODO_TERM_FORBIDDEN');
    const old = await expect('lead', '/api/todos', 'POST', { type:'terminology', to_dept_id:91, content:'合成旧客户端不带来源' });
    assert.equal((await expect('lead', '/api/todos', 'GET')).find(r => r.id === old.id).related_term_id, null);
    checks.push('real HTTP auth and composite-admin refusal despite assign permission, scoped source check, repository admin refusal, invalid input/source/department handling, old client compatibility');
    const payload = body();
    const responses = await Promise.all([expect('lead','/api/todos','POST',payload), expect('lead','/api/todos','POST',payload)]);
    assert.equal(responses[0].id, responses[1].id);
    const linkedId = responses[0].id;
    assert.equal((await pool.query('SELECT * FROM mdm_todo_events WHERE todo_id=?',[linkedId]))[0].length, 1);
    assert.equal((await expect('contact','/api/todos','GET')).find(r => r.id === linkedId).related_term_id, '701');
    await expect('lead','/api/todos','POST',{...payload,content:'另一项内容'},409);
    await pool.query("CREATE TRIGGER synthetic_term_audit_failure BEFORE INSERT ON mdm_version_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit unavailable'");
    const [[countBefore]] = await pool.query('SELECT COUNT(*) AS n FROM mdm_todos');
    const [[eventsBefore]] = await pool.query('SELECT COUNT(*) AS n FROM mdm_todo_events');
    await expect('lead','/api/todos','POST',body(),400);
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM mdm_todos'))[0][0].n,countBefore.n);
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM mdm_todo_events'))[0][0].n,eventsBefore.n);
    await pool.query('DROP TRIGGER synthetic_term_audit_failure');
    const deletionRequest = body();
    const deletable = await expect('lead','/api/todos','POST',deletionRequest);
    await expect('lead',`/api/todos/${deletable.id}`,'DELETE');
    await expect('lead','/api/todos','POST',deletionRequest,409);
    const deletedSourceTodo = await expect('lead','/api/todos','POST',body({related_term_id:'703'}));
    await expect('contact','/api/terminology/703','DELETE');
    assert.equal((await expect('lead','/api/todos','GET')).find(r=>r.id===deletedSourceTodo.id).related_term_id,'703');
    const limited = await expect('lead','/api/todos','POST',body({related_term_id:'702'}));
    assert.ok((await expect('contact','/api/todos','GET')).some(r=>r.id===limited.id));
    assert.ok(!(await expect('contact','/api/terminology','GET')).some(r=>r.id===702));
    const db = await pool.getConnection();
    try { await assert.rejects(manageTodoTermSource(db,'rollback'),/TODO_TERM_ROLLBACK_HAS_HISTORY/); } finally { db.release(); }
    checks.push('real concurrent idempotency, different payload 409, audit failure atomic rollback, deletion tombstone refusal, source deletion preserves ID, recipient scope unchanged, used migration rollback refused');

    const browser = await runtime().chromium.launch({channel:'msedge',headless:true});
    const context = await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1,timezoneId:'Asia/Shanghai'});
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const pageErrors=[], consoleErrors=[], writes=[];
    page.on('pageerror',e=>pageErrors.push(e.message)); page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    page.on('request',r=>{if(r.url().includes('/api/todos') && r.method()!=='GET')writes.push({method:r.method(),url:r.url()});});
    const watchdog=setTimeout(()=>browser.close().catch(()=>{}),240000);
    const button=name=>page.getByRole('button',{name,exact:true});
    const termsReady=()=>page.locator('[data-terms-ready]').waitFor();
    const todoReady=()=>page.locator('[data-todo-state="ready"]').waitFor();
    const detail=()=>page.locator('[data-term-detail]');
    async function login(who){await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await button('退出登录').waitFor();}
    async function startTodo(){await button('创建术语待办').click();await page.getByLabel('接收部门',{exact:true}).selectOption('91');await page.getByLabel('待办办理内容',{exact:true}).fill('合成中文术语办理说明'.repeat(10));}
    async function cancel(){page.once('dialog',d=>d.accept());await button('取消本次办理').click();}
    try {
      console.log('BROWSER term source create');
      await page.goto(fixture.baseURL+'/app/terms?id=701');await login('lead');await termsReady();await detail().waitFor();
      await startTodo();assert.equal(await page.getByLabel('接收部门',{exact:true}).inputValue(),'91');
      await button('刷新术语').click();await termsReady();assert.ok((await page.getByLabel('待办办理内容',{exact:true}).inputValue()).startsWith('合成中文'));
      page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'查看术语待办',exact:true}).click();assert.ok(page.url().includes('/app/terms'));
      for(const status of [403,409]){await page.route('**/api/todos',route=>route.fulfill({status,json:{error:'合成拒绝'}}),{times:1});await button('确认提交').click();await page.getByText(status===403?'当前身份无权执行此操作，请核对权限或联系负责人。':'内容已变化或请求冲突，请重新核对后再操作。当前输入仍保留。',{exact:true}).waitFor();assert.ok((await page.getByLabel('待办办理内容',{exact:true}).inputValue()).startsWith('合成中文'));}
      await page.route('**/api/todos',route=>route.fulfill({status:503,json:{error:'合成暂不可用'}}),{times:1});await button('确认提交').click();await page.getByText('写入结果不明，已阻止重复提交',{exact:true}).waitFor();assert.equal(await button('确认提交').isDisabled(),true);await cancel();
      await startTodo();await page.route('**/api/todos',route=>route.fulfill({json:{}}),{times:1});await button('确认提交').click();await page.getByText('写入结果不明，已阻止重复提交',{exact:true}).waitFor();assert.ok((await page.getByLabel('待办办理内容',{exact:true}).inputValue()).startsWith('合成中文'));await cancel();
      await startTodo();await page.screenshot({path:path.join(output,'create-desktop.png'),fullPage:true});
      await button('确认提交').click();await page.getByText(/术语待办 #\d+ 已创建/).waitFor();
      const uiCreated=(await expect('lead','/api/todos','GET')).find(r=>r.content==='合成中文术语办理说明'.repeat(10));assert.ok(uiCreated);assert.equal(uiCreated.related_term_id,'701');
      await page.getByRole('link',{name:'查看术语待办',exact:true}).click();await todoReady();
      const link=id=>page.getByRole('link',{name:`查看关联术语（待办 #${id}）`,exact:true});
      assert.equal(await page.getByRole('link',{name:'到术语列表核对（待办 #9001）',exact:true}).count(),1);
      await link(uiCreated.id).focus();await page.keyboard.press('Enter');await detail().waitFor();assert.ok(page.url().endsWith('id=701'));
      await page.reload();await detail().waitFor();await page.goBack();await todoReady();assert.equal(await page.getByLabel('待办类型',{exact:true}).inputValue(),'terminology');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);
      await page.screenshot({path:path.join(output,'linked-todo-desktop.png'),fullPage:true});
      checks.push('real browser explicit department/source creation, retained input on refresh/cancelled navigation/403/409/503, keyboard accurate link, old fallback, reload/back and desktop geometry');
      console.log('BROWSER permissions and failed target');
      await button('退出登录').click();await login('contact');await todoReady();
      for(const id of [limited.id,deletedSourceTodo.id]){await link(id).click();await page.getByText('术语详情暂不可用',{exact:true}).waitFor();assert.equal(await detail().count(),0);await page.goBack();await todoReady();}
      for(const status of [403,409,503]){await page.route('**/api/terminology',route=>route.fulfill({status,json:{error:'合成详情读取失败'}}),{times:1});await link(linkedId).click();await page.getByText('术语详情暂不可用',{exact:true}).waitFor();assert.equal(await detail().count(),0);await button('刷新术语').click();await detail().waitFor();await page.goBack();await todoReady();}
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');await link(linkedId).click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('outsider');await page.getByText('术语详情暂不可用',{exact:true}).waitFor();assert.equal(await detail().count(),0);
      await button('退出登录').click();await login('adminMulti');await detail().waitFor();assert.equal(await button('创建术语待办').count(),0);
      checks.push('recipient without source access, deleted source, injected detail failures/retry, real revoked session and outsider/admin boundaries');
      // A successful creation with a lost response is not replayed by the UI.
      await button('退出登录').click();await login('lead');await detail().waitFor();await startTodo();
      await page.getByLabel('待办办理内容',{exact:true}).fill('合成丢失回执');
      await page.route('**/api/todos',async route=>{await route.fetch();await route.abort('failed');},{times:1});await button('确认提交').click();await page.getByText('写入结果不明，已阻止重复提交',{exact:true}).waitFor();
      assert.equal(await button('确认提交').isDisabled(),true);assert.equal((await expect('lead','/api/todos','GET')).filter(r=>r.content==='合成丢失回执').length,1);await cancel();
      await startTodo();await pool.execute("UPDATE terminology_terms SET definition='合成并发变更' WHERE id=701");const beforeWrites=writes.length;
      await button('确认提交').click();await page.getByText('原记录已变化，当前输入保留',{exact:true}).waitFor();assert.equal(writes.length,beforeWrites);await cancel();
      checks.push('committed create with lost response is not replayed; changed source snapshot blocks stale form without clearing input');
      assert.deepEqual(pageErrors,[]);
      const unexpectedConsole=consoleErrors.filter(x=>!/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x));assert.deepEqual(unexpectedConsole,[]);
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,pageErrors,unexpectedConsole,writes,viewport:{width:1699,height:828,scale:1}},null,2));
    } catch(error) {
      fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,stack:error.stack,checks,pageErrors},null,2));
      await page.screenshot({path:path.join(output,'failure.png'),fullPage:true,timeout:5000}).catch(()=>{});throw error;
    } finally { clearTimeout(watchdog);await browser.close(); }
  },{evidenceDir:output});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
