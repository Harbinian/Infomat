// P04 adapter: upload bytes are reparsed for every preview and confirmation.
// No uploaded workbook or client-supplied definition is trusted or stored on disk.
const { parseMasterDataTemplate } = require('./masterDataTemplate');
const { failure, id, digest } = require('./dataMapDefinitionValues');

function normalizeLinks(input, preview) {
  if (!Array.isArray(input) || input.length > preview.objects.length + preview.fields.length) throw failure('TEMPLATE_LINKS_INVALID');
  const seen = new Set(), entities = new Set();
  return input.map(link => {
    if (!link || Object.keys(link).some(k => !['record_type','source_row','entity_id','expected_revision'].includes(k))) throw failure('TEMPLATE_LINKS_INVALID');
    const records = link.record_type === 'object' ? preview.objects : link.record_type === 'field' ? preview.fields : [];
    if (!records.some(r => r.source_row === link.source_row) || !Number.isSafeInteger(link.expected_revision) || link.expected_revision < 1) throw failure('TEMPLATE_LINKS_INVALID');
    const entityId = id(link.entity_id), key = `${link.record_type}:${link.source_row}`, entityKey = `${link.record_type}:${entityId}`;
    if (seen.has(key) || entities.has(entityKey)) throw failure('TEMPLATE_LINKS_INVALID');
    seen.add(key); entities.add(entityKey);
    return { record_type:link.record_type, source_row:link.source_row, entity_id:entityId, expected_revision:link.expected_revision };
  }).sort((a,b) => a.record_type.localeCompare(b.record_type) || a.source_row-b.source_row);
}

function recordDefinition(record, batchId) {
  const v = record.values;
  const source = { batch_id:batchId, sheet_name:record.sheet_name, source_row:record.source_row,
    local_id:record.local_id, verification_status:'pending_verification',
    cells:record.cells.map(c => ({ key:c.key,address:c.address,num_fmt:c.num_fmt,formula_state:c.formula_state })) };
  if (record.record_type === 'object') return { name:v.name, business_meaning:v.meaning, source,
    authority_suggestion:{type:v.suggested_authority_type,name:v.suggested_authority_name,basis_type:v.basis_type,basis_description:v.basis_description},
    formation:{type:v.source_type,location:v.source_location,scenario:v.creation_scenario},
    maintenance:{department_text:v.maintaining_department,role_text:v.maintaining_role},
    usage:{scope:v.usage_scope,scenario:v.usage_scenario},storage:{location:v.storage_location,current_source:v.current_source},
    lifecycle:{create:v.create_rule,change:v.change_rule,retire:v.retire_rule} };
  return { name:v.name, business_meaning:v.meaning, source:{...source,type:v.value_source_type,description:v.value_source_description},
    data_format:v.format, required:record.definition.required, enum_values:null,
    identifier_role:v.role,sensitivity:v.sensitivity,masking:v.masking };
}

async function prepareImport(bytes, originalName, links, who) {
  const preview = await parseMasterDataTemplate(bytes, { originalName });
  const normalized = normalizeLinks(links, preview);
  // Storage limits are checked before enabling confirmation and identify a cell.
  for (const record of [...preview.objects,...preview.fields]) {
    for (const [key,max] of Object.entries({name:255,meaning:4096,format:128,sensitivity:32,masking:4096})) {
      if (typeof record.values[key] === 'string' && record.values[key].length > max) preview.issues.push({code:'TEMPLATE_DEFINITION_LIMIT',severity:'error',message:`内容超过台账允许的${max}个字符，请在源文件修正。`,sheet_name:record.sheet_name,row:record.source_row,address:record.cells.find(c=>c.key===key)?.address,key});
    }
    if (Buffer.byteLength(JSON.stringify(recordDefinition(record,'9223372036854775807'))) > 65536) preview.issues.push({code:'TEMPLATE_DEFINITION_LIMIT',severity:'error',message:'此行映射到台账的定义超过64KB，请精简定义文字后重新检查；源单元格不能截断入库。',sheet_name:record.sheet_name,row:record.source_row,address:record.cells[0]?.address});
  }
  preview.summary.errors = preview.issues.filter(i=>i.severity==='error').length;
  preview.validation_passed = preview.summary.errors === 0;
  if (!preview.validation_passed) preview.status = 'needs_correction';
  const binding = { raw_sha256:preview.source.raw_sha256,parser_version:preview.source.parser_version,
    template_profile_version:preview.source.template_profile_version,department_id:who.departmentId,links:normalized };
  return { preview, links:normalized, plan_digest:digest(binding),
    preview_digest:digest({...binding,person_id:who.personId}), department_id:who.departmentId };
}
module.exports = { prepareImport, recordDefinition };
