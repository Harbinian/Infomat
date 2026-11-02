// Atomic legacy XLSX import. Reuses batch + immutable request metadata in mdm_version_log.
const {fail,digest,transaction,actor} = require('./legacyGovernanceWrites');
const crypto = require('node:crypto');
async function importFields(pool,{contextId,rows,fileName,buffer,requestId},session) {
 if(requestId!==undefined && (typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) throw fail(400,'LEGACY_IMPORT_REQUEST_INVALID','导入请求编号必须是有效的 UUID v4');
 requestId=requestId?.toLowerCase();
 const contentHash=crypto.createHash('sha256').update(buffer).digest('hex');
 const payloadHash=digest({context_id:contextId,department_id:session.departmentId,content_hash:contentHash});
 const key=requestId?'legacy_field_import:'+requestId:null;
 let named=false;
 // Named locks are connection-scoped and must outlive commit. Acquire the
 // request lock before the transaction and any context/current identity reads.
 const db=await pool.getConnection();
 try {
  if(requestId) {
   const [[lock]]=await db.execute('SELECT GET_LOCK(?,5) acquired',['legacy-import:'+digest([session.personId,requestId]).slice(0,48)]);
   if(Number(lock.acquired)!==1) throw fail(409,'LEGACY_IMPORT_BUSY','原导入请求仍在处理中，请保留请求并稍后核对');named=true;
  }
  return await transaction(pool,async conn=>{
   const [[context]]=await conn.execute('SELECT * FROM data_map_contexts WHERE id=? FOR UPDATE',[contextId]);
   if(!context) throw fail(404,'LEGACY_IMPORT_CONTEXT_MISSING','数据地图上下文不存在');
   const current=await actor(conn,session,'governance:draft-department');
   await require('./dataMapHandoffControl').assertLegacyWriteAllowed(conn,{entryId:'W05:legacyFieldImport'});
   if(Number(context.dept_id)!==Number(current.current_department_id)) throw fail(403,'LEGACY_WRITE_FORBIDDEN','无权导入该数据地图上下文字段台账');
   const repo=require('./dataMapMysqlRepository').makeDataMapMysqlRepository(conn);
   if(key) {
    const [[prior]]=await conn.execute("SELECT CAST(entity_id AS CHAR) batch_id,metadata_json FROM mdm_version_log WHERE entity_type='legacy_field_import' AND operation='create' AND field_name=? AND operated_by_person_id=? ORDER BY id LIMIT 1 FOR SHARE",[key,session.personId]);
    if(prior) {
     const saved=typeof prior.metadata_json==='string'?JSON.parse(prior.metadata_json):prior.metadata_json;
     if(saved.payload_hash!==payloadHash) throw fail(409,'LEGACY_IMPORT_REQUEST_CONFLICT','原请求编号已用于其他内容或上下文，请核对原请求');
     // Deletion/history does not authorize recreation. Return the original receipt.
     let present=0;for(const id of saved.field_ids) {const [[f]]=await conn.execute('SELECT id FROM data_map_fields WHERE id=? AND context_id=? FOR SHARE',[id,contextId]);if(f) present++;}
     const [[batch]]=await conn.execute('SELECT id FROM data_map_import_batches WHERE id=? FOR SHARE',[prior.batch_id]);
     return {...saved.response,receipt:{...saved.receipt,replayed:true,current_fields_present:present,batch_present:Boolean(batch)}};
    }
   }
   // Preserve the template/string/blank-row mapping. Existing object metadata
   // and fields are never overwritten by this import, including an old matching key.
   const ids=[];
   for(const row of rows) {
    const id=(await repo.createField(row,session.userId,{preserveObject:true})).id;
    if(!Number.isSafeInteger(id)||id<1) throw fail(409,'LEGACY_IMPORT_ID_INVALID','字段编号超出现有接口的精确编号范围，本次导入已撤销');
    ids.push(id);
   }
   const batch=await repo.recordImportBatch({source_type:'excel',file_name:fileName,context_id:contextId,imported_by:session.userId,row_count:rows.length,status:'imported',note:'字段台账导入'});
   if(!Number.isSafeInteger(batch.id)||batch.id<1) throw fail(409,'LEGACY_IMPORT_ID_INVALID','批次编号超出现有接口的精确编号范围，本次导入已撤销');
   const response={imported:rows.length,context_id:contextId,mapping_id:contextId};
   const receipt={request_id:requestId||null,content_hash:contentHash,batch_id:batch.id,field_ids:ids};
   await conn.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,field_name,operation,operated_by,operated_by_person_id,metadata_json) VALUES('legacy_field_import',?,?,'create',?,?,?)`,
    [batch.id,key,session.userId,session.personId,JSON.stringify({schema_version:'legacy-field-import-v1',payload_hash:payloadHash,field_ids:ids,receipt,response})]);
   return requestId?{...response,receipt}:response;
  },db);
 } catch(error) {if(error.code!=='LEGACY_WRITE_UNKNOWN')error.import_status='not_committed';throw error;}
 finally {
  if(named) await db.execute('SELECT RELEASE_LOCK(?)',['legacy-import:'+digest([session.personId,requestId]).slice(0,48)]).catch(()=>{});
  db.release();
 }
}
module.exports={importFields};
