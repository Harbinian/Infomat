const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const ExcelJS = require('exceljs');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const spreadsheet = require('../server/publicationSpreadsheet');
const { makePublicationRepository } = require('../server/publicationRepository');
const { managePublicationSchema } = require('../server/publicationSchema');

function document(kind, rows, extra = {}) {
  const headers = { organization:['部门编码','部门名称','上级部门编码'], roster:['工号','姓名','部门编码','备注'], master_data:['编码','名称','备注'] }[kind];
  return spreadsheet.normalizePublication({ kind, title:'合成导入测试', sourceFileName:'synthetic.xlsx', headers, rows, mapping:spreadsheet.suggestedMapping(kind,headers), keyHeader:headers[0], ...extra });
}
async function parserChecks() {
  const original = document('master_data', [['001','合成项目','  原始空格  '],['002','=SUM(A1:A2)','普通文字']]);
  const xlsx = Buffer.from(await spreadsheet.exportSpreadsheet(original.content));
  const parsed = await spreadsheet.parseSpreadsheet(xlsx, 'synthetic.xlsx');
  assert.deepEqual(parsed.rows, original.content.rows, 'all columns and literal text survive XLSX export/import');
  assert.throws(() => document('master_data',[['a','一',''],[' A ','二','']]), /重复/);
  await assert.rejects(spreadsheet.parseSpreadsheet(Buffer.from([0xff,0xfe,0x00]),'bad.csv'), /UTF-8/);
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('数据');
  sheet.addRow(['编码','名称']); sheet.addRow([7,'合成']); sheet.getCell('A2').numFmt='0000';
  assert.equal((await spreadsheet.parseSpreadsheet(Buffer.from(await book.xlsx.writeBuffer()),'zero.xlsx')).rows[0][0],'0007');
  sheet.getCell('B2').value={formula:'1+1',result:2};
  await assert.rejects(spreadsheet.parseSpreadsheet(Buffer.from(await book.xlsx.writeBuffer()),'formula.xlsx'),/公式/);
  sheet.getCell('B2').value='合成'; sheet.getCell('C2').value='不能丢失';
  await assert.rejects(spreadsheet.parseSpreadsheet(Buffer.from(await book.xlsx.writeBuffer()),'extra.xlsx'),/列名/);
  const spacedBook = new ExcelJS.Workbook(); const spacedSheet = spacedBook.addWorksheet('间隔行');
  spacedSheet.addRow(['编码','名称','备注']); spacedSheet.getRow(4).values=['001','合成一','']; spacedSheet.getRow(7).values=['001','合成重复',''];
  const spaced = await spreadsheet.parseSpreadsheet(Buffer.from(await spacedBook.xlsx.writeBuffer()),'spaced.xlsx');
  assert.deepEqual(spaced.sourceRows,[4,7]);
  assert.throws(()=>document('master_data',spaced.rows,{sourceRows:spaced.sourceRows}),/第7行与第4行/);
  console.log('PUBLICATION_PARSER_PASS');
}
async function databaseChecks(pool) {
  await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
  assert.equal((await managePublicationSchema(pool,'apply')).state,'applied');
  assert.equal((await managePublicationSchema(pool,'apply')).state,'applied');
  await pool.execute("INSERT INTO departments(id,code,name) VALUES (91,'KEEP','合成保留部')");
  await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (81,'SYNTHETIC_ADMIN','合成管理员',91),(82,'SYNTHETIC_LEAD','合成发布人',91)");
  await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES (181,81,'SYNTHETIC_ADMIN','synthetic-hash-never-a-real-credential','active'),(182,82,'SYNTHETIC_LEAD','synthetic-hash-never-a-real-credential','active')");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 81,role_id,'global','synthetic test',CURRENT_DATE FROM roles WHERE role_code='admin'");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 82,role_id,'global','synthetic test',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
  const actor={personId:82,accountId:182,authVersion:1};
  const repo=makePublicationRepository(pool);
  async function publish(normalized,key,review) { return repo.publish({ content:normalized.content,datasetKey:key,...(review || await repo.preview(normalized,key)),requestId:crypto.randomUUID() },actor); }
  const org=document('organization',[['O1','合成根组织',''],['O2','合成下级','O1']]);
  const first=await publish(org);
  assert.equal(first.version_no,1);
  assert.equal((await repo.preview(org)).summary.unchanged,2);
  const [depts]=await pool.query("SELECT id,parent_id,path FROM departments WHERE code='O2'");
  assert.ok(depts[0].parent_id); assert.match(depts[0].path,new RegExp('/'+depts[0].parent_id+'/'+depts[0].id+'/$'));
  const cycle=document('organization',[['O1','合成根组织','O2']]);
  assert.ok((await repo.preview(cycle)).errors.length);
  await assert.rejects(publish(cycle),error=>error.code==='PUBLICATION_REVIEW_REQUIRED');
  const roster=document('roster',[['0007','合成人员','O2','保留额外列']]);
  const rosterVersion=await publish(roster);
  const [[person]]=await pool.execute("SELECT person_id FROM person WHERE employee_no='0007'");
  const edited=document('roster',[['0007','合成人员改名','O2','仍保留']]);
  await publish(edited);
  const [[changed]]=await pool.execute("SELECT person_id,person_name FROM person WHERE employee_no='0007'");
  assert.equal(changed.person_id,person.person_id); assert.equal(changed.person_name,'合成人员改名');
  assert.equal((await repo.get(rosterVersion.id)).content.rows[0][3],'保留额外列');
  const [[accounts]]=await pool.query('SELECT COUNT(*) AS count,MIN(password_hash) AS hash FROM user_accounts');
  assert.equal(accounts.count,2); assert.equal(accounts.hash,'synthetic-hash-never-a-real-credential');
  const blocked=document('roster',[['SYNTHETIC_ADMIN','不得更改管理员','KEEP','']]);
  assert.match((await repo.preview(blocked)).errors[0].message,/管理员/);
  const missing=document('roster',[['P_NEW','新增不应落库','MISSING','']]);
  await assert.rejects(publish(missing),error=>error.code==='PUBLICATION_REVIEW_REQUIRED');
  const [[missingCount]]=await pool.execute("SELECT COUNT(*) AS count FROM person WHERE employee_no='P_NEW'"); assert.equal(missingCount.count,0);
  const master=document('master_data',[['001','合成一',''],['002','合成二','']]);
  const checked=await repo.preview(master,'synthetic_master');
  const input={content:master.content,datasetKey:'synthetic_master',...checked,requestId:crypto.randomUUID()};
  const m1=await repo.publish(input,actor);
  assert.equal((await repo.publish(input,actor)).id,m1.id);
  const m2data=document('master_data',[['001','合成一修订','']]);
  const next=await repo.preview(m2data,'synthetic_master'); assert.equal(next.summary.removed,1);
  const m2=await publish(m2data,'synthetic_master',next); assert.equal(m2.version_no,2); assert.equal(m2.previous_publication_id,m1.id);
  assert.equal((await repo.get(m1.id)).content.rows.length,2);
  await assert.rejects(publish(master,'synthetic_master',checked),error=>error.code==='PUBLICATION_SOURCE_CHANGED');
  const parallel=await repo.preview(master,'parallel');
  const race=await Promise.allSettled([publish(master,'parallel',parallel),publish(master,'parallel',parallel)]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  await apiChecks(repo);
  await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=82');
  await assert.rejects(publish(master,'revoked'),error=>error.code==='PUBLICATION_ACCESS_CHANGED');
  console.log('PUBLICATION_MYSQL_PASS: atomicity, hierarchy, stable identities, immutable versions, idempotency, stale preview and concurrency');
}
async function apiChecks(repo) {
  const auth=require('../server/auth');
  process.env.MDM_IDENTITY_READ_MODEL='mysql';
  auth.setIdentityRepositoryFactory(()=>({validateSession:async session=>({valid:true,user:{personId:session.personId,accountId:182,authVersion:1}})}));
  const router=require('../server/routes/publications');
  router.setRepositoryFactory(()=>repo);
  router.setActorFactory(req=>({personId:82,accountId:182,authVersion:1,canRead:req.headers['x-test-role']!=='outsider',canPrepare:['admin','lead'].includes(req.headers['x-test-role']),canPublish:req.headers['x-test-role']==='lead'}));
  const app=express();
  app.use((req,res,next)=>{if(req.headers['x-test-role'])req.session={personId:82,accountId:182,authVersion:1};next();});
  app.use('/api/publications',router);
  app.use('/api/process-diagrams',require('../server/routes/processDiagrams'));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+'/api/publications';
  const request=async(path,role,fields)=>{
    const form=fields && new FormData();
    if(form){form.append('file',new Blob(['编码,名称,备注\nA,合成行,额外值\n']), '合成文件.csv');for(const [key,value]of Object.entries(fields))form.append(key,typeof value==='object'?JSON.stringify(value):value);}
    const response=await fetch(base+path,{method:form?'POST':'GET',headers:role?{'x-test-role':role}:{},body:form});
    return {status:response.status,body:await response.json()};
  };
  try {
    assert.equal((await request('/status')).status,401);
    assert.equal((await request('/status','outsider')).status,403);
    const template=await fetch(base+'/template?kind=roster',{headers:{'x-test-role':'admin'}});
    assert.equal(template.status,200);
    const templateBook=new ExcelJS.Workbook();await templateBook.xlsx.load(Buffer.from(await template.arrayBuffer()));
    assert.ok(templateBook.worksheets[0].getRow(1).values.includes('工号'));
    const assetsBase=base.replace('/api/publications','/api/process-diagrams/assets/');
    assert.equal((await fetch(assetsBase+'process-diagram.js')).status,401);
    assert.equal((await fetch(assetsBase+'unknown.js',{headers:{'x-test-role':'admin'}})).status,404);
    for(const asset of ['process-diagram.js','data-relation-diagram.js','cytoscape.min.js']) assert.equal((await fetch(assetsBase+asset,{headers:{'x-test-role':'admin'}})).status,200);
    const admin=await request('/status','admin'); assert.equal(admin.body.canPrepare,true);assert.equal(admin.body.canPublish,false);
    const fields={kind:'master_data',title:'合成HTTP发布',datasetKey:'http_synthetic',keyHeader:'编码'};
    assert.equal((await request('/parse','admin',fields)).status,200);
    const preview=await request('/preview','admin',fields); assert.equal(preview.status,200);
    const publishFields={...fields,checked:preview.body,confirmed:'true',requestId:crypto.randomUUID()};
    assert.equal((await request('/publish','admin',publishFields)).status,403);
    const published=await request('/publish','lead',publishFields); assert.equal(published.status,201,JSON.stringify(published.body));
    assert.equal((await request('/publish','lead',publishFields)).status,200);
    const read=await request('/'+published.body.id,'admin'); assert.equal(read.body.content.rows[0][2],'额外值');assert.equal(read.body.source_file_name,'合成文件.csv');
    const download=await fetch(base+'/'+published.body.id+'/download',{headers:{'x-test-role':'admin'}});
    assert.equal(download.status,200);
    assert.equal((await spreadsheet.parseSpreadsheet(Buffer.from(await download.arrayBuffer()),'download.xlsx')).rows[0][0],'A');
  } finally { await new Promise(resolve=>server.close(resolve)); router.setActorFactory(null); router.setRepositoryFactory(null); auth.resetIdentityRepositoryFactory(); }
  console.log('PUBLICATION_HTTP_PASS: login required, role separation, multipart preview/publish and download');
}
async function main(){await parserChecks();await withFreshMysql(({pool})=>databaseChecks(pool),{stage:'07'});}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
