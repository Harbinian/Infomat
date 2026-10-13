// Synthetic browser/API cases; no storage or private credentials are copied.
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async function verify({page,pool,expect,fixture,writes,output,checks,startTodo,cancel,detail,button}) {
  const uncertain=async()=>{await page.getByText('写入结果不明，已阻止重复提交',{exact:true}).waitFor();await page.locator('button:enabled').filter({hasText:'按原请求核对结果'}).waitFor();};
  const success=()=>page.getByText(/术语待办 #\d+ 已创建/).waitFor();
  async function login(who){await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await button('退出登录').waitFor();}
  const retry=async()=>{page.once('dialog',d=>d.accept());await button('按原请求核对结果').click();};
  const submitted=()=>writes.filter(w=>w.method==='POST'&&w.body?.request_id).at(-1).body;
  const original=submitted();const n=writes.length;
  page.once('dialog',d=>d.dismiss());await button('按原请求核对结果').click();assert.equal(writes.length,n);
  await page.screenshot({path:path.join(output,'same-request-unknown-desktop.png'),fullPage:true});
  await pool.execute("UPDATE terminology_terms SET definition='合成当前更新后的定义' WHERE id=701");
  await button('刷新术语').click();await detail().getByText('合成当前更新后的定义',{exact:true}).waitFor();
  await retry();await success();assert.deepEqual(submitted(),original);
  assert.equal((await expect('lead','/api/todos','GET')).filter(r=>r.content===original.content).length,1);
  checks.push('lost successful response retains exact UUID/content; cancelled retry sends nothing; explicit same POST returns original after source text update');
  await startTodo();await page.getByLabel('待办办理内容',{exact:true}).fill('合成未到达服务端的原请求');
  await page.route('**/api/todos',r=>r.abort('failed'),{times:1});await button('确认提交').click();await uncertain();const notCommitted=submitted();
  assert.equal((await expect('lead','/api/todos','GET')).filter(r=>r.content===notCommitted.content).length,0);
  await retry();await success();assert.deepEqual(submitted(),notCommitted);assert.equal((await expect('lead','/api/todos','GET')).filter(r=>r.content===notCommitted.content).length,1);
  checks.push('explicit result check may create if original did not reach server; no false read-only promise or automatic replay');
  async function lose(content){await startTodo();await page.getByLabel('待办办理内容',{exact:true}).fill(content);await page.route('**/api/todos',async r=>{await r.fetch();await r.abort('failed');},{times:1});await button('确认提交').click();await uncertain();return submitted();}
  const deleted=await lose('合成丢回执后删除待办');const existing=(await expect('lead','/api/todos','GET')).find(r=>r.content===deleted.content);
  await expect('lead',`/api/todos/${existing.id}`,'DELETE');await retry();await page.getByText('原请求创建的待办已删除，历史仍保留，不能用原请求重新创建。',{exact:true}).waitFor();assert.deepEqual(submitted(),deleted);
  assert.equal((await expect('lead','/api/todos','GET')).filter(r=>r.content===deleted.content).length,0);await cancel();
  checks.push('UI original deleted request accurately refuses and preserves content/UUID/history without rebuilding');
  const identity=await lose('合成原身份未核对输入');
  await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=82');await button('刷新术语').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('outsider');
  await page.getByText('其他身份的术语待办输入仍保留',{exact:true}).waitFor();assert.equal(await page.getByLabel('待办办理内容',{exact:true}).count(),0);assert.equal(await page.getByText(identity.content,{exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'different-identity-desktop.png'),fullPage:true});
  await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=86');await button('刷新术语').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('lead');await uncertain();
  assert.equal(await page.getByLabel('待办办理内容',{exact:true}).inputValue(),identity.content);
  await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=82');await button('刷新身份').click();await page.getByText('其他身份的术语待办输入仍保留',{exact:true}).waitFor();assert.equal(await page.getByLabel('待办办理内容',{exact:true}).count(),0);
  await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=82');await button('刷新身份').click();await uncertain();await retry();await success();assert.deepEqual(submitted(),identity);
  checks.push('real session revocation/other person/current department changes hide original draft without clearing/rebinding; original owner restores same request');
  // A delayed older read must not become a selected record after navigation.
  let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
  await page.route('**/api/terminology',async r=>{const response=await r.fetch();entered();await gate;await r.fulfill({response}).catch(()=>{});},{times:1});
  await button('刷新术语').click();await seen;
  await page.getByRole('link',{name:'待办收到',exact:true}).click();release();await page.locator('[data-todo-state="ready"]').waitFor();assert.equal(await detail().count(),0);
  await page.goBack();await detail().waitFor();
  await button('查看术语 702').click();await detail().getByText('不得跨部门披露',{exact:true}).waitFor();assert.equal(await detail().getByText('合成当前更新后的定义',{exact:true}).count(),0);
  await button('查看术语 701').click();await detail().getByText('合成当前更新后的定义',{exact:true}).waitFor();
  await pool.execute("UPDATE terminology_terms SET definition='明确术语来源' WHERE id=701");await button('刷新术语').click();await detail().getByText('明确术语来源',{exact:true}).waitFor();
  checks.push('late source read is discarded when selecting another explicit term; no stale detail or automatic write');
};
