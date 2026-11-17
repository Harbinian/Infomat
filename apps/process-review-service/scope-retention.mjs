import {bindReviewRound} from './review-round.mjs';

/** Select an explicitly authorized operational scope without rewriting surviving records. */
export function retainRoundRecords(state,audit,round){
  const bound=bindReviewRound(state,{...round,retainOnly:false}),keepMaterials=new Set(bound.materialIds);
  if(state.jointReviews?.length&&state.materials.some(item=>!keepMaterials.has(item.id)))throw new Error('已有连续联合评审事项；范围缩减须另行核对完整事项、通过包及审计引用，原数据保留');
  const allObjects=new Set(state.materials.map(item=>item.id));
  const keptObjects=new Set(keepMaterials);
  const classify=(ids,label)=>{
    const known=ids.filter(id=>allObjects.has(id));
    const retained=known.filter(id=>keptObjects.has(id));
    if(retained.length&&retained.length!==known.length)throw new Error(`记录同时关联本轮与移出对象，须明确处理：${label}`);
    return !known.length||retained.length===known.length;
  };
  const next=structuredClone(state);
  next.materials=state.materials.filter(item=>keepMaterials.has(item.id));
  for(const item of next.materials)if(item.predecessorId&&!keepMaterials.has(item.predecessorId))throw new Error('本轮材料仍关联待移出的前版，须明确处理');
  for(const key of ['opinions','issues','observations','batches']){
    for(const item of state[key])allObjects.add(item.id);
  }
  next.batches=state.batches.filter(item=>classify(item.materialIds||[],item.id));
  for(const item of next.batches){
    if(Object.keys(item.coverage||{}).some(id=>!keepMaterials.has(id))||(item.presenter?.materialId&&!keepMaterials.has(item.presenter.materialId)))throw new Error('批次仍有移出对象的走查或投屏引用');
    keptObjects.add(item.id);
  }
  next.opinions=state.opinions.filter(item=>keepMaterials.has(item.materialId));
  for(const item of next.opinions){
    if(item.batchId&&!keptObjects.has(item.batchId))throw new Error('保留意见的原批次不在保留范围内');
    keptObjects.add(item.id);
  }
  next.issues=state.issues.filter(item=>classify(item.materialIds||[],item.id));
  for(const item of next.issues){
    if((item.opinionIds||[]).some(id=>!keptObjects.has(id)))throw new Error('保留问题仍引用移出的意见');
    keptObjects.add(item.id);
  }
  next.observations=state.observations.filter(item=>classify([...(item.materialIds||[]),...(item.issueIds||[])],item.id));
  for(const item of next.observations)keptObjects.add(item.id);
  const referencedIds=value=>{
    if(typeof value==='string')return allObjects.has(value)?[value]:[];
    if(Array.isArray(value))return value.flatMap(referencedIds);
    if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>[...(allObjects.has(key)?[key]:[]),...referencedIds(item)]);
    return [];
  };
  const keptAudit=audit.filter(item=>classify(referencedIds(item.detail),`audit:${item.sequence}`));
  delete next.audit;
  next.revision=state.revision+1;
  return {state:next,audit:keptAudit,summary:{materials:{before:state.materials.length,retained:next.materials.length,archived:state.materials.length-next.materials.length},
    ...Object.fromEntries(['opinions','issues','observations','batches'].map(key=>[key,{before:state[key].length,retained:next[key].length,archived:state[key].length-next[key].length}])),
    audit:{before:audit.length,retained:keptAudit.length,archived:audit.length-keptAudit.length}}};
}
