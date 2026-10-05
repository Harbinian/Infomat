'use strict';
// Reads only the runner's synthetic download evidence; writes a byte-verification report beside it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('An explicit evidence directory is required');
const report=JSON.parse(fs.readFileSync(path.join(root,'report.json'),'utf8'));
const documents={};
for(const item of report.downloads){const bytes=fs.readFileSync(path.join(root,item.name+'.json'));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.digest);assert.equal(bytes.length,item.byteLength);documents[item.name]=JSON.parse(bytes);}
assert.equal(documents.objects.behaviors.find(x=>x.behavior_ref==='behavior_fixture_submit').behavior_description,'真实Edge候选验证：本对象修改');
assert.equal(documents.objects.process.purpose,'真实Edge候选验证：流程目的');
assert.equal(documents.objects.terms.find(x=>x.term_ref==='graph_term').definition,'真实Edge候选验证：术语定义');
assert.equal(documents.objects.forms.find(x=>x.form_ref==='graph_form').areas[0].area_title,'真实Edge候选验证：表单区域');
assert.equal(documents.grid.data_objects[0].data_name,'跨表候选验证：资料');
assert.equal(documents.grid.data_objects[0].description,'详情与表格共用副本');
assert.equal(documents.grid.forms[0].form_name,'跨表候选验证：表单');
const normalized=value=>{const next=JSON.parse(JSON.stringify(value));delete next.export_meta.exported_at;return next;};
assert.deepEqual(normalized(documents['undo-grid']),normalized(documents.objects));
assert.deepEqual(normalized(documents.final),normalized(documents.roundtrip));
assert.ok(!documents.final.behaviors.some(x=>x.behavior_name==='真实Edge新增再删除'));
const result={passed:true,downloadCount:report.downloads.length,checks:['each actual byte SHA256 and length','object fields','shared grid edits','whole draft one undo','V8 download reimport preserves content and stable IDs','confirmed deletion']};
fs.writeFileSync(path.join(root,'byte-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
