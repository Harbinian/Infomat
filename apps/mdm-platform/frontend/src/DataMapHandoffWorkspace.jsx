import {publicationChoices} from './businessPresentation.js';
import {publicationEntryName,handoffDraftEntryName} from './handoffPublicationPresentation.js';
import {BusinessCatalogProvider,BusinessSelect} from "./BusinessDetails.jsx";
import {GovernanceDetails as BusinessDetails} from "./GovernanceDetails.jsx";
import {businessDateTime} from "./businessGuidance.js";
import {bindingDetailDisplay,handoffReviewBindingSelection,handoffRequestNotice,handoffSourceBinding,governanceDetailName,governanceDetailType,historicalGovernanceActor,fixedSourceName,restorationLinkName,canReadDataMap,tracePublications} from "./handoffGovernancePresentation.js";
import {businessChoice,businessName,businessStatus,userMessage} from "./businessPresentation.js";
import React,{useCallback,useEffect,useRef,useState} from 'react';
import HandoffDraftEditor,{HandoffInput,handoffKinds} from './HandoffDraftEditor.jsx';
import PackagePanel from './DataMapHandoffPackagePanel.jsx';
import {handoffReceiptGuide,handoffResultGuide} from './handoffPackagePresentation.js';
import HandoffConflictPanel,{HandoffFactPanel} from './HandoffConflictPanel.jsx';
import HandoffUpgradePanel from './HandoffSourceUpgradePanel.jsx';
import HandoffPublicationPanel from './HandoffPublicationPanel.jsx';
import {cloneHandoffValue,editHandoffDraft,freezeHandoffRequest,handoffActionAllowed,handoffCanRetry,handoffDraftBlocked,handoffDraftForOwner,handoffLines,handoffOwner,handoffRequestUnresolved,handoffResultMatchesResource,handoffRoot,handoffStateName,observeHandoffReceipt,sourceKeyForHandoff} from './dataMapHandoffRequest.js';
import './data-map-handoff.css';
import {handoffReturnLabel,handoffWorkspaceHref,parseHandoffSelection,safeHandoffReturn,sameHandoffSelection} from './handoffNavigation.js';

