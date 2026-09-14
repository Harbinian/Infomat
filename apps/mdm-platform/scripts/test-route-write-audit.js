const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const root=path.resolve(__dirname,'..');
const audit=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'audit-route-write-permissions.js'),'--json'],{cwd:root,env:isolatedEnvironment(),encoding:'utf8',maxBuffer:15*1024*1024}));
assert.equal(audit.unclassified.length,0);
assert.equal(audit.schemaVersion,2);
const find=(file,method,url)=>audit.entries.filter(r=>r.file===file&&r.method===method&&r.path===url);
assert.equal(find('person.js','POST','/')[0].category,'isolatedLegacy');
assert.deepEqual(find('org.js','POST','/users').map(r=>r.category),['retired','shadowed']);
assert.equal(find('roles.js','POST','/')[0].category,'retired');
assert.equal(find('rbac.js','ALL','/model')[0].category,'retired');
assert.equal(find('importRbac.js','ALL','*')[0].category,'retired');
const revoke=find('accounts.js','POST','/:personId/role-assignments/:assignmentId/revoke')[0];
assert.equal(revoke.category,'identityWrite','multiline registration must be included');
assert.ok(revoke.permissions.includes('identity:assign-role'));
assert.ok(revoke.repository.methods.some(m=>m.anchor==='revokeRole'));
const decision=find('governance.js','POST','/decision-records')[0];
assert.equal(decision.category,'businessWrite','multiline department responsibility write must be included');
for(const action of ['confirm','review','collaborate','studio-review','mdm-decision']) {
  assert.equal(find('processGovernance.js','POST','/issue-pool/points/:pointId/'+action)[0].category,'businessWrite','dynamic actions must each be traced');
}
for(const row of audit.entries.filter(e=>['businessWrite','identityWrite'].includes(e.category))) {
  assert.ok(row.guards.length, row.id+' needs authorization evidence');
  assert.ok(row.repository.files.length,row.id+' needs repository evidence');
  assert.ok(row.repository.methods.length,row.id+' needs a located repository method, including local helper calls');
  for(const control of ['permission','department','objectState','concurrency','audit'])assert.ok(row.controls[control],row.id+' missing '+control+' trace');
  assert.ok(row.reason&&row.sourceSha256,row.id);
  const refs=[...row.helperReferences,...row.repository.methods];
  for(const ref of refs) {
    const lines=fs.readFileSync(path.join(root,ref.file),'utf8').split(/\r?\n/);
    assert.ok(lines[ref.line-1].includes(ref.anchor),`${row.id} stale reference ${ref.file}:${ref.line}`);
  }
}
for(const url of ['/quality-cases/:id/comment','/mapping-todos/:id/comment']) {
  assert.ok(find('processGovernance.js','POST',url)[0].permissions.some(p=>p.startsWith('governance:')&&!p.includes('read-')),'read access alone cannot authorize comments');
}
assert.ok(find('conflicts.js','POST','/:id/coordination')[0].guards.includes('canManageGeneralConflict'));
for(const [file,url] of [['processDesignEditor.js','/validate'],['processDesignMysql.js','/import-structured-output/preview'],['processV7PreviewReview.js','/cases/:id/revisions/preview']])assert.equal(find(file,'POST',url)[0].category,'validationOnly');
console.log(JSON.stringify({result:'ROUTE_WRITE_TRACE_PASS',counts:audit.counts,formalRegistrations:audit.formalRegistrations,staticDeclarations:audit.staticDeclarations}));
