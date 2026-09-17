// Synthetic in-memory XLSX fixtures only. No source/DB/server/network writes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ExcelJS = require('exceljs');
const { parseMasterDataTemplate: parse, previewMarkdown, LIMITS } = require('../server/masterDataTemplate');
const profile = require('../server/masterDataTemplateProfile.json');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs/promises');
const path = require('node:path');

function fixture({ objectRow = 17, fieldHeader = 51, fieldRow = 53, enumRow = 257, reverse = false, filled = true } = {}) {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('主数据清单');
  const columns = {};
  for (const [kind, headerRow] of [['object', 15], ['field', fieldHeader]]) {
    const definitions = reverse ? [...profile.sections[kind]].reverse() : profile.sections[kind];
    columns[kind] = Object.fromEntries(definitions.map((d, i) => [d.key, i + 1]));
    sheet.getRow(headerRow).values = definitions.map(d => d.label);
  }
  profile.rule_texts.forEach((rule, i) => { sheet.getCell(`A${6 + i}`).value = rule; });
  sheet.getRow(11).values = ['填报部门*', '合成部门', '填报人*', '合成人员', '部门事实确认人*', '合成确认人', '填报日期*', '2026-09-16', 'MDM 工作组复核人', null, '模板版本', profile.template_version];
  sheet.getRow(enumRow).values = ['类别', '术语或枚举项', '定义与填写边界'];
  const set = (kind, row, key, value, numFmt) => {
    const cell = sheet.getRow(row).getCell(columns[kind][key]); cell.value = value; if (numFmt) cell.numFmt = numFmt; return cell;
  };
  function object(row = objectRow, id = 'OBJ-001', name = '合成对象') {
    for (const d of profile.sections.object) if (d.required) set('object', row, d.key, d.enum_values?.[0] || '合成事实');
    for (const [key, value] of Object.entries({ local_id: id, name, maintaining_department: '待确认', fact_status: '已由部门确认', missing_evidence: '待核对组织', confirmation_actor: '合成主体', expected_date: '2026-10-01', closure_condition: '取得核对依据' })) set('object', row, key, value);
  }
  function field(row = fieldRow, id = 'FLD-001', parent = 'OBJ-001') {
    for (const d of profile.sections.field) if (d.required) set('field', row, d.key, d.enum_values?.[0] || '合成事实');
    for (const [key, value] of Object.entries({ local_id: id, object_local_id: parent, name: '合成编号', role: '唯一标识字段', required: '是', format: '代码', sample_value: '00107', sensitivity: '无敏感信息', masking: '无需脱敏' })) set('field', row, key, value);
  }
  if (filled) { object(); field(); }
  return { wb, sheet, set, object, field, columns, bytes: async () => Buffer.from(await wb.xlsx.writeBuffer()) };
}
const codes = p => p.issues.map(i => i.code);
async function preview(f) { return parse(await f.bytes(), { originalName: 'synthetic.xlsx' }); }

