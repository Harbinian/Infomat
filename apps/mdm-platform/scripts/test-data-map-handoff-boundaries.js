// Pure boundary regressions. No env files, MySQL connection, service, or filesystem writes.
const assert=require('node:assert/strict');
const control=require('../server/dataMapHandoffControl');
const reader=require('../server/dataMapEffectiveReader');
const {digest}=require('../server/dataMapDefinitionValues');
const checks=[];
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){
  const calls=[];
  const db={execute:async(sql)=>{calls.push(sql);return [[{cutover_state:'controlled',cutover_epoch:'0',graph_revision:'0',next_definition_version_id:'1',contract_version:control.CONTRACT_VERSION}]];}};
  await check('missing marker fails closed',()=>assert.rejects(control.assertLegacyWriteAllowed({execute:async()=>[[]]}),{code:'HANDOFF_CONTROL_UNAVAILABLE',statusCode:503}));
  await check('missing control table fails closed without env fallback',()=>assert.rejects(control.assertLegacyWriteAllowed({execute:async()=>{throw Object.assign(new Error('synthetic'),{code:'ER_NO_SUCH_TABLE'});}}),{code:'HANDOFF_CONTROL_UNAVAILABLE'}));
  for(const state of ['legacy','prepared','controlled'])await check('legacy writes stay sealed in '+state,()=>assert.rejects(control.assertLegacyWriteAllowed({execute:async()=>[[{cutover_state:state,cutover_epoch:'0',graph_revision:'0',next_definition_version_id:'1',contract_version:control.CONTRACT_VERSION}]]}),{code:'HANDOFF_REQUIRED',statusCode:409}));
  const repo=require('../server/dataMapMysqlRepository').makeDataMapMysqlRepository(db);
  for(const method of ['createContext','updateContext','createField','updateField','deleteField','upsertFieldIdentity','confirmFieldIdentity','recordImportBatch'])await check('direct '+method+' refuses before data mutation',async()=>{calls.length=0;await assert.rejects(repo[method](),{code:'HANDOFF_REQUIRED'});assert.ok(calls.every(sql=>sql.startsWith('SELECT cutover_state')));});
  await check('old definition allocator sealed',()=>assert.rejects(require('../server/dataMapDefinitionValues').insertVersion(db,{}),{code:'HANDOFF_REQUIRED'}));
  await check('old migration cannot autoincrement versions',()=>assert.rejects(require('../server/dataMapDefinitionMigration').applyDefinitions(db),{code:'HANDOFF_REQUIRED'}));
  await check('disabled graph adapters refuse before graph lock',()=>assert.rejects(control.assertGraphWriteEnabled(db,{}),{code:'HANDOFF_DISABLED'}));
  await check('read only graph adapters refuse',()=>assert.rejects(control.assertGraphWriteEnabled(db,{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'1'}),{code:'HANDOFF_READ_ONLY'}));
  await check('unversioned old current client requests upgrade',()=>assert.rejects(repo.getField('1'),{code:'HANDOFF_CLIENT_UPGRADE_REQUIRED'}));
  await check('explicit unavailable current does not consult old heads',async()=>{const seen=[];const missing={execute:async sql=>{seen.push(sql);return sql.includes('governance_control')?db.execute(sql):[[]];}};const value=await reader.readDefinition(missing,{entityType:'object',entityId:'9007199254740993',view:'current'});assert.equal(value.availability,'unavailable');assert.equal(value.entity_id,'9007199254740993');assert.ok(seen.every(sql=>!sql.includes('data_map_definition_heads')&&!sql.includes('data_map_objects')));});
  await check('manifest membership rejects item-only tampering',()=>{const item={item_ref:'one',target_kind:'object',target_id:'1',target_version_ref:'2',operation:'create',produces_version:true,payload:{definition:{name:'fixed'}},source_detail_versions:['detail']};const manifest={schema_version:'data-map-publication-v1',scope_mode:'current',items:[item]};const row={...item,produces_version:1,manifest_json:manifest,manifest_digest:digest(manifest),payload_json:item.payload,source_detail_versions_json:item.source_detail_versions};reader.verifiedItem(row);assert.throws(()=>reader.verifiedItem({...row,payload_json:{definition:{name:'tampered'}}}),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});});
  await check('historical conflict fields use fixed context and never mutable field joins',async()=>{
    const snapshot={field_name_a:'原字段甲',field_name_b:'原字段乙'},queries=[];
    const fixture={execute:async sql=>{queries.push(sql);if(sql.includes('data_map_legacy_registry'))return [[{snapshot_json:snapshot,snapshot_digest:digest(snapshot),history_completeness:'recorded_at_creation'}]];return [[{id:1,field_id_a:2,field_id_b:3,dept_a:91,dept_b:92}]];}};
    const items=await require('../server/conflictMysqlRepository').makeConflictMysqlRepository(fixture).listConflicts({type:'field'},{mode:'global'});
    assert.equal(items[0].field_name_a,'原字段甲');assert.equal(items[0].history_context_status,'fixed_recorded_snapshot');assert.ok(queries.every(sql=>!sql.includes('JOIN data_map_fields')));
  });
  await check('todo context with missing history is explicitly unknown without current fallback',async()=>{
    const queries=[],fixture={execute:async sql=>{queries.push(sql);return sql.includes('data_map_legacy_registry')?[[]]:[[{id:1,related_field_id:2}]];}};
    const items=await require('../server/todoMysqlRepository').makeTodoMysqlRepository(fixture).listTodos({includeFieldContext:true},{mode:'global'});
    assert.equal(items[0].a1_code,null);assert.equal(items[0].history_context_status,'unknown');assert.ok(queries.every(sql=>!sql.includes('JOIN data_map_fields')));
  });
  console.log('HANDOFF_BOUNDARIES_PASSED '+checks.length);
  return checks;
}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
module.exports={main};
