'use strict';
// Reads only the runner's synthetic download evidence; writes a byte-verification report beside it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('An explicit evidence directory is required');
const report=JSON.parse(fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'result.json'))?'result.json':'report.json'),'utf8').replace(/^\uFEFF/,''));
const source=JSON.parse(fs.readFileSync(path.join(root,'fictional-graph-fixture.json'),'utf8'));
assert.equal(source.schema_version,report.sourceVersion);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'fictional-graph-fixture.json'))).digest('hex'),report.originalSourceFile.sha256);
// Preserve every source field; only the explicitly unresolved V9 additions may differ for native V7/V8.
const imported=JSON.parse(JSON.stringify(source));
if(source.schema_version!=='process-governance-v9') {
  assert.ok(['process-governance-v7','process-governance-v8'].includes(source.schema_version));
  imported.schema_version='process-governance-v9';
  imported.process.entry_behavior_refs=[];
  imported.data_objects.forEach(data=>{
    data.record_model='pending_confirmation';data.collection_field_refs=[];
    data.behavior_links.forEach(link=>{link.record_scope='pending_confirmation';link.presence='pending_confirmation';});
    data.source_relations.forEach(relation=>{relation.presence='pending_confirmation';});
  });
}
const normalized=value=>{const next=JSON.parse(JSON.stringify(value));delete next.export_meta.exported_at;return next;};
let result;
if(Array.isArray(report.downloads)) {
const documents={};
for(const item of report.downloads){const bytes=fs.readFileSync(path.join(root,item.name+'.json'));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.digest);assert.equal(bytes.length,item.byteLength);assert.equal(JSON.parse(bytes).schema_version,'process-governance-v9');documents[item.name]=JSON.parse(bytes);}
assert.equal(documents.objects.behaviors.find(x=>x.behavior_ref==='behavior_fixture_submit').behavior_description,'真实Edge候选验证：本对象修改');
assert.equal(documents.objects.process.purpose,'真实Edge候选验证：流程目的');
assert.equal(documents.objects.terms.find(x=>x.term_ref==='graph_term').definition,'真实Edge候选验证：术语定义');
assert.equal(documents.objects.forms.find(x=>x.form_ref==='graph_form').areas[0].area_title,'真实Edge候选验证：表单区域');
assert.equal(documents.grid.data_objects[0].data_name,'跨表候选验证：资料');
assert.equal(documents.grid.data_objects[0].description,'详情与表格共用副本');
assert.equal(documents.grid.forms[0].form_name,'跨表候选验证：表单');
assert.deepEqual(normalized(documents.baseline),normalized(imported));
assert.deepEqual(normalized(documents['undo-grid']),normalized(documents.objects));
assert.deepEqual(normalized(documents.final),normalized(documents.roundtrip));
assert.ok(!documents.final.behaviors.some(x=>x.behavior_name==='真实Edge新增再删除'));
result={passed:true,downloadCount:report.downloads.length,checks:['each actual byte SHA256, length and V9 version','strictly validated source body preserved through import','object fields','shared grid edits','whole draft one undo','V9 download reimport preserves content and stable IDs','confirmed deletion']};
} else {
  const proofs=[['before-reading',report.downloads.before],['after-reading',report.downloads.after],['before-rejected-import',report.rejectedImport.beforeDownload],['after-rejected-import',report.rejectedImport.afterDownload]],documents={};
  for(const [name,proof] of proofs){const bytes=fs.readFileSync(path.join(root,name+'.json'));assert.equal(bytes.length,proof.byteLength);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),proof.digest);const document=JSON.parse(bytes);assert.equal(document.schema_version,'process-governance-v9');documents[name]=normalized(document);}
  assert.deepEqual(documents['before-reading'],normalized(imported));
  assert.deepEqual(documents['before-reading'],documents['after-reading']);
  assert.deepEqual(documents['before-rejected-import'],documents['after-rejected-import']);
  result={passed:true,downloadCount:proofs.length,checks:['actual byte SHA256, length and V9 version','strictly validated source body preserved through import','reading does not change business JSON','failed import does not change business JSON']};
}
fs.writeFileSync(path.join(root,'byte-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
