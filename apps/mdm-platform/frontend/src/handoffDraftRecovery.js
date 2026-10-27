import {handoffRoot,handoffOwner,observeHandoffReceipt} from './dataMapHandoffRequest.js';

export function sameHandoffPersonAccountDepartment(draft, currentOwner) {
  try {
    const previous=JSON.parse(draft?.owner),current=JSON.parse(currentOwner);
    const valid=parts=>Array.isArray(parts)&&parts.length===4&&parts.every(value=>typeof value==='string'&&/^[1-9]\d*$/.test(value));
    return valid(previous)&&valid(current)&&[0,1,3].every(index=>previous[index]===current[index]);
  } catch { return false; }
}

// A newer authorization version must pass a fresh scoped read before an explicit
// local recovery. Stored input and any frozen request are never rewritten/replayed.
export async function verifyHandoffDraftRecovery(api,draft,currentOwner,{signal}={}) {
  if (!sameHandoffPersonAccountDepartment(draft,currentOwner)) throw new Error('请使用原人员、账号和部门核对保留的输入。');
  const selected=draft.selection,id=encodeURIComponent(selected?.id||'');
  if(!id)throw new Error('原办理事项未记录，请联系维护人员核对。');
  const paths={fact:`${handoffRoot}/facts/${id}/current`,conflict:`${handoffRoot}/conflicts/${id}`,publication:`${handoffRoot}/publications/${id}`,handoff:`${handoffRoot}/${id}${selected?.revision?'/revisions/'+encodeURIComponent(selected.revision):''}`,package:`${handoffRoot}/work-packages/${id}/trace`};
  const target=paths[selected.kind];if(!target)throw new Error('原办理事项无法识别，请保留输入并联系维护人员核对。');
  const identity=await api.request('/api/org/me',{signal});
  if(handoffOwner(identity)!==currentOwner)throw new Error('当前身份已变化，请重新登录后核对。');
  await api.request(handoffRoot+'/workbench',{signal});
  await api.request(target,{signal});
  const verified=draft.request?observeHandoffReceipt(draft,await api.request(`${handoffRoot}/requests/${encodeURIComponent(draft.request.request_id)}`,{signal})):draft;
  if(signal?.aborted)throw new Error('当前身份已变化，请重新核对。');
  return {...verified,owner:currentOwner};
}
