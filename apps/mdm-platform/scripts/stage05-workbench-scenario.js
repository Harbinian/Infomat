// Synthetic HTTP assertions shared by the stage05 isolated entry. No default connection.
const assert=require('node:assert/strict');
module.exports=async function({fixture,expect,pool}) {
  const checks=[];
  const pass=name=>{checks.push(name);console.log('PASS '+name);};
  const bind=c=>({expected_revision_no:c.current_revision_no,expected_content_hash:c.current_content_hash});
  await Promise.all(Array.from({length:12},()=>expect('reviewA','/api/org/me','GET')));
  pass('twelve concurrent synthetic session reads complete within the bounded session queue');
  const work=async who=>(await expect(who,'/api/role-workbench','GET')).workItems.filter(x=>x.type.startsWith('v7_'));
  let detail=await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'stage05-synthetic.json'},201);
  const caseId=detail.case.id;
  const read=async()=>await expect('lead',`/api/process-v7-preview/cases/${caseId}`,'GET');
  assert.equal(detail.items.length,2);
  for(const who of ['reviewA','reviewB']) {
    const items=await work(who);assert.equal(items.length,2);
    assert.ok(items.every(i=>i.type==='v7_preview_review'&&i.sourceRoles.includes('department_mdm_reviewer')&&i.target.includes('v7Item=')));
  }
  for(const who of ['admin','adminMulti','outsider']) assert.equal((await work(who)).length,0);
  const adminDetail=await expect('adminMulti',`/api/process-v7-preview/cases/${caseId}`,'GET');
  assert.ok(adminDetail.items.every(i=>!i.can_act&&i.allowed_actions.length===0));
  const multi=await work('multi');assert.ok(multi.every(i=>i.sourceRoles.includes('department_mdm_reviewer')));
  pass('department scopes, stable targets, multi-role source permissions and admin read-only');
  await expect('reviewA',`/api/process-v7-preview/items/${detail.items[0].id}/decision`,'POST',{...bind(detail.case),decision:'confirmed',basis:'合成甲部核对依据'});
  assert.equal((await work('reviewA')).length,1,'next read must remove completed item without TTL');
  await expect('reviewB',`/api/process-v7-preview/items/${detail.items[1].id}/decision`,'POST',{...bind(detail.case),decision:'disputed',basis:'合成乙部：对接收口径存在分歧'});
  await expect('reviewA',`/api/process-v7-preview/items/${detail.items[1].id}/decision`,'POST',{...bind(detail.case),decision:'needs_changes',basis:'合成退回：补清接收结果'});
  assert.equal((await work('reviewA')).length,0);
  assert.match((await work('contact')).find(i=>i.type==='v7_returned').sample,/补清接收结果/,'one party dispute must not hide the other party return');
  const revised=JSON.parse(JSON.stringify(fixture.document));revised.behaviors[2].completion_standard='修订后已核对接收结果。';
  detail=await expect('contact',`/api/process-v7-preview/cases/${caseId}/revisions`,'POST',{...bind(detail.case),document:revised,source_file_name:'stage05-synthetic-r2.json'},201);
  assert.ok((await work('reviewA')).some(i=>i.type==='v7_preview_review'&&i.revisionNo===2));
  assert.ok(!(await work('contact')).some(i=>i.type==='v7_returned'));
  pass('completed item disappears immediately; return reason targets same case; affected revision reopens');
  for(const who of ['reviewA','reviewB']) for(const item of detail.items) await expect(who,`/api/process-v7-preview/items/${item.id}/decision`,'POST',{...bind(detail.case),decision:'confirmed',basis:'合成当前修订核对依据'});
  assert.ok((await work('lead')).some(i=>i.type==='v7_promote'));
  detail=await read();
  const promotion=await expect('lead',`/api/process-v7-preview/cases/${caseId}/promote`,'POST',{...bind(detail.case),target:{mode:'create',document_no:'STAGE05-SYNTHETIC',document_title:'合成材料核对流程'}},201);
  const draft=promotion.draft;
  const formal={expected_revision_no:draft.revision_no,expected_content_hash:draft.content_hash};
  assert.ok((await work('contact')).some(i=>i.type==='v7_submit'));
  assert.ok(!(await work('lead')).some(i=>i.type==='v7_promote'));
  let submitted=await expect('contact',`/api/process-design/drafts/${draft.id}/submit`,'POST',formal);
  assert.ok((await work('reviewA')).some(i=>i.type==='v7_formal_review'&&i.reviewTaskId===submitted.reviewTask.id));
  assert.ok(!(await work('reviewB')).some(i=>i.type==='v7_formal_review'));
  await expect('reviewA',`/api/process-design/review-tasks/${submitted.reviewTask.id}/decision`,'POST',{...formal,decision:'needs_changes',note:'合成正式退回：补充完成依据'});
  assert.match((await work('contact')).find(i=>i.type==='v7_returned').sample,/补充完成依据/);
  assert.ok(!(await work('reviewA')).some(i=>i.type==='v7_formal_review'));
  detail=await read();assert.match(JSON.stringify(detail.handling_summary.return_reasons),/补充完成依据/);
  pass('promotion, submit, formal review and formal return are discoverable with current bindings');
  // Existing API permits resubmission of a returned draft; no auto opinion is inserted.
  submitted=await expect('contact',`/api/process-design/drafts/${draft.id}/submit`,'POST',formal);
  await expect('reviewA',`/api/process-design/review-tasks/${submitted.reviewTask.id}/decision`,'POST',{...formal,decision:'approve',note:'合成审核：已核对当前修订'});
  assert.ok((await work('lead')).some(i=>i.type==='v7_publish'));
  const published=await expect('lead',`/api/process-design/drafts/${draft.id}/publish`,'POST',formal);
  assert.ok(published.process_version_id);
  assert.ok(!(await work('lead')).some(i=>i.type==='v7_publish'));
  assert.ok(!(await work('reviewA')).some(i=>i.type==='v7_formal_review'));
  pass('publish task disappears after successful publication; immutable version remains readable');
  const noCross=JSON.parse(JSON.stringify(fixture.document));
  noCross.behaviors.forEach(item=>{item.current_actor_role='合成甲部经办人';});
  detail=await read();
  detail=await expect('contact',`/api/process-v7-preview/cases/${caseId}/revisions`,'POST',{...bind(detail.case),document:noCross,source_file_name:'stage05-no-cross.json'},201);
  assert.ok((await work('lead')).some(i=>i.type==='v7_scope'));
  await expect('lead',`/api/process-v7-preview/cases/${caseId}/scope-decision`,'POST',{...bind(detail.case),decision:'confirmed_no_cross_department',basis:'合成范围核对：全部行为均由合成甲部办理'});
  assert.ok(!(await work('lead')).some(i=>i.type==='v7_scope'),'resolved scope is not a pending task');
  pass('scope task disappears when its actual blocking condition is resolved');
  if(pool) {
    await pool.query('RENAME TABLE process_v7_promotions TO stage05_unavailable_promotions');
    try { await expect('reviewA','/api/role-workbench','GET',undefined,503); }
    finally { await pool.query('RENAME TABLE stage05_unavailable_promotions TO process_v7_promotions'); }
    await work('reviewA');
    pass('V7 query failure returns unavailable rather than empty; recovery succeeds');
  }
  return checks;
};
