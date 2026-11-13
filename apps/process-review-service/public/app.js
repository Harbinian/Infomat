import {escape, array, choices, options, heading, button, empty, tag, field, dateTime, short, dirtyDialogs, dialogOpen, openDialog, closeDialog} from './ui.js';
import {mountGraph, destroyGraph} from './graph.js';
import {classifyHandoffs} from './handoffs.js';
import {renderPage, renderOpinionActions, renderOpinionConflict, renderWalkCoverage, renderWalkDetails, renderWalkDiscussion, renderWalkHistory} from './views.js';
import {runAction} from './forms.js';
import {materialWalkEdits, projectWalkDocument, walkElement, walkElementIndex, walkEndpoints} from './walk-edits.js';

const routes = [['overview','◫','评审总览'],['materials','▤','材料与版本'],['batches','▦','批次计划'],['walk','◇','流程走查'],['opinions','▧','我的意见'],['issues','☷','问题台账'],['observations','◎','系统性问题观察']];
const emptyState = {revision:0,users:[],themes:[],materials:[],batches:[],opinions:[],issues:[],observations:[],audit:[],currentUser:null,organizationCatalog:null};
const state = {...emptyState};
let session;
let graph;
let toastTimer;
let renderGeneration = 0;
let comparisonGeneration = 0;
let identityGeneration = 0;
let mutationPending = false;
let identityChanging = false;
let renderedRevision;
const documents = new Map();
let displayedWalk;
const opinionBuffers = new Map();
const filters = {materials:{query:'',theme:'',department:'',status:''},opinions:{query:'',status:''},issues:{query:'',status:''}};
const view = {route:'overview',materialId:'',batchId:'',walkThemeId:'',selectedNode:null,selectedRelation:null,laneId:'',detailTab:'node',follow:false,issueId:'',compare:false,compareLeft:'',compareRight:'',projection:false,handoffFocus:false};
let lastFollowedPosition;
const main = document.querySelector('#main');
const context = {
  state, view, filters, documents, opinionBuffers,
  get user(){return state.currentUser;},
  role: value=>array(state.currentUser?.roles).includes(value),
  userName:id=>state.users.find(user=>user.id===id)?.name || (id?'未知演练身份':'待指定'),
  themeName:id=>state.themes.find(theme=>theme.id===id)?.name || '待分组',
  materialName:id=>state.materials.find(material=>material.id===id)?.name || '未指定材料',
  async command(type,payload,expectedRevision){return command(type,payload,expectedRevision);},
  async importFiles(files,expectedRevision){return mutate('/api/import',{files},expectedRevision);},
  async material(id){return loadMaterial(id);},
  walkDocument: () => displayedWalk?.id===view.materialId ? displayedWalk.document : null,
  walkEdits: (id=view.materialId) => materialWalkEdits(state.audit,id),
  focusWalkElement, focusWalkAction, focusIssue,
  navigate, render, toast,
  setOpinion(opinion){
    setWalkScope({materialId:opinion.materialId,batchId:opinion.batchId});
    const destination=opinionBuffers.get(bufferKey());
    if(destination?.dirty){toast('这个走查范围已有未保存输入，已打开原输入，请先处理。');navigate('walk');return;}
    opinionBuffers.set(bufferKey(),{text:opinion.text,opinionId:opinion.id,nodeRef:opinion.nodeRef||'',relationRef:opinion.relationRef||'',anchorLocked:true,baseRevision:state.revision,savedVersion:opinionVersion(opinion),dirty:false});
    navigate('walk');
  }
};
function bufferKey(){return `${state.currentUser?.id||'anonymous'}:${view.materialId}:${view.batchId}`;}
function opinionBuffer(){
  if(!opinionBuffers.has(bufferKey())) opinionBuffers.set(bufferKey(),{text:'',opinionId:'',nodeRef:'',relationRef:'',dirty:false});
  return opinionBuffers.get(bufferKey());
}
context.opinionBuffer=opinionBuffer;
function draftStatus(){
  const count=[...opinionBuffers.values()].filter(item=>item.dirty).length+dirtyDialogs.size;
  document.querySelector('#draft-status').textContent=count?`${count} 处未提交输入已保留在本次页面会话`:'';
  return count;
}
function toast(message){
  const element=document.querySelector('#toast');element.textContent=message;element.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{element.hidden=true;},5000);
}
function notice(message,error=false){const element=document.querySelector('#notice');element.textContent=message;element.classList.toggle('error',error);element.hidden=!message;}
async function request(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json','X-Review-CSRF':session?.csrfToken||''}:{}),...options.headers}});
  const body=await response.json();
  if(!response.ok){
    const error=new Error(response.status===409?'数据已被另一操作更新。你的输入已保留，请核对最新状态后再次提交。':body.error||'操作未完成，请稍后重试。');
    error.status=response.status;throw error;
  }
  return body;
}
function applySession(nextSession){
  renderGeneration++;
  session=nextSession;
  if(dialogOpen())closeDialog();
  Object.assign(state,emptyState,{users:session.users,currentUser:session.currentUser});
  view.selectedNode=null;view.selectedRelation=null;view.laneId='';view.follow=false;
  document.querySelector('#identity-select').value=session.currentUser?.id||'';
  document.querySelector('#sync-status').textContent='';
}
async function refresh({display=false}={}){
  const generation=identityGeneration;
  let next;
  try{next=await request('/api/bootstrap');}
  catch(error){if(error.status!==401)throw error;}
  if(generation!==identityGeneration)return;
  if(!next||next.currentUser?.id!==session?.currentUser?.id){
    const actual=await request('/api/session');
    if(generation!==identityGeneration)return;
    identityGeneration++;
    applySession(actual);
    if(actual.currentUser&&actual.currentUser.id===next?.currentUser?.id)Object.assign(state,next);
    notice('演练身份已在其他窗口改变；原身份未提交输入已保留，请核对当前身份。');
    await render();return;
  }
  if(next.revision<state.revision)return;
  Object.assign(state,next);
  document.querySelector('#sync-status').textContent=`已同步 · ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}`;
  if(display) await render();
}
async function mutate(path,payload,expectedRevision=state.revision,{renderResult=true,updateView}={}){
  if(identityChanging)throw new Error('演练身份正在切换，输入已保留，请切换完成后再提交。');
  if(mutationPending)throw new Error('上一项保存正在进行，输入已保留，请稍后再提交。');
  mutationPending=true;document.querySelector('#identity-select').disabled=true;
  try{
    const result=await request(path,{method:'POST',body:JSON.stringify({...payload,expectedRevision})});
    Object.assign(state,result.state);updateView?.();notice('');if(renderResult)await render();return result;
  }catch(error){
    if(error.status===409) await refresh().catch(()=>{});
    notice(error.message,true);throw error;
  }finally{
    mutationPending=false;document.querySelector('#identity-select').disabled=false;
  }
}
async function command(type,payload,expectedRevision){
  const issueId=type.startsWith('issue.')&&payload.issueId;
  const updateView=issueId?()=>{
    if(view.route!=='issues'||view.issueId!==issueId||!filters.issues.status)return;
    const issue=state.issues.find(item=>item.id===issueId);
    if(issue&&issue.status!==filters.issues.status)filters.issues.status='';
  }:undefined;
  return mutate('/api/commands',{type,payload},expectedRevision,{updateView});
}
async function loadMaterial(id){
  if(!id)return null;
  if(!documents.has(id)) documents.set(id,await request(`/api/materials/${encodeURIComponent(id)}`));
  return documents.get(id);
}
function setWalkScope({materialId='',batchId='',themeId=''}){
  view.materialId=materialId;view.batchId=batchId;view.walkThemeId=themeId;view.follow=false;
  lastFollowedPosition=undefined;
  view.selectedNode=null;view.selectedRelation=null;view.laneId='';
}
function navigate(route){view.route=route;view.compare=false;if(route!=='walk')view.projection=false;const rendering=render();main.scrollTop=0;return rendering;}
function focusIssue(id){
  if(view.route!=='issues'||view.issueId!==id)return;
  main.querySelector('.issue-select[aria-pressed="true"]')?.focus({preventScroll:true});
}
async function render(){
  const generation=++renderGeneration;
  renderedRevision=state.revision;
  document.querySelector('#navigation').innerHTML=routes.map(([id,symbol,label])=>`${({materials:'会前准备',walk:'会议进行',issues:'会后跟进'})[id]?`<span class="nav-group">${({materials:'会前准备',walk:'会议进行',issues:'会后跟进'})[id]}</span>`:''}<button class="nav-button ${view.route===id?'active':''}" data-route="${id}" ${view.route===id?'aria-current="page"':''}><span class="nav-symbol" aria-hidden="true">${symbol}</span>${label}</button>`).join('');
  destroyGraph(); graph=null;
  document.body.classList.toggle('meeting-mode',Boolean(state.currentUser&&view.projection&&view.route==='walk'&&!view.compare));
  document.querySelector('#export-button').disabled=!state.currentUser;
  if(!state.currentUser){main.innerHTML=empty('请选择演练身份','选择右上角的身份后进入评审工作区。');draftStatus();return;}
  main.innerHTML=renderPage(context);
  draftStatus();
  if(view.route==='walk'&&view.materialId){
    try{
      const material=await loadMaterial(view.materialId);if(generation!==renderGeneration)return;
      if(view.compare){await renderComparison();return;}
      const canvas=document.querySelector('#graph');if(!canvas)return;
      const previous=context.walkDocument(),edits=context.walkEdits();
      const nodeIndex=walkElementIndex(previous,'step',view.selectedNode);
      const relationIndex=walkElementIndex(previous,'relation',view.selectedRelation);
      const walkDocument=projectWalkDocument(material.document,edits);
      displayedWalk={id:material.id,document:walkDocument,editId:edits.at(-1)?.id};
      const history=document.querySelector('#walk-revision-history');
      if(history)history.innerHTML=renderWalkHistory(context,edits);
      view.selectedNode=walkElement(walkDocument,'step',nodeIndex)||null;
      view.selectedRelation=walkElement(walkDocument,'relation',relationIndex)||null;
      graph=mountGraph(canvas,walkDocument,{departments:state.departments,actorRoles:state.organizationCatalog?.roles_by_department,onNode:node=>selectNode(node),onEdge:relation=>selectRelation(relation)});
      graph.handoffFocus(Boolean(view.handoffFocus));
      const warnings=[...array(material.warnings),...graph.warnings];
      const warningElement=document.querySelector('#graph-warning');
      warningElement.hidden=!warnings.length;warningElement.textContent=warnings.map(item=>typeof item==='string'?item:(item.message||item.code||'材料存在待核对项')).join('；');
      renderDetails();
      if(view.selectedNode)graph.focusStep?.(walkDocument.behaviors.indexOf(view.selectedNode));
      else if(view.selectedRelation)graph.focusRelation(walkDocument.flow_relations.indexOf(view.selectedRelation));
      else if(view.laneId)graph.focusLane(view.laneId);
    }catch(error){if(generation===renderGeneration)notice(error.message,true);}
  }
}
function selectNode(node){view.laneId='';view.selectedNode=node;view.selectedRelation=null;if(view.detailTab!=='data')view.detailTab='node';renderDetails();}
function selectRelation(relation){view.laneId='';view.selectedRelation=relation;view.selectedNode=null;view.detailTab='node';renderDetails();}
function focusWalkStep(index){
  const node=context.walkDocument()?.behaviors?.[index];
  if(!node)return;
  selectNode(node);
  graph?.focusStep?.(index);
}
async function openOpinionSource(opinion){
  const generation=identityGeneration;
  const batch=state.batches.find(item=>item.id===opinion.batchId&&item.materialIds.includes(opinion.materialId));
  setWalkScope({materialId:opinion.materialId,batchId:batch?.id});
  if(opinion.nodeRef||opinion.relationRef)view.detailTab='node';
  await navigate('walk');
  if(generation!==identityGeneration||view.route!=='walk'||view.materialId!==opinion.materialId)return;
  const document=context.walkDocument();
  const steps=array(document?.behaviors),relations=array(document?.flow_relations);
  if(opinion.nodeRef){
    const matches=steps.filter(step=>step.behavior_ref===opinion.nodeRef);
    if(matches.length===1){focusWalkStep(steps.indexOf(matches[0]));return;}
  }else if(opinion.relationRef){
    const matches=relations.filter(relation=>relation.relation_ref===opinion.relationRef);
    if(matches.length===1){selectRelation(matches[0]);graph?.focusRelation(relations.indexOf(matches[0]));return;}
  }else return;
  toast('已打开来源材料，原意见的位置在当前图中已无法唯一定位。');
}
function locateWalkEntry(){
  const displayed=context.walkDocument(),steps=array(displayed?.behaviors);
  const info=graph?.entryInfo;
  if(!info||!steps.length)return;
  if(info.entry){focusWalkStep(steps.indexOf(info.entry));return;}
  const candidates=new Set(info.candidates);
  const choices=steps.flatMap((node,index)=>info.reason==='multiple'&&!candidates.has(node)?[]:
    [{value:String(index),label:`${index+1}. ${candidates.has(node)?'候选入口 · ':''}${node.behavior_name||'未命名步骤'}`}]);
  const descriptions={
    multiple:'图上有多个没有入线的步骤，请选择要定位的候选入口。',
    cycle:'图上每个步骤都有入线，无法从连线确定入口。请选择要定位的步骤。',
    references:'部分节点标识或连线端点需要核对，无法从连线确定入口。请选择要定位的步骤。',
    disconnected:'候选入口无法沿连线到达全部步骤。请选择要定位的步骤。'
  };
  openDialog({
    key:`locate-entry:${view.materialId}`,userId:state.currentUser.id,transient:true,
    title:'定位入口',description:descriptions[info.reason],submit:'定位所选步骤',
    fields:[{name:'stepIndex',label:'要定位的步骤',type:'select',choices,blank:'请选择步骤',required:true,full:true}],
    onSubmit:({stepIndex})=>{
      if(context.walkDocument()!==displayed)throw new Error('当前流程图已更新，请关闭窗口后重新选择。');
      focusWalkStep(Number(stepIndex));
    }
  });
}
function focusWalkElement(kind,index,materialId){
  if(view.route!=='walk'||view.compare||view.materialId!==materialId)return;
  const document=context.walkDocument(),element=walkElement(document,kind,index);
  if(!element)return;
  if(kind==='step')focusWalkStep(document.behaviors.indexOf(element));
  else{selectRelation(element);graph?.focusRelation(document.flow_relations.indexOf(element));}
}
function focusWalkAction(kind,operation,materialId){
  if(view.route!=='walk'||view.compare||view.materialId!==materialId)return;
  const action=operation==='remove'?`create-walk-${kind}`:`edit-walk-${kind}`;
  main.querySelector(`[data-action="${action}"]`)?.focus({preventScroll:true});
}
function toggleProjection(){
  view.projection=!view.projection;
  if(view.projection){view.preProjectionHandoffFocus=view.handoffFocus;view.handoffFocus=true;if(view.detailTab!=='data'&&!view.selectedNode&&!view.selectedRelation&&!view.laneId)view.detailTab='handoffs';}
  else view.handoffFocus=Boolean(view.preProjectionHandoffFocus);
  document.body.classList.toggle('meeting-mode',view.projection);
  const toggle=document.querySelector('[data-action="projection"]');if(toggle)toggle.textContent=view.projection?'退出投屏':'会议投屏';
  const focus=document.querySelector('#handoff-focus');if(focus)focus.checked=view.handoffFocus;
  graph?.handoffFocus(view.handoffFocus);renderDetails();main.scrollTop=0;
  requestAnimationFrame(()=>graph?.resize());
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view.projection&&!dialogOpen()){event.preventDefault();toggleProjection();}});
function renderDetails(){
  const element=document.querySelector('#walk-detail');if(!element)return;
  const previousDataTab=document.querySelector('[data-detail-tab="data"]').getAttribute('aria-pressed')==='true';
  if(view.laneId&&!graph?.lanes.some(lane=>lane.id===view.laneId))view.laneId='';
  const materialDocument=context.walkDocument();
  element.innerHTML=renderWalkDetails(context,materialDocument);
  if(previousDataTab||view.detailTab==='data')element.scrollTop=0;
  const steps=array(materialDocument?.behaviors),relations=array(materialDocument?.flow_relations);
  const info=graph?.entryInfo,entryButton=document.querySelector('[data-action="graph-entry"]');
  if(entryButton){
    entryButton.disabled=!info||!steps.length;
    entryButton.title=entryButton.disabled?'当前没有可定位的步骤':info.entry?'放大并居中显示入口':'查看候选入口或选择要定位的步骤';
  }
  const addRelation=document.querySelector('[data-action="create-walk-relation"]');
  if(addRelation){
    addRelation.disabled=!walkEndpoints(materialDocument).length;
    addRelation.title=addRelation.disabled?'请先新增可定位的步骤':'选择起点、终点和流转条件';
  }
  const handoffs=classifyHandoffs(materialDocument,state.departments,state.organizationCatalog?.roles_by_department),cross=handoffs.filter(item=>item.kind==='cross').length,pending=handoffs.filter(item=>item.kind==='pending').length;
  const counts=document.querySelector('#handoff-count');if(counts)counts.textContent=`跨部门 ${cross} · 部门待核对 ${pending}`;
  const laneSelect=document.querySelector('#walk-lane');if(laneSelect)laneSelect.innerHTML=options((graph?.lanes||[]).map(lane=>({value:lane.id,label:`${lane.label} · ${lane.nodeIds.length}步`})),view.laneId||'','全部部门泳道');
  const jump=document.querySelector('#walk-step');
  const candidates=new Set(info?.candidates);
  if(jump)jump.innerHTML=options(steps.map((node,index)=>({value:String(index),label:`${index+1}. ${node===info?.entry?'入口 · ':candidates.has(node)?'候选入口 · ':''}${node.behavior_name}`})),view.selectedNode?String(steps.indexOf(view.selectedNode)):'','整份流程 · 选择步骤定位');
  const position=document.querySelector('#graph-position');
  const lane=graph?.lanes.find(item=>item.id===view.laneId);
  if(position)position.textContent=view.selectedNode?`当前：${view.selectedNode.behavior_name} · 已突出相邻交接`:view.selectedRelation?'当前：选中交接关系 · 完整条件见右侧':lane?`当前：${lane.label} · ${lane.nodeIds.length} 个步骤 · 点击步骤或交接查看详情`:`${steps.length} 个步骤 · ${relations.length} 条关系 · 点击节点开始走查`;
  const present=document.querySelector('[data-action="present"]'),batch=state.batches.find(item=>item.id===view.batchId);
  if(present){present.disabled=Boolean(view.selectedRelation||view.laneId)||!batch||batch.status!=='frozen'||![batch.leadId,batch.recorderId].includes(state.currentUser?.id);present.title=view.selectedRelation||view.laneId?'当前同步支持步骤；请先选择具体步骤，或返回全图后发布。':'同步给主动跟随主持位置的参会者';}
  document.querySelectorAll('[data-detail-tab]').forEach(item=>{
    const selected=item.dataset.detailTab===view.detailTab;
    item.classList.toggle('active',selected);
    item.setAttribute('aria-pressed',String(selected));
  });
  if(previousDataTab!==(view.detailTab==='data'))graph?.resize();
  renderOpinionContext();
}
function renderOpinionContext(){
  const label=document.querySelector('#editor-context');
  if(label){
    const buffer=opinionBuffer();
    const materialDocument=context.walkDocument();
    const steps=array(materialDocument?.behaviors),relations=array(materialDocument?.flow_relations);
    const anchoredNode=steps.find(node=>node.behavior_ref===buffer.nodeRef);
    const anchoredRelation=relations.find(item=>item.relation_ref===buffer.relationRef),describeRelation=relation=>relation?`${steps.find(n=>n.behavior_ref===relation.from_behavior_ref)?.behavior_name||'起点待核对'} → ${steps.find(n=>n.behavior_ref===relation.to_behavior_ref)?.behavior_name||'终点待核对'}`:'原选中关系';
    const anchor=buffer.anchorLocked?(buffer.nodeRef?`已固定定位：${anchoredNode?.behavior_name||'原步骤'}`:buffer.relationRef?`已固定交接：${describeRelation(anchoredRelation)}`:'已固定定位：整份流程材料'):(view.selectedNode?`将定位步骤：${view.selectedNode.behavior_name}`:view.selectedRelation?`将定位交接：${describeRelation(view.selectedRelation)}`:'将定位：整份流程材料');
    label.textContent=anchor+(buffer.opinionId?' · 更正保留历史':'');
  }
}
async function renderComparison(){
  const generation=++comparisonGeneration;
  await Promise.all(['Left','Right'].map(async side=>{
    const id=view[`compare${side}`],element=document.querySelector(`#compare-${side.toLowerCase()}`);
    if(!element)return;
    if(!id){element.innerHTML=empty('选择需要对照的材料');return;}
    const current=()=>generation===comparisonGeneration&&view.compare&&view[`compare${side}`]===id&&element.isConnected;
    element.innerHTML=empty('正在载入所选材料');
    try{
      const material=await loadMaterial(id);if(!current())return;
      const document=material.document;const process=document.process||{};
      element.innerHTML=`<h3>${escape(material.name)}</h3><p class="subtle-text">${escape(material.sourcePath)}</p><dl class="record-detail">${field('材料所述归属',material.declaredDepartment)}${field('目的',process.purpose)}${field('范围',process.scope)}</dl><div class="muted-block">${array(document.behaviors).length} 个步骤 · ${array(document.data_objects).length} 个数据对象 · ${array(document.forms).length} 个表单</div>${array(document.behaviors).map((node,index)=>`<div class="step-item"><strong>${index+1}. ${escape(node.behavior_name)}</strong><p>办理角色：${escape(node.current_actor_role||'未填写')}</p><p>${escape(node.behavior_description||'')}</p><p>完成标准：${escape(node.completion_standard||'未填写')}</p></div>`).join('')}`;
    }catch(error){if(current())element.innerHTML=empty('无法读取材料',error.message);}
  }));
}
function opinionVersion(opinion){
  return opinion?JSON.stringify([opinion.status,opinion.text,opinion.updatedAt,opinion.history?.length]):null;
}
function syncWalkDiscussion(){
  const discussion=document.querySelector('#walk-discussion');
  if(!discussion||discussion.dataset.revision===String(state.revision)||dialogOpen()||discussion.contains(document.activeElement))return;
  discussion.innerHTML=renderWalkDiscussion(context);
  discussion.dataset.revision=state.revision;
}
function updateOpinionEditor(buffer){
  if(view.route!=='walk'||view.compare||opinionBuffer()!==buffer)return;
  renderOpinionContext();draftStatus();
  for(const [id,content] of [['opinion-actions',renderOpinionActions(context)],['opinion-conflict',renderOpinionConflict(context)]]){
    const element=document.getElementById(id);
    if(element)element.innerHTML=content;
  }
  syncWalkDiscussion();
}
function checkOpinionConflict(buffer){
  if(!buffer.opinionId)return false;
  const latest=state.opinions.find(item=>item.id===buffer.opinionId);
  const version=opinionVersion(latest);
  if(version!==buffer.savedVersion){
    buffer.conflict={version,text:latest?.text};
    notice('');updateOpinionEditor(buffer);
    return true;
  }
  return Boolean(buffer.conflict);
}
function acknowledgeOpinionConflict(){
  const buffer=opinionBuffer();
  const latest=state.opinions.find(item=>item.id===buffer.opinionId);
  if(!buffer.conflict||!latest)return;
  const version=opinionVersion(latest);
  if(version!==buffer.conflict.version){checkOpinionConflict(buffer);return;}
  buffer.savedVersion=version;buffer.baseRevision=state.revision;buffer.conflict=null;
  updateOpinionEditor(buffer);
  document.querySelector('#opinion-text')?.focus();
}
async function saveOpinion(submit){
  const buffer=opinionBuffer();if(!buffer.text.trim()){toast('请先填写意见内容。');return;}
  if(checkOpinionConflict(buffer))return;
  const authorId=state.currentUser.id;
  if(!submit&&state.opinions.some(item=>item.id===buffer.opinionId&&item.status==='submitted')){toast('已提交意见请使用“提交更正”，原意见与更正历史会继续保留。');return;}
  const payload={materialId:view.materialId,batchId:view.batchId||undefined,text:buffer.text,submit};
  if(buffer.opinionId)payload.opinionId=buffer.opinionId;
  payload.nodeRef=buffer.nodeRef||'';payload.relationRef=buffer.relationRef||'';
  let saved;
  try{saved=(await mutate('/api/commands',{type:'opinion.save',payload},buffer.baseRevision??state.revision,{renderResult:false})).state;}
  catch(error){
    if(error.status===409){if(checkOpinionConflict(buffer))return;buffer.baseRevision=state.revision;}
    throw error;
  }
  buffer.dirty=buffer.text!==payload.text;
  buffer.baseRevision=saved.revision;
  if(!buffer.opinionId){const latest=saved.opinions.filter(item=>item.authorId===authorId&&item.materialId===payload.materialId&&item.batchId===(payload.batchId||'')&&item.text===payload.text).at(-1);buffer.opinionId=latest?.id||'';}
  buffer.savedVersion=opinionVersion(saved.opinions.find(item=>item.id===buffer.opinionId));
  updateOpinionEditor(buffer);
  if(['opinions','issues'].includes(view.route))await render();
  toast(buffer.dirty?'提交前的内容已保存，保存期间补充的输入仍待提交。':submit?'意见已提交，可在「我的意见」查看，记录员可在问题台账整理。':'草稿已保存，可在「我的意见」继续编辑。');
}
document.addEventListener('click',async event=>{
  const route=event.target.closest('[data-route]');if(route){navigate(route.dataset.route);return;}
  const tab=event.target.closest('[data-detail-tab]');if(tab){view.detailTab=tab.dataset.detailTab;renderDetails();return;}
  const dataSection=event.target.closest('[data-walk-data-section]');
  if(dataSection){
    const panel=document.querySelector('#walk-detail'),heading=document.getElementById(`walk-${dataSection.dataset.walkDataSection}`);
    const inset=parseFloat(getComputedStyle(panel).paddingTop)+dataSection.closest('.walk-data-navigation').offsetHeight+8;
    heading.focus({preventScroll:true});
    panel.scrollTop+=heading.getBoundingClientRect().top-panel.getBoundingClientRect().top-inset;
    return;
  }
  const nodeJump=event.target.closest('[data-node-index]');if(nodeJump){focusWalkStep(Number(nodeJump.dataset.nodeIndex));return;}
  const relationJump=event.target.closest('[data-relation-index]');if(relationJump){const index=Number(relationJump.dataset.relationIndex),relation=context.walkDocument()?.flow_relations?.[index];if(relation){selectRelation(relation);graph?.focusRelation(index);}return;}
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const {action,id}=target.dataset;
  try{
    if(action==='open-material'){setWalkScope({materialId:id});navigate('walk');}
    else if(action==='open-batch'){setWalkScope({batchId:id});navigate('walk');}
    else if(action==='open-assigned-batch'){setWalkScope({batchId:id,materialId:view.materialId});navigate('walk');}
    else if(action==='browse-theme'){setWalkScope({themeId:id});navigate('walk');}
    else if(action==='browse-all-materials'){setWalkScope({materialId:view.materialId});navigate('walk');}
    else if(action==='graph-fit'){view.laneId='';view.selectedNode=null;view.selectedRelation=null;graph?.fit();renderDetails();}
    else if(action==='graph-entry')locateWalkEntry();
    else if(action==='graph-readable'){
      const steps=array(context.walkDocument()?.behaviors);
      focusWalkStep(view.selectedNode?steps.indexOf(view.selectedNode):0);
    }
    else if(action==='graph-in')graph?.zoom(1.2);
    else if(action==='graph-out')graph?.zoom(1/1.2);
    else if(action==='projection')toggleProjection();
    else if(action==='record-handoff'){
      const buffer=opinionBuffer(),reference=view.selectedRelation?.relation_ref||'';
      const matches=array(context.walkDocument()?.flow_relations).filter(item=>item.relation_ref===reference);
      if(!reference||matches.length!==1){toast('本交接的连线标识待核对，暂不能定位意见。');return;}
      if((buffer.dirty||buffer.opinionId)&&buffer.anchorLocked&&buffer.relationRef!==reference){toast('当前意见仍关联原位置。请先处理当前输入，再点击“另写一条”记录这次交接。');return;}
      buffer.nodeRef='';buffer.relationRef=reference;buffer.anchorLocked=true;
      if(view.projection)toggleProjection();
      else renderDetails();
      const input=document.querySelector('#opinion-text');input?.scrollIntoView({block:'nearest'});input?.focus();
    }
    else if(action==='save-opinion'||action==='submit-opinion')await saveOpinion(action==='submit-opinion');
    else if(action==='acknowledge-opinion-conflict')acknowledgeOpinionConflict();
    else if(action==='new-opinion'){if(opinionBuffer().dirty){toast('请先保存或提交当前意见，输入已保留。');return;}opinionBuffers.set(bufferKey(),{text:'',opinionId:'',nodeRef:'',relationRef:'',dirty:false});render();}
    else if(action==='select-issue'){
      const restoreFocus=target.classList.contains('issue-select')&&document.activeElement===target;
      view.issueId=id;await render();
      if(restoreFocus)focusIssue(id);
    }
    else if(action==='open-linked-issue'){view.issueId=id;filters.issues={query:'',status:''};navigate('issues');}
    else if(action==='open-opinion-source'){const opinion=state.opinions.find(item=>item.id===id);if(opinion)await openOpinionSource(opinion);}
    else if(action==='compare'){view.compare=!view.compare;view.compareLeft=view.materialId;view.compareRight=state.materials.find(item=>item.id!==view.materialId)?.id||'';render();}
    else if(action==='present'){await command('batch.present',{batchId:view.batchId,materialId:view.materialId,nodeRef:view.selectedNode?.behavior_ref||''});toast('主持投屏位置已更新；其他人的个人浏览保持独立。');}
    else if(action==='theme-materials'){filters.materials={query:'',department:'',status:'',theme:id};navigate('materials');}
    else if(action==='pending-materials'){filters.materials={query:'',theme:'',status:'pending',department:context.role('representative')?state.currentUser.department:''};navigate('materials');}
    else if(action==='browse-flow')navigate('walk');
    else if(action==='go-page')navigate(id);
    else if(action==='issue-status'){filters.issues.status=id;navigate('issues');}
    else await runAction(action,id,context);
  }catch(error){notice(error.message,true);}
});
function applyListFilter(input){
  const [page,key]=input.dataset.filter.split('.');
  if(page!==view.route||filters[page][key]===input.value)return;
  filters[page][key]=input.value;
  const markup=document.createElement('template');
  markup.innerHTML=renderPage(context);
  for(const region of main.querySelectorAll('[data-filter-region]')){
    const next=markup.content.querySelector(`[data-filter-region="${region.dataset.filterRegion}"]`);
    if(next)region.replaceChildren(...next.childNodes);
  }
}
document.addEventListener('input',event=>{
  if(event.target.id==='opinion-text'){
    const buffer=opinionBuffer();
    if(!buffer.dirty&&!buffer.opinionId)buffer.baseRevision=state.revision;
    if(!buffer.anchorLocked){buffer.nodeRef=view.selectedNode?.behavior_ref||'';buffer.relationRef=view.selectedRelation?.relation_ref||'';buffer.anchorLocked=true;}
    buffer.text=event.target.value;buffer.dirty=true;draftStatus();renderOpinionContext();
  }
  if(event.target.matches('input[type="search"][data-filter]')&&!event.isComposing)applyListFilter(event.target);
});
document.addEventListener('compositionend',event=>{
  if(event.target.matches('input[type="search"][data-filter]'))applyListFilter(event.target);
});
document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.matches('select[data-filter]'))applyListFilter(target);
  if(target.id==='walk-material'){view.materialId=target.value;view.selectedNode=null;view.selectedRelation=null;view.laneId='';render();}
  if(target.id==='walk-batch'){setWalkScope({batchId:target.value});render();}
  if(target.id==='follow-presenter'){
    view.follow=target.checked;lastFollowedPosition=undefined;
    if(view.follow)await followPresenter();
  }
  if(target.id==='handoff-focus'){view.handoffFocus=target.checked;graph?.handoffFocus(view.handoffFocus);}
  if(target.id==='walk-step'){
    if(target.value===''){view.selectedNode=null;view.selectedRelation=null;graph?.reset();renderDetails();}
    else focusWalkStep(Number(target.value));
  }
  if(target.id==='walk-lane'){
    view.laneId=target.value;view.selectedNode=null;view.selectedRelation=null;view.detailTab='list';
    if(view.laneId)graph?.focusLane(view.laneId);else graph?.fit();renderDetails();
  }
  if(target.dataset.compare){view[target.dataset.compare]=target.value;await renderComparison();}
});
function presenterTarget(){
  if(!view.follow||view.route!=='walk'||view.compare)return null;
  const batch=state.batches.find(item=>item.id===view.batchId);
  const presenter=batch?.presenter;
  if(!presenter?.materialId||!batch.materialIds.includes(presenter.materialId))return null;
  return {materialId:presenter.materialId,nodeRef:presenter.nodeRef,key:JSON.stringify([batch.id,presenter.materialId,presenter.nodeRef,presenter.actorId,presenter.updatedAt])};
}
async function followPresenter(){
  const target=presenterTarget();
  if(!target||target.key===lastFollowedPosition)return;
  if(view.materialId!==target.materialId){
    view.materialId=target.materialId;view.selectedNode=null;view.selectedRelation=null;view.laneId='';
    const rendering=render(), generation=renderGeneration;
    await rendering;
    if(generation!==renderGeneration||presenterTarget()?.key!==target.key)return;
  }
  const document=context.walkDocument();
  if(!document||!graph)return;
  lastFollowedPosition=target.key;
  const steps=array(document.behaviors),index=steps.findIndex(node=>node.behavior_ref===target.nodeRef);
  if(index>=0){focusWalkStep(index);return;}
  view.selectedNode=null;
  view.selectedRelation=null;view.laneId='';
  renderDetails();graph.fit();
}
document.querySelector('#identity-select').addEventListener('change',async event=>{
  const select=event.currentTarget;
  if(identityChanging||mutationPending)return;
  identityChanging=true;select.disabled=true;
  let changed=false;
  try{
    identityGeneration++;
    const next=await request('/api/session',{method:'POST',body:JSON.stringify({userId:select.value})});
    applySession(next);changed=true;notice('');
    if(next.currentUser){main.innerHTML=empty('正在加载评审工作区');await refresh();}
    await render();
    toast(next.currentUser?'已切换演练身份，未提交输入按身份保留。':'已退出当前演练身份，未提交输入仍保留在本页。');
  }catch(error){select.value=session?.currentUser?.id||'';if(changed)await render();notice(error.message,true);}
  finally{identityChanging=false;select.disabled=false;}
});
document.querySelector('#export-button').addEventListener('click',()=>{window.location.assign('/api/export');});
window.addEventListener('draftstatechange',draftStatus);
window.addEventListener('beforeunload',event=>{if(draftStatus()){event.preventDefault();event.returnValue='';}});
async function start(){
  try{
    session=await request('/api/session');
    if(session.network==='lan'){
      document.querySelector('#review-network').textContent='局域网隔离演练';
      document.querySelector('#review-network-note').textContent='供局域网隔离演练';
    }
    const select=document.querySelector('#identity-select');
    select.innerHTML=options(session.users.map(user=>({value:user.id,label:`${user.name} · ${user.department||'公共角色'}`})),session.currentUser?.id||'','请选择演练身份');
    if(session.currentUser)await refresh();else Object.assign(state,{users:session.users,currentUser:null});
    await render();
    setInterval(async()=>{
      if(!state.currentUser||mutationPending||identityChanging)return;
      try{
        const previous=state.revision;
        await refresh();
        const inWalk=view.route==='walk'&&!view.compare;
        const newEdit=inWalk&&displayedWalk?.id===view.materialId&&displayedWalk.editId!==context.walkEdits().at(-1)?.id;
        const editing=dialogOpen()||document.activeElement?.id==='opinion-text';
        if(newEdit&&!editing)await render();
        if(inWalk&&previous!==state.revision){
          const coverage=document.querySelector('#walk-coverage');
          if(coverage)coverage.innerHTML=renderWalkCoverage(context);
        }
        if(inWalk)syncWalkDiscussion();
        if(['opinions','issues','batches','materials'].includes(view.route)&&renderedRevision!==state.revision&&!editing&&!document.activeElement?.matches('input, select'))await render();
        const pendingPresenter=presenterTarget();
        const presenterWaiting=pendingPresenter&&pendingPresenter.key!==lastFollowedPosition;
        if(presenterWaiting&&!editing)await followPresenter();
        if(newEdit&&editing)document.querySelector('#sync-status').textContent='有新的走查修订 · 结束当前输入后同步';
        else if(presenterWaiting&&editing)document.querySelector('#sync-status').textContent='主持人已发布新位置 · 结束当前输入后同步';
        else if(previous!==state.revision&&!inWalk)document.querySelector('#sync-status').textContent='有最新状态 · 切换视图即可查看';
      }
      catch{document.querySelector('#sync-status').textContent='同步暂不可用 · 输入已保留';}
    },6000);
  }catch(error){main.innerHTML=empty('本地服务暂不可用',error.message);}
}
start();
