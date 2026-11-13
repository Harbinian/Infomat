import {openDialog,choices,array,escape as e,dateTime} from './ui.js';
import {projectWalkDocument, walkEditFields, walkEditText, walkElement, walkElementIndex, walkEndpoints,walkElementLabel,walkRemovalBlockers} from './walk-edits.js';
import {batchFreezeBlockers, walkCoverageReadiness} from './review-status.js';
import {actorSelectionError} from './actor-selection.js';

const text = (name,label,extra={})=>({name,label,...extra});
const long = (name,label,extra={})=>({name,label,type:'textarea',full:true,...extra});
const select = (name,label,items,extra={})=>({name,label,type:'select',choices:items,...extra});
const checks = (name,label,items,extra={})=>({name,label,type:'checks',choices:items,full:true,...extra});
const userChoices = (c,predicate=()=>true)=>c.state.users.filter(predicate).map(user=>({value:user.id,label:`${user.name} · ${user.department||'公共角色'}`}));
const materialChoices = c=>c.state.materials.map(item=>({value:item.id,label:`${item.name}（${item.sourceDepartment||'待认领'} / ${item.sourcePath.split(/[\\/]/).slice(-2).join('/')}）`}));
const departments = c=>[...new Set((array(c.state.departments).length?c.state.departments:c.state.users.filter(item=>array(item.roles).includes('representative')).map(item=>item.department)).filter(value=>typeof value==='string'&&value))].map(value=>({value,label:value}));
function open(c,config){openDialog({...config,userId:c.user.id,baseRevision:c.state.revision,getRevision:()=>c.state.revision});}
function openIssue(c,issueId,config){open(c,{...config,onSaved:()=>c.focusIssue(issueId)});}
function walkFields(document, kind, element, roles) {
  const endpoints = kind==='relation' ? walkEndpoints(document) : [];
  return walkEditFields[kind].filter(({name}) => element[name] == null || typeof element[name] === 'string').map(field => {
    if(field.name==='current_actor_role')return {...field,type:'actor',roles,full:true};
    const choices = field.endpoint ? endpoints : field.choices;
    if (!choices) {
      if(field.singleLine&&!/[\r\n]/.test(element[field.name]||''))return {...field,...text(field.name,field.label,{required:field.required,full:true})};
      return {...field,...long(field.name,field.label,{required:field.required,rows:2,help:field.singleLine?'原名称包含换行，已保留。修改名称时请改为单行。':''})};
    }
    const value = element[field.name];
    const items = value && !choices.some(choice => choice.value === value)
      ? [...choices,{value,label:'原值保留，待核对',disabled:true}] : choices;
    return {...field,...select(field.name,field.label,items,{required:Boolean(field.endpoint&&!value),full:true,blank:'请选择或待明确'})};
  });
}

