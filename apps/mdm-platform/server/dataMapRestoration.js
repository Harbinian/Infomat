// Restoration provenance is minted only by the explicit publication endpoint.
// All reads use the caller's transaction; no pool, migration or implicit publication.
const {failure,uuid,id,digest,parse,snapshot}=require('./dataMapHandoffPolicy');
const {inspectPublication}=require('./dataMapPublicationLifecycle');
const text=value=>typeof value==='string'&&value.trim().length>0;
function content(item,origin,itemMappings){
  const definition=structuredClone(item.payload.definition);
  const mapped=version=>{const source=origin.items.find(x=>x.target_version_ref===version);return itemMappings.find(x=>x.source_item_ref===source?.item_ref)?.target_item_ref||null;};
  if(item.target_kind==='object')for(const group of definition.unique_identifiers||[])if(group.field_version_ids){
    const refs=group.field_version_ids.map(mapped);if(refs.some(x=>!x))return null;
    delete group.field_version_ids;group.field_item_refs=refs;
  }
  const refs={};for(const [field,version]of [['object_ref',item.payload.object_version_id],['context_ref',item.payload.context_version_ref],['data_element_ref',item.payload.data_element_version_ref]])if(version){refs[field]=mapped(version);if(!refs[field])return null;}
  return {definition,authority:(item.payload.authority||[]).map(({basis,evidence_refs,...a})=>a),...refs};
}
function proposed(item){return {definition:item.definition,authority:(item.authority||[]).map(({basis,evidence_refs,...a})=>a),...Object.fromEntries(['object_ref','context_ref','data_element_ref'].filter(k=>item[k]).map(k=>[k,item[k]]))};}
function mapping(body,origin){
  const lineage=body.restoration;
  if(!lineage||Array.isArray(lineage)||Object.keys(lineage).some(k=>!['source_publication_id','source_manifest_digest','source_event_revision','target_package_id','scope_mode','basis','evidence_refs','item_mappings'].includes(k))
    ||uuid(lineage.source_publication_id)!==origin.publication_id||lineage.source_manifest_digest!==origin.publication.manifest_digest
    ||lineage.source_event_revision!==origin.event_revision||!text(lineage.basis)||!Array.isArray(lineage.evidence_refs)||!lineage.evidence_refs.length||!lineage.evidence_refs.every(text)
    ||lineage.scope_mode!==body.scope_mode||!Array.isArray(lineage.item_mappings)||lineage.item_mappings.length!==origin.items.length)throw failure('HANDOFF_RESTORATION_INVALID',422);
  const sources=new Set(),targets=new Set();
  const adjustments=body.restoration_adjustments||[];const adjustmentTargets=new Set();
  for(const entry of adjustments){
    if(!entry||Object.keys(entry).some(k=>!['target_item_ref','basis','evidence_refs'].includes(k))||adjustmentTargets.has(entry.target_item_ref)||!lineage.item_mappings.some(x=>x.target_item_ref===entry.target_item_ref)
      ||!text(entry.basis)||!Array.isArray(entry.evidence_refs)||!entry.evidence_refs.length||!entry.evidence_refs.every(text))throw failure('HANDOFF_RESTORATION_ADJUSTMENT_INVALID',422);
    adjustmentTargets.add(entry.target_item_ref);
  }
  for(const entry of lineage.item_mappings){
    if(!entry||Object.keys(entry).some(k=>!['source_item_ref','target_item_ref','content_decision','basis','evidence_refs','source_content_digest','initial_content_digest'].includes(k))||sources.has(entry.source_item_ref)||targets.has(entry.target_item_ref)
      ||!['adopt','adapt'].includes(entry.content_decision)||!text(entry.basis)||!Array.isArray(entry.evidence_refs)||!entry.evidence_refs.length||!entry.evidence_refs.every(text))throw failure('HANDOFF_RESTORATION_MAPPING_INVALID',422);
    const source=origin.items.find(x=>x.item_ref===entry.source_item_ref),target=body.items.find(x=>x.item_ref===entry.target_item_ref);
    if(!source||!target||source.target_kind!==target.target_kind)throw failure('HANDOFF_RESTORATION_MAPPING_INVALID',422);
    if(source.produces_version&&target.operation==='reuse')throw failure('HANDOFF_RESTORATION_NEW_VERSION_REQUIRED',422);
    if(['object','field','data_element'].includes(target.target_kind)&&target.operation==='modify'&&String(target.target_id)!==source.target_id)throw failure('HANDOFF_RESTORATION_IDENTITY_MISMATCH',422);
    if(target.operation==='reuse'&&(String(target.target_id)!==source.target_id||target.target_version_ref!==source.target_version_ref))throw failure('HANDOFF_RESTORATION_IDENTITY_MISMATCH',422);
    const original=content(source,origin,lineage.item_mappings);
    if(entry.source_content_digest!==digest(source.payload))throw failure('HANDOFF_RESTORATION_MAPPING_INVALID',422);
    const changed=entry.content_decision==='adopt'?(!original||digest(original)!==digest(proposed(target))):entry.initial_content_digest!==digest(proposed(target));
    if(changed&&!adjustmentTargets.has(target.item_ref))throw failure('HANDOFF_RESTORATION_CONTENT_CHANGED',422,{item_ref:target.item_ref});
    sources.add(entry.source_item_ref);targets.add(entry.target_item_ref);
  }
  return lineage;
}
function create(body,origin,{targetPackageId,basis,evidenceRefs,itemMappings}){
  if(body?.restores_publication_id||body?.restoration||body?.restoration_adjustments)throw failure('HANDOFF_RESTORATION_PROVENANCE_IMMUTABLE',409);
  if(origin.state!=='withdrawn')throw failure('HANDOFF_PUBLICATION_NOT_WITHDRAWN',409);
  const next=snapshot({...body,restores_publication_id:origin.publication_id,restoration:{source_publication_id:origin.publication_id,
    source_manifest_digest:origin.publication.manifest_digest,source_event_revision:origin.event_revision,target_package_id:id(targetPackageId),
    scope_mode:body.scope_mode,basis,evidence_refs:evidenceRefs,item_mappings:Array.isArray(itemMappings)?itemMappings.map(entry=>{
      if(!entry||Object.keys(entry).some(k=>!['source_item_ref','target_item_ref','content_decision','basis','evidence_refs'].includes(k)))throw failure('HANDOFF_RESTORATION_MAPPING_INVALID',422);
      const source=origin.items.find(x=>x.item_ref===entry.source_item_ref),target=body.items.find(x=>x.item_ref===entry.target_item_ref);
      if(!source||!target)throw failure('HANDOFF_RESTORATION_MAPPING_INVALID',422);
      return {...entry,source_content_digest:digest(source.payload),initial_content_digest:digest(proposed(target))};
    }):itemMappings}});
  mapping(next,origin);return next;
}
function preserve(previous,next){
  const old=previous.restoration||null,current=next.restoration||null;
  if((previous.restores_publication_id||null)!==(next.restores_publication_id||null)||digest(old)!==digest(current))throw failure('HANDOFF_RESTORATION_PROVENANCE_IMMUTABLE',409);
}
async function validate(db,body,{packageId,handoffId=null,requireEvent=false}){
  if(!body.restores_publication_id&&!body.restoration)return null;
  if(!body.restores_publication_id||!body.restoration)throw failure('HANDOFF_RESTORATION_INVALID',422);
  const origin=await inspectPublication(db,uuid(body.restores_publication_id));
  if(origin.state!=='withdrawn')throw failure('HANDOFF_PUBLICATION_NOT_WITHDRAWN',409);
  const lineage=mapping(body,origin);
  if(id(lineage.target_package_id)!==String(packageId))throw failure('HANDOFF_RESTORATION_TARGET_MISMATCH',409);
  if(requireEvent){
    const [events]=await db.execute("SELECT payload_json FROM data_map_handoff_events WHERE handoff_id=? AND event_type='restoration_created' FOR SHARE",[handoffId]);
    if(!events.some(e=>digest(parse(e.payload_json).restoration)===digest(lineage)))throw failure('HANDOFF_RESTORATION_PROVENANCE_MISSING',409);
  }
  return {source_publication_id:origin.publication_id,source_event_revision:origin.event_revision,source_manifest_digest:origin.publication.manifest_digest,
    target_package_id:String(packageId),scope_mode:body.scope_mode,lineage_digest:digest(lineage)};
}
module.exports={create,preserve,validate};