test('valid records preserve provenance and separate raw/normalized values without platform identities', async () => {
  const f = fixture(); f.set('object',17,'name','  合成对象  ');
  const bytes = await f.bytes(), p = await parse(bytes, { originalName: 'fixture.xlsx' });
  assert.equal(p.summary.errors, 0); assert.equal(p.objects.length,1); assert.equal(p.fields.length,1);
  assert.equal(p.source.raw_sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(p.objects[0].values.name,'合成对象'); assert.equal(p.objects[0].cells.find(c=>c.key==='name').raw_value,'  合成对象  ');
  assert.equal(p.fields[0].object_source_row,17); assert.equal(p.fields[0].definition.required,true);
  for (const r of [...p.objects,...p.fields]) { assert.equal(r.platform_entity_id,null); assert.equal(r.platform_version_id,null); assert(r.cells.every(c=>['blank','string','number','boolean','formula','date'].includes(c.raw_type))); assert(r.cells.every(c=>Buffer.byteLength(JSON.stringify(c.raw_value))<=16384)); }
  assert.equal(p.persisted,false); assert.equal(p.source.batch_id,null);
});
test('empty template, exact samples, reserved IDs and derived formulas create zero business records', async () => {
  const f = fixture({filled:false});
  for (const [kind,row] of [['object',16],['field',52]]) for (const d of profile.sections[kind]) if (d.example!==undefined) f.set(kind,row,d.key,d.key==='expected_date'?new Date(d.example):d.example);
  f.set('object',17,'local_id','OBJ-001'); f.set('object',17,'sample_provided',{formula:'IF(B17="","","已提供")'});
  f.set('field',53,'local_id','FLD-001');
  const p=await preview(f); assert.equal(p.status,'empty'); assert.equal(p.summary.errors,0); assert.equal(p.summary.example_rows,2); assert.equal(p.summary.reserved_rows,2);
});
test('changed example is not silently discarded', async () => {
  const f=fixture({filled:false}); for(const d of profile.sections.object)if(d.example!==undefined)f.set('object',16,d.key,d.example);
  f.set('object',16,'name','填写后的实际对象'); const p=await preview(f);
  assert.equal(p.objects.length,1); assert(codes(p).includes('TEMPLATE_LOCAL_ID_REQUIRED'));
});
test('inserted rows beyond old formula ranges and reordered columns keep correct associations', async () => {
  const f=fixture({objectRow:410,fieldHeader:420,fieldRow:430,enumRow:480,reverse:true});
  const p=await preview(f); assert.equal(p.summary.errors,0); assert.equal(p.objects[0].source_row,410); assert.equal(p.fields[0].object_source_row,410);
  assert.equal(p.fields[0].cells.find(c=>c.key==='object_local_id').address,'L430');
});
test('same-name objects remain separate, duplicate IDs and ambiguous/orphan fields are reported', async () => {
  const f=fixture(); f.object(18,'OBJ-002'); f.field(54,'FLD-002','OBJ-002');
  let p=await preview(f); assert.equal(p.objects.length,2); assert.equal(p.summary.errors,0); assert.equal(p.fields[1].object_source_row,18);
  f.object(19,'OBJ-001'); f.field(55,'FLD-001','OBJ-MISSING'); p=await preview(f);
  assert.equal(p.objects.length,3); assert(codes(p).includes('TEMPLATE_DUPLICATE_LOCAL_ID')); assert.equal(p.fields[0].object_source_row,null); assert(codes(p).includes('TEMPLATE_OBJECT_REFERENCE'));
});
test('missing field source and required values report cell locations', async () => {
  const f=fixture(); f.set('field',53,'value_source_type',null); f.set('field',53,'value_source_description',null);
  const p=await preview(f); assert(p.issues.some(i=>i.code==='TEMPLATE_REQUIRED'&&i.address==='H53')); assert(p.issues.some(i=>i.code==='TEMPLATE_REQUIRED'&&i.address==='I53'));
});
test('unknown and duplicate/missing headers preserve raw values and fail validation', async () => {
  const f=fixture(); f.sheet.getCell('AG15').value='未知列'; f.sheet.getCell('AG17').value='保留原文'; f.sheet.getCell('I51').value='未知来源列';
  const p=await preview(f); assert(codes(p).includes('TEMPLATE_UNKNOWN_COLUMN')); assert(codes(p).includes('TEMPLATE_COLUMN_MISMATCH'));
  assert(p.objects[0].cells.some(c=>c.raw_value==='保留原文')); assert(p.fields[0].cells.some(c=>c.key===null&&c.raw_value==='合成事实'));
});
test('missing worksheet/header and out-of-table data do not silently succeed', async () => {
  const f=fixture(); f.sheet.getRow(51).values=[]; const p=await preview(f); assert(codes(p).includes('TEMPLATE_HEADER_UNRECOGNIZED'));
  const g=fixture(); g.sheet.getCell('A300').value='未识别的新增业务内容'; assert(codes(await preview(g)).includes('TEMPLATE_UNCLASSIFIED_ROW'));
  g.sheet.name='其他'; await assert.rejects(preview(g),{code:'TEMPLATE_SHEET_MISSING'});
});
test('literal edits in derived columns and extra cells are not treated as empty reservations', async () => {
  const f=fixture({filled:false}); f.set('object',17,'governance_status','人工填写的状态'); f.sheet.getCell('AN53').value='无表头内容';
  const p=await preview(f); assert.equal(p.objects.length,1); assert.equal(p.fields.length,1); assert(codes(p).includes('TEMPLATE_UNMAPPED_CELL'));
});
test('enums use the verified profile, not edited dropdowns; new departments are not guessed', async () => {
  const f=fixture(); const c=f.set('field',53,'role','管理员认定'); c.dataValidation={type:'list',formulae:['"管理员认定"']};
  f.set('object',17,'maintaining_department','新部门'); const p=await preview(f);
  assert(codes(p).includes('TEMPLATE_ENUM_INVALID')); assert(codes(p).includes('TEMPLATE_ENUM_DECLARATION_CHANGED')); assert(codes(p).includes('TEMPLATE_DEPARTMENT_REVIEW'));
});
test('required unknown and enum format preserve unknown business facts', async () => {
  const f=fixture(); f.set('field',53,'required','待确认'); f.set('field',53,'format','枚举'); const p=await preview(f);
  assert.equal(p.fields[0].definition.required,null); assert.equal(p.fields[0].definition.enum_values,null); assert(codes(p).includes('TEMPLATE_FIELD_ENUM_VALUES_UNSPECIFIED'));
});
test('pending facts including field uncertainty require the complete closure information', async () => {
  const f=fixture(); for(const key of ['missing_evidence','confirmation_actor','expected_date','closure_condition'])f.set('object',17,key,null);
  const p=await preview(f); assert.equal(p.issues.filter(i=>i.code==='TEMPLATE_PENDING_CLOSURE_REQUIRED').length,4);
});
test('stale derived formula status cannot fabricate a pending business fact', async () => {
  const f=fixture(); f.set('object',17,'maintaining_department','工程技术部');
  for(const key of ['missing_evidence','confirmation_actor','expected_date','closure_condition'])f.set('object',17,key,null);
  f.set('object',17,'sample_sensitivity',{formula:'"待确认"',result:'待确认'});
  const p=await preview(f); assert(!codes(p).includes('TEMPLATE_PENDING_CLOSURE_REQUIRED')); assert.equal(p.summary.errors,0);
});
test('composite identifiers are validated without inventing groups', async () => {
  const f=fixture(); f.set('field',53,'role','复合唯一标识字段'); let p=await preview(f); assert(codes(p).includes('TEMPLATE_COMPOSITE_INCOMPLETE'));
  f.field(54,'FLD-002'); f.set('field',54,'role','复合唯一标识字段'); p=await preview(f);
  assert(!codes(p).includes('TEMPLATE_COMPOSITE_INCOMPLETE')); assert(codes(p).includes('TEMPLATE_COMPOSITE_GROUP_PENDING')); assert.equal(p.objects[0].identifier_preview.composite_groups,null);
  f.set('object',17,'identifier_status','无唯一标识'); assert(codes(await preview(f)).includes('TEMPLATE_IDENTIFIER_CONFLICT'));
});
test('leading zeros and code precision are preserved or explicitly rejected', async () => {
  const f=fixture(); f.set('field',53,'sample_value',7,'00000'); let p=await preview(f);
  assert.equal(p.fields[0].values.sample_value,'00007'); assert.equal(p.fields[0].cells.find(c=>c.key==='sample_value').raw_value,7);
  f.set('field',53,'sample_value',9007199254740992,'General'); assert(codes(await preview(f)).includes('TEMPLATE_CODE_FORMAT'));
  f.set('field',53,'sample_value',7,'General'); assert(codes(await preview(f)).includes('TEMPLATE_CODE_LEADING_ZERO_UNKNOWN'));
});
test('date cells keep typed source and valid normalized calendar dates for both Excel epochs', async () => {
  const f=fixture(); f.wb.properties.date1904=true; f.set('object',17,'expected_date',new Date('2026-10-01T00:00:00Z'),'yyyy-mm-dd');
  let p=await preview(f); assert.equal(p.objects[0].values.expected_date,'2026-10-01'); assert.equal(p.objects[0].cells.find(c=>c.key==='expected_date').raw_type,'date'); assert.equal(p.template.date_system,'1904');
  f.set('object',17,'expected_date','2026-02-30'); assert(codes(await preview(f)).includes('TEMPLATE_DATE_INVALID'));
});
test('formulas are not executed; cache, missing cache, error and shared formula are explicit', async () => {
  const f=fixture(); f.set('field',53,'sample_value',{formula:'WEBSERVICE("https://invalid.example/never")',result:'00007'});
  f.set('object',17,'template_check',{formula:'1+1'}); let p=await preview(f);
  assert.equal(p.fields[0].values.sample_value,'00007'); assert(codes(p).includes('TEMPLATE_FORMULA_CACHE_UNVERIFIED')); assert(p.issues.some(i=>i.code==='TEMPLATE_FORMULA_NO_VALUE'&&i.severity==='warning'));
  f.set('field',53,'sample_value',{formula:'1/0',result:{error:'#DIV/0!'}}); p=await preview(f); assert.equal(p.fields[0].values.sample_value,null); assert(p.issues.some(i=>i.code==='TEMPLATE_FORMULA_NO_VALUE'&&i.severity==='error'));
  f.set('field',53,'sample_value',{formula:'1+1',result:2,shareType:'shared',ref:'J53:J54'}); f.field(54,'FLD-002'); f.set('field',54,'sample_value',{sharedFormula:'J53',result:3}); p=await preview(f); assert.equal(p.fields[1].cells.find(c=>c.key==='sample_value').raw_value.sharedFormula,'J53');
});
test('sensitive examples and contradictory masking are blocked even if claimed safe', async () => {
  const f=fixture(); f.set('field',53,'sample_value','13800138000'); let p=await preview(f); assert(codes(p).includes('TEMPLATE_SENSITIVE_SAMPLE_REVIEW'));
  f.set('field',53,'sample_value','已遮盖'); f.set('field',53,'sensitivity','联系方式'); f.set('field',53,'masking','无需脱敏'); assert(codes(await preview(f)).includes('TEMPLATE_SAMPLE_NOT_MASKED'));
  f.set('field',53,'masking','待处理'); assert(codes(await preview(f)).includes('TEMPLATE_SAMPLE_NOT_MASKED'));
  f.set('field',53,'sensitivity','待确认'); assert(codes(await preview(f)).includes('TEMPLATE_SAMPLE_SENSITIVITY_UNRESOLVED'));
});
test('template version differences preview, changed instructions fail without rewriting source', async () => {
  const f=fixture(); f.sheet.getCell('L11').value='第9周-V2'; let p=await preview(f); assert(codes(p).includes('TEMPLATE_VERSION_DIFFERENCE')); assert.equal(p.objects.length,1);
  f.sheet.getCell('A9').value='4. 新规则待核对'; p=await preview(f); assert(codes(p).includes('TEMPLATE_RULES_DIFFERENCE'));
});
test('rich text and hyperlinks retain original structure without following URLs; markdown is escaped', async () => {
  const f=fixture(); f.set('object',17,'name',{richText:[{text:'<script>'},{text:'合成|对象'}]});
  f.set('field',53,'value_source_description',{text:'来源',hyperlink:'https://invalid.example/never'});
  const p=await preview(f); assert.equal(p.objects[0].cells.find(c=>c.key==='name').raw_value.richText.length,2);
  assert.equal(p.fields[0].cells.find(c=>c.key==='value_source_description').hyperlink_not_followed,true);
  const md=previewMarkdown(p); assert(!md.includes('<script>')); assert(!md.includes('00107')); assert(md.includes('合成\\|对象'));
});
test('corrupt, wrong-type, empty, oversized and excessive cell/row/column inputs fail safely', async () => {
  await assert.rejects(parse(Buffer.from('not zip')),{code:'TEMPLATE_ARCHIVE_INVALID'});
  await assert.rejects(parse(Buffer.alloc(0)),{code:'TEMPLATE_INPUT_INVALID'});
  await assert.rejects(parse(Buffer.alloc(LIMITS.bytes+1)),{statusCode:413});
  const f=fixture(); await assert.rejects(parse(await f.bytes(),{originalName:'unsafe.xlsm'}),{code:'TEMPLATE_FILE_TYPE_INVALID'});
  f.set('field',53,'note','x'.repeat(17000)); await assert.rejects(preview(f),{statusCode:413});
  const g=fixture(); g.sheet.getCell('A5001').value='超限'; await assert.rejects(preview(g),{statusCode:413});
  const h=fixture(); h.sheet.getCell('BM1').value='超限'; await assert.rejects(preview(h),{statusCode:413});
});

// Small ZIP writer for malicious envelope fixtures, not a workbook authoring/export path.
function zip(entries) {
  const local=[],central=[];let offset=0;
  for(const [name,value,declared] of entries){
    const raw=Buffer.from(value),body=zlib.deflateRawSync(raw),n=Buffer.from(name),lh=Buffer.alloc(30),ch=Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50);lh.writeUInt16LE(20,4);lh.writeUInt16LE(8,8);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(declared??raw.length,22);lh.writeUInt16LE(n.length,26);
    ch.writeUInt32LE(0x02014b50);ch.writeUInt16LE(20,6);ch.writeUInt16LE(8,10);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(declared??raw.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(offset,42);
    local.push(lh,n,body);central.push(ch,n);offset+=lh.length+n.length+body.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
test('ZIP bombs, misleading expansion, macro/external/DTD entries and sparse dimensions are rejected before ExcelJS', async () => {
  await assert.rejects(parse(zip([['a','a',LIMITS.expanded+1]])),{statusCode:413});
  await assert.rejects(parse(zip([['a','x'.repeat(20000),1]])),{statusCode:413});
  for(const name of ['xl/vbaProject.bin','xl/externalLinks/externalLink1.xml','xl/embeddings/oleObject1.bin'])await assert.rejects(parse(zip([[name,'x']])),{code:'TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED'});
  await assert.rejects(parse(zip([['a.xml','<!DOCTYPE x>']])),{code:'TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED'});
  await assert.rejects(parse(zip([['xl/worksheets/sheet1.xml','<worksheet><dimension ref="A1:XFD1048576"/></worksheet>']])),{statusCode:413});
  await assert.rejects(parse(zip([['a','one'],['a','two']])),{code:'TEMPLATE_ARCHIVE_INVALID'});
});
test('CLI requires explicit paths, preserves source, refuses overwrites and public outputs', async () => {
  const {main}=require('./preview-master-data-template');
  const root=await fs.realpath(path.resolve(__dirname,'../../../artifacts'));
  const temp=await fs.mkdtemp(path.join(root,'p03-cli-test-'));
  try {
    const source=path.join(temp,'fixture.xlsx'),bytes=await fixture().bytes(); await fs.writeFile(source,bytes);
    await assert.rejects(main([]),/必须显式/);
    await assert.rejects(main(['--input',path.join(temp,'must-not-read.env'),'--output',path.join(temp,'invalid')]),{code:'TEMPLATE_FILE_TYPE_INVALID'});
    await assert.rejects(main(['--input',source,'--input',source]),/用法/);
    assert.equal(await main(['--input',source,'--output',path.join(temp,'preview')]),0);
    await assert.rejects(main(['--input',source,'--output',path.join(temp,'preview')]),{code:'EEXIST'});
    await assert.rejects(main(['--input',source,'--output',path.resolve(__dirname,'../public/p03-must-not-exist')]),/artifacts/);
    assert.deepEqual(await fs.readFile(source),bytes);
    const invalid=fixture(); invalid.set('field',53,'value_source_description',null); await fs.writeFile(source,await invalid.bytes());
    assert.equal(await main(['--input',source,'--output',path.join(temp,'invalid-preview')]),2);
    const report=JSON.parse(await fs.readFile(path.join(temp,'invalid-preview/preview.json'))); assert(report.summary.errors>0);
  } finally {
    const actual=await fs.realpath(temp);
    assert.equal(path.dirname(actual),root); assert(path.basename(actual).startsWith('p03-cli-test-'));
    await fs.rm(actual,{recursive:true});
  }
});
