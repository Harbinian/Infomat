// Immutable Excel snapshots reuse source batches. No ledger creation or inferred mappings.
const { id, json, digest, parse, lastId } = require('./dataMapDefinitionValues');
const { VERSION, parseExcelEvidence, fail } = require('./excelEvidenceParser');
const { MIGRATION_KEY } = require('./excelEvidenceSchema');
async function ready(db) {
  if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length) throw fail('MIGRATION_REQUIRED', 503);
}
async function load(db, who, batch, scope, resolve) {
  await ready(db);
  const [[row]] = await db.execute('SELECT snapshot_json,snapshot_digest FROM data_map_excel_evidence WHERE batch_id=? FOR SHARE', [id(batch.batch_id)]);
  if (!row) throw fail('NOT_FOUND', 404);
  scope(who, batch.scope_department_id);
  const value = parse(row.snapshot_json);
  if (digest(value) !== row.snapshot_digest || value.raw_sha256 !== batch.raw_sha256 || value.parser_version !== batch.parser_version ||
    value.document.format !== VERSION || value.content_digest !== digest(value.document) || digest(value.document.links) !== batch.template_profile_version) throw fail('INTEGRITY_CONFLICT', 409);
  for (const link of value.document.links) {
    const current = await resolve(db, who, link.kind, link.ref_id);
    if (json(current.snapshot) !== json(link.fixed_reference)) throw fail('REFERENCE_CHANGED', 409);
  }
  return value;
}
module.exports = helpers => {
  const { transaction, actor, scope, request } = helpers;
  const resolve = require('./analysisInputReferences')(helpers);
  return {
    async registerExcelEvidence(session, payload, bytes) {
      if (Object.keys(payload).some(k => !['request_id','original_name','links'].includes(k))) throw fail('PROPERTY');
      // Authorize before spending CPU, then reauthorize after extraction inside commit transaction.
      await transaction(async db => { await ready(db); const who = await actor(db,session,'governance:structure-gate'); scope(who,who.departmentId,true); });
      const parsed = await parseExcelEvidence(bytes,payload.original_name);
      const links = payload.links || [];
      if (!Array.isArray(links) || links.length > 32) throw fail('MAPPING');
      return transaction(async db => {
        await ready(db); const who = await actor(db,session,'governance:structure-gate'); scope(who,who.departmentId,true);
        const mapped = [];
        for (const link of links) {
          if (!link || Object.keys(link).some(k=>!['sheet_name','cell_address','kind','ref_id','basis'].includes(k)) || !['definition','mapping','v7_source'].includes(link.kind) || typeof link.basis !== 'string' || !link.basis.trim() || link.basis.length>1000) throw fail('MAPPING');
          const sheet = parsed.document.sheets.find(s=>s.name===link.sheet_name);
          if (!sheet || !Object.hasOwn(sheet.cells,link.cell_address)) throw fail('LOCATOR',404);
          const reference = await resolve(db,who,link.kind,link.ref_id);
          mapped.push({ ...link, ref_id:id(link.ref_id), fixed_reference:reference.snapshot });
        }
        if(new Set(mapped.map(l=>json([l.sheet_name,l.cell_address,l.kind,l.ref_id]))).size!==mapped.length) throw fail('MAPPING');
        const value = { ...parsed, document: { ...parsed.document, links:mapped } };
        value.content_digest=digest(value.document);
        const profile = digest(mapped), body={...payload,raw_sha256:value.raw_sha256,profile};
        return request(db,who,'excel_evidence',body,async()=>{
          const [[prior]]=await db.execute('SELECT CAST(batch_id AS CHAR) batch_id,CAST(scope_department_id AS CHAR) scope_department_id,raw_sha256,parser_version,template_profile_version FROM data_map_source_files WHERE raw_sha256=? AND parser_version=? AND template_profile_version=? AND scope_department_id=?',[value.raw_sha256,VERSION,profile,who.departmentId]);
          if(prior){await load(db,who,prior,scope,resolve);return {batch_id:prior.batch_id,duplicate:true,raw_sha256:value.raw_sha256};}
          await db.execute("INSERT INTO data_map_import_batches(source_type,file_name,status,note) VALUES ('excel_evidence',?,'imported',?)",[value.original_name,'excel-evidence-v1: evidence registered; no ledger import or business confirmation']);
          const batchId=await lastId(db);
          await db.execute('INSERT INTO data_map_source_files(batch_id,raw_sha256,raw_digest_status,byte_length,parser_version,template_profile_version,scope_department_id,imported_by_person_id) VALUES (?,?,?,?,?,?,?,?)',[batchId,value.raw_sha256,'available',value.byte_length,VERSION,profile,who.departmentId,who.personId]);
          await db.execute('INSERT INTO data_map_excel_evidence(batch_id,snapshot_json,snapshot_digest) VALUES (?,?,?)',[batchId,json(value),digest(value)]);
          return {batch_id:batchId,duplicate:false,raw_sha256:value.raw_sha256};
        });
      });
    },
    getExcelEvidence(session,batchId,query={}) { return transaction(async db=>{
      if(Object.keys(query).some(k=>!['sheet','address','offset'].includes(k)))throw fail('QUERY');
      const who=await actor(db,session),source=await resolve(db,who,'template',id(batchId));
      if(source.snapshot.source_kind!=='excel_material')throw fail('NOT_FOUND',404);
      const doc=source.document;
      const sheets=doc.sheets.map(s=>({name:s.name,state:s.state,row_count:s.row_count,column_count:s.column_count,cell_count:Object.keys(s.cells).length,merges:s.merges}));
      if(query.sheet===undefined)return {source:source.snapshot,coverage:doc.coverage,sheets,links:doc.links};
      const sheet=doc.sheets.find(s=>s.name===query.sheet);if(!sheet)throw fail('LOCATOR',404);
      if(query.address!==undefined){if(!Object.hasOwn(sheet.cells,query.address))throw fail('LOCATOR',404);return {source:source.snapshot,cell:sheet.cells[query.address],extraction_status:'resolved'};}
      if(query.offset!==undefined&&!/^(0|[1-9]\d{0,5})$/.test(String(query.offset)))throw fail('QUERY');
      const offset=Number(query.offset||0),all=Object.values(sheet.cells),cells=all.slice(offset,offset+100);
      return {source:source.snapshot,sheet:sheet.name,cells,next_offset:offset+100<all.length?offset+100:null};
    }); }
  };
};
module.exports.load=load;