function openWalkElement(c, kind, operation) {
  const {materialId,batchId,selectedNode,selectedRelation}=c.view;
  const document=c.walkDocument();
  const creating=operation==='create';
  const removing=operation==='remove';
  const step=kind==='step';
  const element=creating ? (step ? {node_type:'action',actor_assignment_mode:'fixed_department'} : {from_behavior_ref:selectedNode?.behavior_ref,relation_type:'sequence'}) : (step?selectedNode:selectedRelation);
  if(!document||!element||!c.role('participant'))return;
  const index=creating ? undefined : walkElementIndex(document,kind,element);
  if(index<0)return;
  const roles=c.state.organizationCatalog?.roles_by_department||{};
  const fields=removing ? [] : walkFields(document,kind,element,roles);
  const values=Object.fromEntries(fields.map(({name})=>[name,walkEditText(element[name])]));
  const reviewedValues={};
  const verb=creating?'新增':removing?'移除':'编辑';
  const target=step?'步骤':'连线';
  if(removing){
    const presenters=c.state.batches.filter(batch=>batch.presenter?.materialId===materialId).map(batch=>batch.presenter);
    const blockers=walkRemovalBlockers(document,kind,index,presenters);
    if(blockers.length){
      open(c,{key:`walk-remove-impact:${materialId}:${kind}:${index}`,title:`暂不能移除${target}`,transient:true,
        description:walkElementLabel(document,kind,element),values:{impacts:blockers.join('\n')},
        fields:[long('impacts','需先处理的关联',{readOnly:true,rows:8})],submit:'关闭',onSubmit:async()=>{}});
      return;
    }
  }
  const description=removing
    ? `${walkElementLabel(document,kind,element)}将从共享走查图移除。导入原件、意见来源和修订记录会保留。`
    : `${c.materialName(materialId)} · ${verb}${target}。保存后作为共享走查修订，供参会者核对。`;
  open(c,{
    key:`walk-${operation}:${materialId}:${kind}:${index??'new'}`,title:`${verb}${target}`,description,
    trackInitialValues:operation==='edit',values,
    fields:[...fields,long('reason','修订原因',{required:true,rows:2})],
    submit:removing?`确认移除${target}`:'保存走查修订',
    onSaved:()=>c.focusWalkAction(kind,operation,materialId),
    onSubmit:async (submitted,revision,initial)=>{
      const payload={materialId,batchId,kind,index,reason:submitted.reason};
      if(step&&!removing){
        const error=actorSelectionError(creating?{}:initial,submitted,roles);
        if(error)throw new Error(error);
      }
      if(creating){
        const changes=Object.fromEntries(fields.map(({name})=>[name,submitted[name]]));
        const result=await c.command('walk.create',{...payload,changes},revision);
        c.focusWalkElement(kind,result.state.audit.at(-1).detail.index,materialId);
        c.toast(`已${verb}${target}，操作已记入走查修订。`);
        return;
      }
      const original=(await c.material(materialId)).document;
      const current=walkElement(projectWalkDocument(original,c.walkEdits(materialId)),kind,index);
      if(!current)throw new Error('该元素已从共享走查图移除，你的输入仍保留。');
      if(removing){
        if(JSON.stringify(current)!==JSON.stringify(element))throw new Error('该元素已有更新，你的原因已保留。请关闭窗口，核对当前元素后重新打开移除操作。');
        await c.command('walk.remove',payload,c.state.revision);
        c.toast(`已移除${target}，操作已记入走查修订。`);
        return;
      }
      const changes=Object.fromEntries(fields.filter(({name})=>walkEditText(submitted[name])!==initial[name]).map(({name})=>[name,submitted[name]]));
      if(!Object.keys(changes).length){c.toast('没有字段发生变化。');return;}
      const conflicts=[];
      for(const {name,label} of fields){
        if(!Object.hasOwn(changes,name))continue;
        const latest=walkEditText(current[name]);
        if(latest!==(reviewedValues[name]??initial[name])&&latest!==walkEditText(changes[name])){
          conflicts.push(`${label}最新内容为「${latest||'空白'}」`);
          reviewedValues[name]=latest;
        }
      }
      if(conflicts.length){
        const error=new Error(`${conflicts.join('。')}。你的输入已保留，请核对后再次保存。`);
        error.status=409;
        throw error;
      }
      await c.command('walk.edit',{...payload,changes},revision);
      c.toast('走查修订已保存，可在修订记录中查看前后内容。');
    }
  });
}
function missingReviewRepresentatives(c,affectedDepartments,reviewerIds){
  const selected=new Set(array(reviewerIds));
  const represented=new Set(c.state.users.filter(user=>selected.has(user.id)&&array(user.roles).includes('representative')).map(user=>user.department));
  return array(affectedDepartments).filter(department=>!represented.has(department));
}
function requireIssueReviewCoverage(c,affectedDepartments,reviewerIds){
  const missing=missingReviewRepresentatives(c,affectedDepartments,reviewerIds);
  if(missing.length)throw new Error(`请为以下部门各选一名部门代表：${missing.join('、')}。`);
}
function issueFields(c,issue){
  const representatives=new Set(c.state.users.filter(user=>array(user.roles).includes('representative')).map(user=>user.id));
  const reviewers=userChoices(c).sort((a,b)=>Number(representatives.has(b.value))-Number(representatives.has(a.value)))
    .map(item=>({...item,label:`${item.label}（${representatives.has(item.value)?'部门代表':'补充复核'}）`}));
  const reviewerStatus=values=>{
    const affected=array(issue?.affectedDepartments??values.affectedDepartments);
    if(!affected.length)return '先选择受影响部门。';
    const missing=missingReviewRepresentatives(c,affected,values.reviewerIds);
    return missing.length?`仍需选择以下部门的代表：${missing.join('、')}。`:'受影响部门的复核代表已选齐。';
  };
  const assignment=[select('assigneeId','跟进人（可暂不指定）',userChoices(c)),text('dueDate','跟进期限（可暂不指定）',{type:'date'}),checks('reviewerIds','指定复核人',reviewers,{help:'每个受影响部门至少选择一名部门代表，其他身份可作为补充复核人。调整复核人会重置本轮复核决定。',status:reviewerStatus}),select('authorityId','有权主体（涉及制度决定时必须指定）',userChoices(c,user=>array(user.roles).includes('authority')),{full:true})];
  if(issue)return assignment;
  return [text('title','问题标题',{required:true,full:true}),long('description','问题描述与事实依据',{required:true}),long('impact','影响与待决定事项',{required:true}),select('scope','影响范围',[{value:'department',label:'部门内'},{value:'cross_department',label:'跨部门'},{value:'policy',label:'涉及制度决定'}],{required:true}),checks('affectedDepartments','受影响部门',departments(c)),checks('materialIds','关联材料快照',materialChoices(c)),checks('opinionIds','引用已提交意见',c.state.opinions.filter(item=>item.status==='submitted').map(item=>({value:item.id,label:`${c.userName(item.authorId)}：${item.text.slice(0,100)}`}))),...assignment];
}
export async function runAction(action,id,c){
  const walkAction=/^(create|edit|remove)-walk-(step|relation)$/.exec(action);
  if(walkAction){openWalkElement(c,walkAction[2],walkAction[1]);return;}
  const material=c.state.materials.find(item=>item.id===id);
  const batch=c.state.batches.find(item=>item.id===id);
  const issue=c.state.issues.find(item=>item.id===id);
  const opinion=c.state.opinions.find(item=>item.id===id);
  if(action==='go-batches'){c.navigate('batches');return;}
  if(action==='confirm-material'){
    open(c,{key:`confirm:${id}`,title:'确认本次评审的材料版本',description:'请核对来源、边界和版本理由。此确认仅为本地演练，不替代正式业务批准；其他快照继续保留。',values:{themeId:material.themeId||'',note:material.confirmationNote||''},fields:[select('themeId','确认评审主题',choices(c.state.themes),{required:true,full:true}),...(!material.sourceDepartment?[select('sourceDepartment','明确认领提交部门',[{value:c.user.department,label:c.user.department}],{required:true,full:true})]:[]),long('note','版本确认理由 / 需保留的边界',{required:true,placeholder:'说明为何采用此快照，以及仍需讨论的范围或不确定事项。'})],submit:'确认材料版本',onSubmit:async(values,revision)=>{await c.command('material.confirm',{materialId:id,...values},revision);c.toast('材料版本已确认；确认操作已留痕。');}});return;
  }
  if(action==='link-version'){
    open(c,{key:`version:${id}`,title:'明确关联前序材料版本',description:'当前材料作为后续快照，前序原文、历史评审和问题处理记录继续保留；不会继承审核或关闭状态。',fields:[select('predecessorId','选择前序材料快照',materialChoices(c).filter(item=>item.value!==id),{required:true,full:true}),long('changeNote','变化说明与需重审的内容',{required:true})],values:{predecessorId:material.predecessorId||'',changeNote:material.changeNote||''},submit:'保存版本关联',onSubmit:async(values,revision)=>{await c.command('material.link_version',{materialId:id,...values},revision);c.toast('版本关联已记录，需关注的问题将保留提示。');}});return;
  }
  if(action==='import'){
    open(c,{key:'import',title:'导入本地 JSON 材料',description:'选取多份文件或一个目录。全部文件通过校验后再一起导入；同名、同标识文件分别保存。来源路径只作来源标签，不指示服务器读取文件。',fields:[{name:'files',label:'选择多个 JSON 文件',type:'file',full:true},{name:'directory',label:'或选择一个材料目录（仅导入 JSON）',type:'file',directory:true,full:true},text('sourcePrefix','可选来源路径前缀',{full:true,help:'使用文件名或相对路径无法识别提交部门时，可填写来源目录；不在此填写任何密钥。'})],submit:'校验并导入',onSubmit:async(values,revision)=>{
      const selected=[...Array.from(values.files||[]),...Array.from(values.directory||[])].filter(file=>file.name.toLowerCase().endsWith('.json'));
      if(!selected.length)throw new Error('请至少选择一份 JSON 材料。');
      const files=await Promise.all(selected.map(async file=>({sourcePath:[values.sourcePrefix,file.webkitRelativePath||file.name].filter(Boolean).join('/'),content:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer())})));
      await c.importFiles(files,revision);c.toast(`已导入并核对 ${files.length} 份文件；重复的同路径同内容导入保持幂等。`);
    }});return;
  }
  if(action==='create-batch'||action==='edit-batch'){
    const existing=batch||{},occupied=new Set(c.state.batches.filter(item=>item.id!==existing.id).flatMap(item=>item.materialIds||[]));
    const metadata=new Map(c.state.materials.map(item=>[item.id,item]));
    const matchesTheme=item=>metadata.get(item.value).themeId===batch?.themeId;
    const available=materialChoices(c).filter(item=>!occupied.has(item.value))
      .sort((a,b)=>Number(matchesTheme(b))-Number(matchesTheme(a)))
      .map(item=>{
        const material=metadata.get(item.value);
        return {...item,label:`${item.label} · ${material.status==='confirmed'?'已确认':'待代表确认'} · ${c.themeName(material.themeId)}`};
      });
    open(c,{key:`batch:${id||'new'}`,title:batch?'编辑评审批次计划':'创建评审批次',description:'主讲、记录员和交接部门均由本计划明确选择。冻结前可调整；冻结后参与者与材料清单不可修改。',values:{...existing},fields:[text('title','批次名称',{required:true,full:true}),...(!batch?[select('themeId','评审主题',choices(c.state.themes),{required:true,full:true})]:[]),checks('materialIds','选入材料快照',available,{help:'只列出尚未分入其他主批次的材料。冻结要求每份材料都已确认，且主题与批次一致。'}),checks('memberIds','参与演练身份',userChoices(c),{help:'参与者均须能够读取本批次全部评审材料；请包含主讲、记录员和各交接部门代表。'}),select('leadId','主讲 / 主持',userChoices(c)),select('recorderId','记录员',userChoices(c,user=>array(user.roles).includes('recorder'))),checks('requiredDepartments','必须反馈的交接部门',departments(c),{help:'走查完成前，所有明确选中的部门均须对该材料快照留下反馈。'})],submit:'保存批次计划',onSubmit:async(values,revision)=>{await c.command(batch?'batch.update':'batch.create',{...(batch?{batchId:id}:{}),...values},revision);c.toast('批次计划已保存。');}});return;
  }
  if(action==='freeze-batch'){
    if(batchFreezeBlockers(batch,c.state).length){c.render();c.toast('冻结前还有待办理事项，请核对批次卡片。');return;}
    open(c,{key:`freeze:${id}`,title:'冻结本批次评审基线',transient:true,description:`批次：${batch.title}。冻结后保留材料及参与清单，后续版本应另行安排。`,fields:[select('confirmation','确认以当前清单开展评审',[{value:'confirmed',label:'我已核对当前材料、参与者和交接部门'}],{required:true,full:true})],submit:'冻结批次',onSubmit:async(_,revision)=>{await c.command('batch.freeze',{batchId:id},revision);c.toast('批次已冻结，可以记录部门反馈与走查覆盖。');}});return;
  }
  if(action==='batch-feedback'){
    open(c,{key:`feedback:${id}:${c.view.materialId}`,title:`记录${c.user.department}的交接反馈`,description:`针对当前材料快照：${c.materialName(c.view.materialId)}。可说明认可事项、分歧及需补充的证据；提交反馈不自动关闭问题。`,fields:[long('note','部门反馈',{required:true,rows:6})],submit:'提交部门反馈',onSubmit:async(values,revision)=>{await c.command('batch.feedback',{batchId:id,materialId:c.view.materialId,...values},revision);c.toast('本部门对当前快照的反馈已保存。');}});return;
  }
  if(action==='batch-coverage'){
    const materialId=c.view.materialId;
    const {coverage,completionBlocker,missing}=walkCoverageReadiness(batch,materialId);
    const statuses=[{value:'pending',label:'待走查'},{value:'needs_followup',label:'待续议'},{value:'reviewed',label:'已完成走查',disabled:Boolean(completionBlocker)}];
    const description=completionBlocker?`${completionBlocker}${missing.length?` 待反馈部门：${missing.join('、')}。`:''} 补齐条件后重新打开本窗口可标记完成。`:'填写结论并选择走查状态。已登记的问题可继续跟进。';
    let reviewed;
    open(c,{
      key:`coverage:${id}:${materialId}`,title:'记录材料走查覆盖',description,trackInitialValues:true,
      values:{status:coverage.status||'pending',note:coverage.note||''},
      fields:[select('status','走查状态',statuses,{required:true,full:true}),long('note','走查结论 / 待续议内容',{required:true,rows:5})],
      submit:'记录走查覆盖',onSubmit:async(values,revision,initial)=>{
        const currentBatch=c.state.batches.find(item=>item.id===id);
        if(!currentBatch?.materialIds.includes(materialId))throw new Error('此材料已移出批次，当前输入仍保留。');
        const latest=walkCoverageReadiness(currentBatch,materialId);
        if(values.status==='reviewed'&&latest.completionBlocker)throw new Error(latest.completionBlocker);
        const current={status:latest.coverage.status||'pending',note:latest.coverage.note||''};
        const baseline=reviewed||initial;
        if(current.status!==baseline.status||current.note!==baseline.note){
          reviewed=current;
          const error=new Error(`走查记录已有更新。最新状态：${statuses.find(item=>item.value===current.status)?.label||'待核对'}。最新结论：${current.note||'未填写'}。你的输入已保留，请核对后再保存。`);
          error.status=409;throw error;
        }
        await c.command('batch.coverage',{batchId:id,materialId,...values},revision);
        c.toast('走查覆盖记录已保存。');
      }
    });return;
  }
  if(action==='edit-opinion'){c.setOpinion(opinion);return;}
  if(action==='opinion-history'){
    const entries=array(opinion.history).map((entry,index)=>`${index+1}. ${dateTime(entry.at||entry.createdAt)}\n修改前：${entry.before?.text??entry.beforeText??(typeof entry.before==='string'?entry.before:'未记录文本')}\n修改后：${entry.after?.text??entry.afterText??(typeof entry.after==='string'?entry.after:'未记录文本')}`).join('\n\n');
    open(c,{key:`history:${id}`,title:'已提交意见的更正历史',description:'历史文本仅供核对，本窗口不修改意见。',values:{history:entries||'尚无更正历史。'},fields:[long('history','原文与更正记录',{rows:14,readOnly:true})],submit:'关闭历史',onSubmit:async()=>{}});return;
  }
  if(action==='create-issue'||action==='issue-from-opinion'){
    open(c,{key:`issue:${id||'new'}`,title:'形成评审问题',description:'问题由记录员整理。引用意见保留原文；跟进人和期限允许暂不指定，复核人及涉及制度决定的有权主体必须明确。',fields:issueFields(c),values:opinion?{description:opinion.text,materialIds:[opinion.materialId],opinionIds:[opinion.id]}:{},submit:'创建问题',onSubmit:async(values,revision)=>{requireIssueReviewCoverage(c,values.affectedDepartments,values.reviewerIds);await c.command('issue.create',values,revision);c.toast('问题已建立，并保留与原意见的关联。');}});return;
  }
  if(action==='assign-issue'){
    openIssue(c,id,{key:`assign:${id}`,title:'调整跟进与复核安排',description:'更改复核人将保留原决定的历史，并重置本轮复核。未确定的跟进人和期限可以留空。',fields:issueFields(c,issue),values:issue,submit:'保存安排',onSubmit:async(values,revision)=>{requireIssueReviewCoverage(c,issue.affectedDepartments,values.reviewerIds);await c.command('issue.assign',{issueId:id,...values},revision);c.toast('跟进与复核安排已保存。');}});return;
  }
  if(action==='respond-issue'){
    openIssue(c,id,{key:`respond:${id}`,title:'提交跟进答复与证据',description:'提交后进入指定人复核。新的答复会重置本轮复核意见和有权主体依据，旧记录保留在历史中。',fields:[long('text','跟进结果 / 建议处理',{required:true,rows:5}),long('evidence','证据说明与可定位的来源',{required:true,rows:4,placeholder:'说明材料名称、版本、位置或实际核对记录，不填写敏感凭据。'})],submit:'提交复核',onSubmit:async(values,revision)=>{await c.command('issue.respond',{issueId:id,...values},revision);c.toast('答复与证据已提交指定人复核。');}});return;
  }
  if(action==='review-issue'){
    openIssue(c,id,{key:`review:${id}`,title:'记录指定复核人的决定',description:'各指定复核人分别表达意见。全部同意后才可能关闭；制度问题还需已指定有权主体的决定依据。',fields:[select('decision','复核决定',[{value:'approve',label:'同意关闭'},{value:'return',label:'退回补充'}],{required:true,full:true}),long('note','复核理由 / 退回要求',{required:true,rows:6})],submit:'提交复核决定',onSubmit:async(values,revision)=>{await c.command('issue.review',{issueId:id,...values},revision);c.toast('复核决定已记录。');}});return;
  }
  if(action==='authority-issue'){
    openIssue(c,id,{key:`authority:${id}`,title:'记录有权主体的决定依据',description:'仅记录本问题已指定有权主体的决定依据；不能代替其他指定复核人的复核。此处为本地演练身份。',fields:[long('evidence','决定内容、依据与可追溯出处',{required:true,rows:7})],submit:'记录决定依据',onSubmit:async(values,revision)=>{await c.command('issue.authority',{issueId:id,...values},revision);c.toast('有权主体的决定依据已留痕。');}});return;
  }
  if(action==='reopen-issue'){
    openIssue(c,id,{key:`reopen:${id}`,title:'重新打开已关闭问题',description:'保留此前关闭与复核历史，并清空本轮复核决定，重新进入跟进。',fields:[long('reason','重新打开的原因与新证据',{required:true,rows:6})],submit:'重新打开问题',onSubmit:async(values,revision)=>{await c.command('issue.reopen',{issueId:id,...values},revision);c.toast('问题已重新打开，原关闭历史继续保留。');}});return;
  }
  if(action==='create-observation'||action==='edit-observation'){
    const existing=c.state.observations.find(item=>item.id===id);
    open(c,{key:`observation:${id||'new'}`,title:existing?'修订系统性问题观察':'记录系统性问题观察',description:'保留不确定性，分别记录观察事实、解释假设、支持证据和反例。此记录为后续建模准备，不生成自动因果结论。',values:existing||{},fields:[text('title','观察主题',{required:true,full:true}),checks('materialIds','关联流程材料',materialChoices(c)),checks('issueIds','关联评审问题',c.state.issues.map(item=>({value:item.id,label:item.title}))),long('phenomenon','观察到的现象',{placeholder:'反复出现的情况是什么？涉及哪些业务对象？'}),long('timePattern','随时间的变化',{placeholder:'何时开始、持续多久、上升下降或周期变化；没有数据时明确说明。'}),long('variables','变量、单位与可测量口径'),long('hypotheses','解释假设与边界'),long('feedback','可能的反馈关系及方向'),long('delays','时滞与等待环节'),long('evidence','支持证据及来源'),long('counterEvidence','反例、反证与竞争解释'),long('nextEvidence','下一步取证或验证办法')],submit:'保存观察',onSubmit:async(values,revision)=>{await c.command('observation.save',{...(existing?{observationId:id}:{}),...values},revision);c.toast('系统性观察已保存。');}});
  }
}