const validKinds=['package','handoff','conflict','fact','publication'];
function initialSelection(draft){
  if(draft?.selection)return draft.selection;
  return parseHandoffSelection(location.search);
}
function Stamp(){return null;}
function Values({value}){return <BusinessDetails value={value}/>;}
export function Report({report,revisionId,onNavigate}){
 if(!report)return null;
 const terminologyMessages={
  TERMINOLOGY_REVIEW_REQUIRED:'本草案尚未保存人工术语核对结果。请核对关键概念及采用依据；没有适用词条时，也须说明已核对的范围和依据。',
  TERMINOLOGY_SOURCE_CHANGED:'本草案内容已变化，请重新核对受影响的用词位置并保存本次判断。',
  TERMINOLOGY_TERM_CHANGED:'采用的词条内容或可用状态已变化，请重新核对该处引用。',
  TERMINOLOGY_SUBSTANTIVE_CONFLICT:'已人工确认存在同一语境下的含义冲突，请先处理该处业务含义，再重新核对术语引用。',
  TERMINOLOGY_CANONICAL_NAME_REQUIRED:'已确认属于同义用词，请回到草案编辑核对规范名称，再重新核对引用。',
  TERMINOLOGY_DEPARTMENT_CONFIRMATION_REQUIRED:'本次术语核对仍需相应部门当前负责人本人确认，请按术语核对页面的可办操作继续。',
  TERMINOLOGY_DEPARTMENT_CONFIRMATION_STALE:'原部门负责人确认已不能代表当前办理资格，请按术语核对页面的当前资格重新确认。'
 };
 const issueMessage=item=>{
  const code=typeof item==='string'?item.split(':',1)[0]:item?.code;
  if(typeof code==='string'&&code.startsWith('TERMINOLOGY_'))return Object.hasOwn(terminologyMessages,code)?terminologyMessages[code]:'本草案术语引用仍有需核对项，请打开术语核对查看具体业务原因。';
  return userMessage(item,'此项需要核对，请联系维护人员查看具体原因。');
 };
 let terminologyUrl=null;
 const supplied=report.terminology_review_url;
 if(typeof supplied==='string'&&supplied.length<=2048&&supplied.startsWith('/app/terms?')&&!/[\\#\u0000-\u0020]/.test(supplied)){
  try{
   const parsed=new URL(supplied,'https://local.invalid'),query=parsed.searchParams;
   const exactKeys=[...query.keys()].length===2&&query.getAll('target_type').length===1&&query.getAll('target_id').length===1;
   const targetId=query.get('target_id');
   if(parsed.origin==='https://local.invalid'&&parsed.pathname==='/app/terms'&&exactKeys&&query.get('target_type')==='handoff_revision'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(targetId||'')&&typeof revisionId==='string'&&targetId===revisionId)terminologyUrl=parsed.pathname+parsed.search;
  }catch{}
 }
 const needsTerminology=report.gates?.some(g=>g.issues?.some(item=>(typeof item==='string'?item:item?.code||'').startsWith('TERMINOLOGY_')));
 return <section className="handoff-gates" aria-label="发布条件"><h3>本次发布条件检查</h3><ol>{report.gates?.map(g=><li key={g.gate}><strong>{businessStatus(g.status)}</strong>{g.issues?.length>0&&<ul>{g.issues.map((item,index)=><li key={index}>{issueMessage(item)}</li>)}</ul>}</li>)}</ol>
  {(terminologyUrl||needsTerminology)&&<section className="handoff-evidence" aria-label="本草案术语核对"><h4>本草案术语核对</h4><p>由MDM工作组组长或本工作包已分派的MDM治理经办人核对本草案用词，实际可办操作以术语核对页面的当前资格为准。</p>{terminologyUrl?<><a href={terminologyUrl} onClick={onNavigate}>核对本草案术语引用</a><p>打开后点击“记录术语引用判断”，核对具体用词、定义及依据，再点击“保存人工核对结果”；没有需要逐条引用的概念时，填写整体核对说明后保存。</p><p>保存后使用浏览器“返回”回到本草案，点击“查看最新记录”，再点击“执行本次检查”。术语核对不会代为批准或发布本草案。</p></>:<p>当前未提供与本草案准确对应的术语核对入口。请先点击“查看最新记录”；仍无法打开时，请由维护人员核对本草案的入口关联，原输入保持。</p>}</section>}
  <p>{report.ready_for_approval?'检查条件已满足，请批准本次草案后再发布。':'请先解决上方问题，再重新检查。'}</p></section>;
}
function Trace({trace,select,publications=[]}){
 if(!trace)return null;
 const fixedPublications=tracePublications(trace);
 return <details className="card handoff-trace"><summary>来源材料、审核及办理历史</summary>
   <h3>{fixedSourceName(trace.source)}</h3><p>来源状态：{businessStatus(trace.source?.status)}。历史内容供查阅，能否再次使用须另行核对。</p>
   <h3>审核记录</h3>{trace.bindings?.map(row=><div className="handoff-row-card" key={row.binding_id}><p>{fixedSourceName(trace.source)} · {businessDateTime(row.created_at)}</p><ul>{bindingDetailDisplay(trace,row).map(detail=><li key={detail.detail_version_id}>{governanceDetailName(detail)} · {businessStatus(detail.status)}</li>)}</ul><BusinessDetails value={row.snapshot_json}/></div>)}
   <h3>已保存的草稿内容</h3>{trace.revisions?.map(row=><div key={row.revision_id} className="handoff-row-card"><button type="button" className="text-button" data-handoff-id={row.handoff_id} data-revision={row.revision_no} onClick={()=>select({kind:'handoff',id:row.handoff_id,revision:Number(row.revision_no)})}>查看历史草稿 · {fixedSourceName(trace.source)} · {businessDateTime(row.created_at)}</button><BusinessDetails value={row.snapshot_json}/></div>)}
   <h3>批准记录</h3>{trace.approvals?.map(row=><div className="handoff-row-card" key={row.approval_id}><p>{businessStatus(row.decision)} · {row.basis} · {businessDateTime(row.created_at)}</p><p>批准人：{historicalGovernanceActor(row.actor_snapshot||row.actor_json)}</p></div>)}
   <h3>发布与恢复记录</h3>{trace.publications?.map(row=><p key={row.publication_id}><button type="button" className="text-button" onClick={()=>select({kind:'publication',id:row.publication_id})}>{publicationEntryName(publications.find(publication=>publication.publication_id===row.publication_id)||fixedPublications.find(publication=>publication.publication_id===row.publication_id))} · {fixedSourceName(trace.source)}</button> · {businessStatus(row.scope_mode)} · {businessDateTime(row.published_at)}</p>)}
   {trace.restoration_links?.map(row=><p key={row.revision_id}><button type="button" className="text-button" onClick={()=>select({kind:'handoff',id:row.handoff_id,revision:Number(row.revision_no)})}>查看{restorationLinkName(row)}</button></p>)}
   <details><summary>操作记录</summary>{trace.events?.map(row=><div className="handoff-row-card" key={row.event_id}><p>{businessDateTime(row.created_at)} · {historicalGovernanceActor(row.payload_json?.actor_snapshot||row.actor_json)}</p><BusinessDetails value={row.payload_json}/></div>)}</details></details>;
}

export function DataMapHandoffWorkspace({api:apiClient,user,draft,setDraft,onQueryChange,onNavigate}){
  const owner=handoffOwner(user),ownDraft=handoffDraftForOwner(draft,owner),blocked=handoffDraftBlocked(draft,owner);
  const requestedSelection=parseHandoffSelection(location.search);
  const returnTo=safeHandoffReturn(new URLSearchParams(location.search).get('return_to'))||'/app/workbench';
  const [deferredSelection,setDeferredSelection]=useState(()=>ownDraft?.selection&&requestedSelection&&!sameHandoffSelection(ownDraft.selection,requestedSelection)?requestedSelection:null);
  const [selection,setSelection]=useState(()=>initialSelection(ownDraft)),[bench,setBench]=useState(null),[resource,setResource]=useState(null),[trace,setTrace]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState(''),[version,setVersion]=useState(0);
  const epoch=useRef(0),mounted=useRef(true),currentDraft=useRef(draft),currentResource=useRef(resource),currentPolicy=useRef(null),active=useRef(null),composing=useRef(false);
  currentDraft.current=draft;currentResource.current=resource;
  function updateDraft(next){const value=typeof next==="function"?next(currentDraft.current):next;currentDraft.current=value;setDraft(value);}
  const api=useCallback((path,options)=>apiClient.request(path,options),[apiClient]);
  useEffect(()=>()=>{mounted.current=false;active.current?.abort();++epoch.current;},[]);
  const refresh=()=>setVersion(x=>x+1);
  useEffect(()=>{
    const generation=++epoch.current,controller=new AbortController();active.current?.abort();active.current=controller;
    const valid=()=>mounted.current&&epoch.current===generation&&!controller.signal.aborted;
    setBusy(true);setError(null);setResource(null);setTrace(null);
    (async()=>{
      const workbench=await api(handoffRoot+'/workbench',{signal:controller.signal});if(!valid())return;setBench(workbench);
      if(!selection)return;
      if(!validKinds.includes(selection.kind))throw new Error('承接入口类型无效。');
      const id=encodeURIComponent(selection.id);let next,history;
      if(selection.kind==='fact')next=await api(`${handoffRoot}/facts/${id}/current`,{signal:controller.signal});
      else if(selection.kind==='conflict')next=await api(`${handoffRoot}/conflicts/${id}`,{signal:controller.signal});
      else if(selection.kind==='publication'){next=await api(`${handoffRoot}/publications/${id}`,{signal:controller.signal});history=await api(`${handoffRoot}/publications/${id}/trace`,{signal:controller.signal});}
      else if(selection.kind==='handoff'){next=await api(`${handoffRoot}/${id}${selection.revision?'/revisions/'+selection.revision:''}`,{signal:controller.signal});history=await api(`${handoffRoot}/work-packages/${encodeURIComponent(next.header.package_id)}/trace`,{signal:controller.signal});}
      else{history=await api(`${handoffRoot}/work-packages/${id}/trace`,{signal:controller.signal});next={...workbench.packages?.find(p=>String(p.package_id)===String(selection.id)),package_id:String(selection.id)};}
      if(!valid())return;setResource(next);setTrace(history||null);
    })().catch(e=>{if(valid()&&e.name!=='AbortError')setError(e);}).finally(()=>{if(valid())setBusy(false);});
    return()=>controller.abort();
  },[api,owner,selection?.kind,selection?.id,selection?.revision,version]);
  const [referenceChoices,setReferenceChoices]=useState({objects:[],fields:[],versions:[],fieldVersions:[],publications:[]});
  const referenceReadKey=JSON.stringify([owner,bench?.packages?.flatMap(row=>(row.publications||[]).map(item=>item.publication_id)),ownDraft?.kind,version]);
  useEffect(()=>{
    const controller=new AbortController();setReferenceChoices({objects:[],fields:[],versions:[],fieldVersions:[],publications:[]});
    const ids=[...new Set((bench?.packages||[]).flatMap(row=>(row.publications||[]).map(item=>item.publication_id)))];
    Promise.allSettled(ids.map(id=>api(handoffRoot+'/publications/'+encodeURIComponent(id),{signal:controller.signal}))).then(rows=>{if(!controller.signal.aborted){const publications=rows.filter(row=>row.status==='fulfilled').map(row=>row.value);setReferenceChoices({...publicationChoices(publications),publications,incomplete:rows.some(row=>row.status==='rejected')});}});
    return()=>controller.abort();
  },[api,referenceReadKey]);
  const sourceKey=sourceKeyForHandoff(selection,resource)+(selection?.kind==='package'?JSON.stringify([resource?.binding_id,trace?.intakes?.map(x=>[x.intake_id,x.current_revision]),trace?.corrections?.map(x=>[x.correction_id,x.current_revision])]):'');
  const capabilities=bench?.capabilities||{},selectedPackageId=resource?.header?.package_id||resource?.package_id,actions=bench?.packages?.find(p=>String(p.package_id)===String(selectedPackageId))?.allowed_actions||[],canPrepare=actions.includes('prepare')&&(!resource?.revision?.revision_no||Number(resource.revision.revision_no)===Number(resource.header?.current_revision)),canReview=actions.includes('review'),options=bench?.options||{};
  currentPolicy.current={selection,resource,capabilities,packageActions:actions};
  const writable=kind=>handoffActionAllowed({...currentPolicy.current,kind});
  const actionRevoked=Boolean(ownDraft&&!writable(ownDraft.kind)),stale=Boolean(ownDraft&&resource&&ownDraft.sourceKey!==sourceKey),frozen=handoffRequestUnresolved(ownDraft),disabled=stale||frozen||blocked||actionRevoked;
  function discard(){if(composing.current){setNotice('请先完成当前输入法组字，再切换或结束本次办理。');return false;}const d=currentDraft.current;if(d&&handoffRequestUnresolved(d)){setNotice('本次办理结果尚未确认，请先核对结果并明确确认，再结束本次输入。');return false;}if(d&&!window.confirm('明确放弃本次尚未提交的输入？已保存的记录不受影响。'))return false;updateDraft(null);return true;}
  function select(next){const url=handoffWorkspaceHref(next,returnTo);if(!url)return;if(sameHandoffSelection(selection,next))return;if(!discard())return;setDeferredSelection(null);setNotice('');setError(null);setResource(null);setTrace(null);setBusy(true);const selected={kind:next.kind,id:String(next.id),...(Number.isSafeInteger(next.revision)&&next.revision>0?{revision:next.revision}:{})};setSelection(selected);if(onQueryChange)onQueryChange(url,false);else history.replaceState(history.state,'',url);}
  function begin(kind,values,key=sourceKey){if(blocked||busy||!resource)return false;if(!writable(kind)){setNotice('当前已不能办理此事项。请查看最新记录，核对本人的办理资格。');return false;}if(!discard())return false;setNotice('');updateDraft({kind,sessionId:crypto.randomUUID(),values:cloneHandoffValue(values),owner,selection:cloneHandoffValue(selection),sourceKey,formSourceKey:key,dirty:true,request:null,
    expected_revision:Number(resource.header?.current_revision??resource.revision??resource.event_revision??0),
    expected_handoff_revision:Number(resource.header?.current_revision??resource.current_handoff_revision??resource.expected_handoff_revision??0),
    expected_conflict_revision:resource.expected_conflict_revision,expected_parent_revision:resource.expected_parent_revision,
    answered_fact_version_id:resource.fact_version_id,answered_snapshot_digest:resource.snapshot_digest});return true;}
  const editSessionId=ownDraft?.sessionId;
  function edit(key,value){updateDraft(previous=>previous?.owner===owner&&previous.sessionId===editSessionId&&writable(previous.kind)?editHandoffDraft(previous,key,value):previous);}
  async function sendFrozen(fixed){
    setBusy(true);setError(null);setNotice('本次提交的内容已固定保留。请先核对本次办理结果，结果未确认前不要重复发起同一事项。');
    const mark=epoch.current;
    try{const result=await api(fixed.request.url,{method:fixed.request.method,body:fixed.request.body});if(!mounted.current||mark!==epoch.current)return null;
      updateDraft(previous=>previous?.owner===owner&&previous.request?.request_id===fixed.request.request_id?observeHandoffReceipt(previous,{request_id:fixed.request.request_id,state:'committed',result}):previous);setNotice('本次办理已有完成记录。请查看下方结果并点击“确认本次办理结果”；输入仍保留。');refresh();return result;
    }catch(e){if(mounted.current&&mark===epoch.current){setError(e);updateDraft(previous=>previous?.owner===owner&&previous.request?.request_id===fixed.request.request_id?{...previous,request:{...previous.request,phase:'awaiting_receipt'}}:previous);}return null;}
    finally{if(mounted.current)setBusy(false);}
  }
  async function execute(write){
    if(composing.current){setNotice('请先完成当前输入法组字，再提交本次办理。');return null;}if(busy||blocked||!ownDraft||currentDraft.current?.sessionId!==editSessionId)return null;
    if(!handoffActionAllowed({...currentPolicy.current,kind:ownDraft.kind,write:write||currentDraft.current.request})){setNotice('当前已不能办理此事项。原输入和本次办理内容仍保留；仍可核对结果、确认结果，或明确结束尚未提交的办理。');return null;}
    if(stale&&!handoffCanRetry(ownDraft)){setNotice('已保存的内容或审核依据已变化。原输入完整保留；请先核对变化，再重新办理。');return null;}
    try{const fixed=freezeHandoffRequest(currentDraft.current,write);updateDraft(fixed);return await sendFrozen(fixed);}catch(e){setError(e);return null;}
  }
  async function receipt(){if(!ownDraft?.request||busy||blocked)return;const id=ownDraft.request.request_id;setBusy(true);setError(null);try{const observed=await api(`${handoffRoot}/requests/${id}`);if(!mounted.current||currentDraft.current?.owner!==owner||currentDraft.current.sessionId!==editSessionId)return;updateDraft(previous=>previous?.owner===owner&&previous.sessionId===editSessionId&&previous.request?.request_id===id?observeHandoffReceipt(previous,observed):previous);setNotice('已查询本次办理结果，请核对下方状态和结果。');refresh();}catch(e){if(mounted.current)setError(e);}finally{if(mounted.current)setBusy(false);}}
  function acknowledge(){if(!ownDraft||ownDraft.request?.phase!=='committed'||busy||!resource)return;const result=ownDraft.request.result,exact=handoffResultMatchesResource(selection,resource,result,trace);updateDraft({...ownDraft,request:null,lastResult:result,sourceKey:exact?sourceKey:ownDraft.sourceKey,expected_revision:Number(resource.header?.current_revision??resource.revision??resource.event_revision??0),expected_handoff_revision:Number(resource.header?.current_revision??resource.current_handoff_revision??resource.expected_handoff_revision??0),expected_conflict_revision:resource.expected_conflict_revision,expected_parent_revision:resource.expected_parent_revision,answered_fact_version_id:resource.fact_version_id,answered_snapshot_digest:resource.snapshot_digest});setNotice('已确认本次办理完成。输入仍保留；可结束本次办理，再查看已保存结果或继续其他操作。');}
  const currentBinding=handoffSourceBinding(trace,resource),sourceDetails=bindingDetailDisplay(trace,currentBinding);
  const props={api,user,selection,select,resource,trace,capabilities,draft:ownDraft,begin,edit,execute,busy,refresh,refreshToken:version,disabled,options,canPrepare,onNavigate,packageChoices:bench?.packages||[]};
  function action(kind){const values={basis:'',reason:'',binding_id:bench?.packages?.find(p=>String(p.package_id)===String(resource.header?.package_id))?.binding_id||resource.revision.binding_id};if(kind==='edit')values.snapshot=cloneHandoffValue(resource.revision.snapshot_json);begin(kind,values);}
  function submitHandoff(e){e.preventDefault();const kind=ownDraft.kind,v=ownDraft.values,id=resource.header.handoff_id,body={expected_revision:ownDraft.expected_revision};let path=kind;
    if(kind==='approve'||kind==='needs_changes'){path='approvals';Object.assign(body,{decision:kind==='approve'?'approved':'needs_changes',basis:v.basis,...(kind==='approve'?{binding_digest:v.binding_digest}: {})});}
    if(kind==='publish')body.approval_id=resource.header.current_approval_id;
    if(['withdraw_submission','revoke_approval'].includes(kind)){path='withdraw';body.intent=kind;body.reason=v.reason;}
    if(kind==='rebase')Object.assign(body,{binding_id:v.binding_id,basis:v.basis,draft:resource.revision.snapshot_json});
    execute({url:`${handoffRoot}/${id}/${path}`,method:'POST',body});
  }
  const rebaseBindingSelection=handoffReviewBindingSelection(trace,ownDraft?.values?.binding_id);
  const resultGuide=handoffResultGuide(ownDraft?.kind,ownDraft?.request?.phase==='committed'?ownDraft.request.result:!ownDraft?.request?ownDraft?.lastResult:null);
  const catalog={departments:options.departments||[],people:[...(options.handlers||[]),...(options.deciders||[])],packages:(bench?.packages||[]).map(row=>({...row,label:fixedSourceName(row)+' · '+businessStatus(row.status)+(row.created_at?' · '+businessDateTime(row.created_at):'')})),bindings:[...(trace?.bindings||[]),...(ownDraft?.values?.targetTrace?.bindings||[]),...(ownDraft?.values?.sourceTrace?.bindings||[])].map(row=>({...row,label:'已审核材料 · '+businessDateTime(row.created_at)})),facts:bench?.facts||[],details:sourceDetails.map(row=>({...row,value:String(row.detail_ref||row.detail_version_id||''),label:governanceDetailName(row)})),...referenceChoices};
  return <BusinessCatalogProvider value={catalog}><div className="data-map-handoffs" onCompositionStartCapture={()=>{composing.current=true;}} onCompositionEndCapture={()=>{composing.current=false;}} onKeyDownCapture={e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||composing.current))e.stopPropagation();}}>
    {referenceChoices.incomplete&&<p role="alert">部分已发布内容的名称尚未读取，可选清单暂不完整。原关联仍保留，请刷新记录后核对。</p>}<section className="card handoff-heading"><div><h1>数据地图承接工作区</h1><p>3000 数据治理内的承接办理。逐项核对来源材料、数据定义、来源系统、影响和部门事实，再检查、批准并整体发布。</p><div className="handoff-actions"><a href={returnTo} onClick={onNavigate}>{handoffReturnLabel(returnTo)}</a>{capabilities.global_source_read&&selectedPackageId&&returnTo.split('?')[0]!=='/app/data-governance'&&<a href={'/app/data-governance?package='+encodeURIComponent(selectedPackageId)} onClick={onNavigate}>查看原工作包</a>}{canReadDataMap(user)?<a href="/app/data-map" onClick={onNavigate}>查看数据地图台账</a>:<span>本身份可在下方查看已分派工作包的发布内容；全局台账入口不在当前读取范围。</span>}</div></div><button type="button" className="secondary" disabled={busy} onClick={refresh}>查看最新记录</button></section>
    {deferredSelection&&<section className="card handoff-warning" role="status"><h2>原办理输入已保留，链接事项尚未打开</h2><p>当前继续展示原事项及原输入。新链接指向另一办理事项；切换前须明确结束原办理，结果尚未确认时，仍须先核对本次办理结果。</p><button type="button" className="secondary" disabled={busy||blocked||frozen} onClick={()=>select(deferredSelection)}>结束原办理并进入链接事项</button></section>}
    {blocked&&<section className="card handoff-warning" role="status"><h2>原身份的输入已保留</h2><p>当前身份不能查看、修改或覆盖。请使用原办理账号重新登录，核对所属部门和当前办理资格；本次结果未确认前，不能通过切换页面清除输入。</p></section>}
    {capabilities.enabled===false&&<p className="handoff-warning">承接功能尚未开启，当前只供授权查阅。</p>}{capabilities.read_only&&<p className="handoff-warning">当前为只读维护状态，不提供办理动作。</p>}
    {busy&&<p role="status">正在读取或办理，请稍候…</p>}{error&&<section className="card handoff-warning" role="alert"><h2>本次办理需要核对</h2><p>{handoffRequestNotice(error)} </p><p>当前输入仍按办理时的内容保留。请先核对最新记录和本次办理结果。</p></section>}{notice&&<p className="handoff-notice" role="status">{notice}</p>}
    {ownDraft&&<section className="card handoff-input-protection" data-testid="handoff-input-protection"><strong>{frozen?'本次提交的内容已保留':'本次输入尚未结束'}</strong><p>输入仅保留于当前浏览器内存；刷新记录不会应用或清除。离开须明确处理本次输入。</p>{actionRevoked&&!busy&&<p className="handoff-warning">当前已不能继续此项办理，编辑和提交已暂停。原输入与本次办理内容仍保留；仍可核对和确认结果，或明确结束尚未提交的办理。</p>}{stale&&!frozen&&<p className="handoff-warning">已保存的内容、审核依据或业务事实已变化，旧输入仍在，现已阻止提交。核对最新记录后明确结束并重新办理。</p>}{ownDraft.request&&<><Stamp label="原请求标识" value={'本次提交的内容已保留'}/><p>{handoffReceiptGuide(ownDraft.request.phase)}</p><div className="handoff-actions"><button type="button" className="secondary" disabled={busy} onClick={receipt}>核对本次办理结果</button>{handoffCanRetry(ownDraft)&&<button type="button" className="primary" disabled={busy||!handoffActionAllowed({...currentPolicy.current,kind:ownDraft.kind,write:ownDraft.request})} onClick={()=>execute(null)}>继续办理并核对结果</button>}{ownDraft.request.phase==='committed'&&<button type="button" className="primary" disabled={busy||!resource} onClick={acknowledge}>确认本次办理结果</button>}</div></>}{resultGuide&&<section className="handoff-result" aria-label="本次办理结果"><h3>本次办理结果</h3><p>{resultGuide.summary}</p><p>{resultGuide.next}</p>{resultGuide.target&&!sameHandoffSelection(selection,resultGuide.target)&&<><button type="button" className="secondary" disabled={busy||frozen} onClick={()=>select(resultGuide.target)}>{resultGuide.targetLabel}</button>{frozen&&<p>请先点击“确认本次办理结果”，再结束本次办理并查看对应内容。</p>}</>}</section>}<button className="secondary" type="button" disabled={busy||frozen} onClick={()=>{if(discard())setNotice('本次输入已明确结束。');}}>结束本次办理</button></section>}
    <div className="handoff-workspace-grid"><aside className="card handoff-work-list"><h2>当前可见事项</h2><h3>工作包</h3>{bench?.packages?.length?<ul>{bench.packages.map(p=><li key={p.package_id} data-package-id={p.package_id}><button type="button" className={selection?.kind==='package'&&selection.id===String(p.package_id)?'handoff-selected':'text-button'} onClick={()=>select({kind:'package',id:p.package_id})}>{fixedSourceName(p)+(p.created_at?' · '+businessDateTime(p.created_at):'')}<small>{businessStatus(p.status)}</small></button>{p.drafts?.map(d=><button className="text-button handoff-child-link" data-handoff-id={d.handoff_id} key={d.handoff_id} type="button" onClick={()=>select({kind:'handoff',id:d.handoff_id})}>{handoffDraftEntryName(d,p.publications,referenceChoices.publications)}</button>)}{p.publications?.map(pub=><button className="text-button handoff-child-link" data-publication-id={pub.publication_id} type="button" key={pub.publication_id} onClick={()=>select({kind:'publication',id:pub.publication_id})}>{publicationEntryName(referenceChoices.publications.find(row=>row.publication_id===pub.publication_id))}</button>)}</li>)}</ul>:<p>没有当前可见工作包。</p>}<h3>分派冲突</h3><ul>{bench?.conflicts?.map(c=><li key={c.conflict_id}><button className="text-button" type="button" onClick={()=>select({kind:'conflict',id:c.conflict_id})}>{c.conflict?.difference||c.difference||'冲突说明未记录'} · {handoffStateName(c.state)}</button></li>)}</ul><h3>定向事实</h3><ul>{bench?.facts?.map(f=><li key={f.fact_id}><button className="text-button" type="button" onClick={()=>select({kind:'fact',id:f.fact_id})}>{f.question_text} · {f.parent_kind!=='handoff_conflict'&&f.status==='answered'?'已答复待MDM核对':handoffStateName(f.status)}</button></li>)}</ul></aside>
    <main className="handoff-main-panel">
      {!selection&&<section className="card"><h2>选择需要办理的事项</h2><p>MDM 查看明确分派的包；冲突处理人与决策人只看本事项；业务部门只看定向问题。</p></section>}
      {resource&&selection?.kind==='package'&&<PackagePanel {...props} canReview={canReview} currentBinding={currentBinding} sourceDetails={sourceDetails}/>}
      {resource&&selection?.kind==='handoff'&&<><section className="card"><h2>{selection.revision?'历史草稿（只读）':'数据地图草稿'} · {handoffStateName(resource.header.state)}</h2><Stamp label="承接标识" value={resource.header.handoff_id}/><p>{businessStatus(resource.revision.scope_mode)}</p><p>正在查看已保存的草稿内容。{selection.revision&&Number(resource.revision.revision_no)!==Number(resource.header.current_revision)?"历史只读；原正文、摘要及依赖保持固定。":""}</p><Stamp label="准确审核绑定" value={resource.revision.binding_id}/><Stamp label="正文摘要" value={resource.revision.content_digest}/><div className="handoff-actions">{!ownDraft&&(resource.allowed_actions||[]).filter(a=>!['read','create_conflict','source_upgrade_assessment'].includes(a)).map(a=><button type="button" className={['submit','approve','publish'].includes(a)?'primary':'secondary'} key={a} disabled={busy} onClick={()=>{action(a==='save'?'edit':a);if(a==='approve')updateDraft(d=>d?{...d,values:{...d.values,binding_digest:resource.report?.binding_digest||''}}:d);}}>{{save:'编辑完整草案',rebase:'采用当前审核记录',submit:'提交本次草案',checks:'执行本次检查',withdraw_submission:'撤回本人待批提交',needs_changes:'退回修改',approve:'批准本次草案',revoke_approval:'撤销未发布批准',publish:'整单执行发布'}[a]||'查看办理条件'}</button>)}</div><Report report={resource.report} revisionId={resource.revision.revision_id} onNavigate={onNavigate}/><details><summary>当前草案完整条目（{resource.revision.snapshot_json?.items?.length||0}）</summary>{resource.revision.snapshot_json?.items?.map(i=><div className="handoff-row-card" key={i.item_ref}><h3>{handoffKinds[i.target_kind]}：{i.definition.name} · {businessName(i)}</h3><Values value={i.definition}/><p>来源 {i.source_detail_refs.map(ref=>governanceDetailName(sourceDetails.find(row=>row.detail_ref===ref)||{})).join('、')}；依据 {i.basis}</p></div>)}</details></section>
        {ownDraft?.kind==='edit'&&<HandoffDraftEditor {...props} sourceDetails={sourceDetails} publications={referenceChoices.publications||[]}/>}
        {ownDraft&&['submit','checks','approve','needs_changes','publish','withdraw_submission','revoke_approval','rebase'].includes(ownDraft.kind)&&<form className="card handoff-form" onSubmit={submitHandoff}><h2>{{submit:'提交本次草案',checks:'执行本次检查',approve:'批准准确草案',needs_changes:'退回修改',publish:'整单执行发布',withdraw_submission:'撤回本人待批提交',revoke_approval:'撤销未发布批准',rebase:'采用已审核材料'}[ownDraft.kind]}</h2>{['approve','needs_changes','rebase'].includes(ownDraft.kind)&&<HandoffInput label="本次办理依据" multiline required value={ownDraft.values.basis} disabled={busy||disabled} onChange={v=>edit('basis',v)}/>} {['withdraw_submission','revoke_approval'].includes(ownDraft.kind)&&<HandoffInput label="停止办理原因" multiline required value={ownDraft.values.reason} disabled={busy||disabled} onChange={v=>edit('reason',v)}/>} {ownDraft.kind==='rebase'&&<><BusinessSelect label="采用的已审核材料" required value={rebaseBindingSelection.value} items={rebaseBindingSelection.items} valueKey="binding_id" disabled={busy||disabled} onChange={v=>edit('binding_id',v)}/>{rebaseBindingSelection.unavailable&&<p role="status">原先选择的审核材料当前无法读取，原值已保留。请刷新记录核对可用材料后再办理。</p>}</>} {ownDraft.kind==='approve'&&<Stamp label="本次准确检查摘要" value={ownDraft.values.binding_digest}/>} {ownDraft.kind==='publish'&&<p>将整体执行准确批准的草案。现行范围发布后可供新的引用使用；历史范围只保留历史内容。</p>}<button className="primary" type="submit" disabled={busy||disabled}>确认本次办理</button></form>}
        <HandoffConflictPanel {...props}/>
      </>}
      {resource&&selection?.kind==='conflict'&&<HandoffConflictPanel {...props}/>}
      {resource&&selection?.kind==='fact'&&<HandoffFactPanel {...props}/>}
      {resource&&selection?.kind==='publication'&&<HandoffPublicationPanel {...props}/>}
      {(capabilities.global_source_read===true||selection?.kind==='handoff')&&<HandoffUpgradePanel {...props}/>}
      {trace&&<Trace trace={trace} select={select} publications={referenceChoices.publications}/>} 
    </main></div>
  </div></BusinessCatalogProvider>;
}

