import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

/** A checked source inventory controls browsing scope, never approval or material identity. */
export function loadReviewRound(file) {
  if (!file) return null;
  const bytes=readFileSync(file),catalog=JSON.parse(bytes.toString('utf8'));
  if(catalog.format!=='review-material-round-v1'||!catalog.label||!catalog.sourceRoot||!catalog.capturedAt||!Array.isArray(catalog.files)||
    catalog.files.some(item=>!item.sourcePath||!item.relativePath||!item.department||!/^[a-f0-9]{64}$/.test(item.sha256))||
    new Set(catalog.files.map(item=>item.sourcePath)).size!==catalog.files.length)throw new Error('Invalid review round inventory');
  return {...catalog,digest:createHash('sha256').update(bytes).digest('hex')};
}

export function bindReviewRound(state,round) {
  if(!round)return null;
  const normalize=value=>value.replaceAll('\\','/');
  const entries=round.files.map(file=>{
    const candidates=state.materials.filter(item=>item.sha256===file.sha256);
    const exact=candidates.filter(item=>normalize(item.sourcePath)===normalize(file.sourcePath));
    const sameRound=candidates.filter(item=>normalize(item.sourcePath).startsWith(normalize(round.sourceRoot)+'/'));
    const material=exact.length===1?exact[0]:sameRound.length===1?sameRound[0]:candidates.length===1?candidates[0]:null;
    if(!material)throw new Error(`本轮材料尚未导入或快照匹配不唯一：${file.relativePath}`);
    if(material.sourceDepartment&&material.sourceDepartment!==file.department)throw new Error(`本轮提交部门与原快照不一致：${file.relativePath}`);
    return {...file,materialId:material.id};
  });
  if(new Set(entries.map(item=>item.materialId)).size!==entries.length)throw new Error('本轮多个文件匹配同一快照，请逐份核对来源');
  if(round.retainOnly&&state.materials.length!==entries.length)throw new Error('运行库包含本轮清单之外的材料，请先按已授权范围整理');
  return {label:round.label,sourceRoot:round.sourceRoot,capturedAt:round.capturedAt,digest:round.digest,retainOnly:Boolean(round.retainOnly),entries,
    materialIds:entries.map(item=>item.materialId),supportingFiles:round.supportingFiles||[],
    currentCount:entries.length,historyCount:state.materials.length-entries.length,
    departments:[...new Set(entries.map(item=>item.department))].sort().map(department=>({department,count:entries.filter(item=>item.department===department).length}))};
}

export function withReviewRound(state,round) {
  const reviewRound=bindReviewRound(state,round);
  if(!reviewRound)return {...state,reviewRound:null};
  const sources=new Map(reviewRound.entries.map(item=>[item.materialId,item]));
  return {...state,reviewRound,materials:state.materials.map(item=>({...item,currentSource:sources.get(item.id)||null}))};
}
