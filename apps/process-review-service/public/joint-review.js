import {escape as e, array, heading, button as b, empty, dateTime, openDialog} from './ui.js';
import {isCurrentMaterial, materialSource} from './material-scope.js';
import {materialWalkEdits, projectWalkDocument} from './walk-edits.js';

const stages = {preparing:'准备中',ready:'待到场核对',reviewing:'当前评审',voting:'本轮表决中',approved:'全员赞成，待固化',passed:'已固化，待交接',handover:'待实际接收',completed:'已实际接收'};
const kinds = {verification:'内部核实',preread:'承接预读',informed:'知情及确认权限准备'};
const issueKinds = {definition:'普通定义 / 说明',crud:'CRUD冲突',raci:'RACI冲突',responsibility:'数据认责冲突',origin:'动作起点归口变更'};
const speech = {introduction:'归口介绍',receiving:'承接说明',question:'顺时针质疑（无质疑可跳过）',pmo:'PMO最后意见'};
const ballotNames = {agree:'明确赞成',oppose:'反对',abstain:'未明确赞成',conditional:'仍附本轮未解条件'};
const opts = values => Object.entries(values).map(([value,label]) => ({value,label}));
const long = (name,label,extra={}) => ({name,label,type:'textarea',required:true,full:true,...extra});
const select = (name,label,choices,extra={}) => ({name,label,type:'select',choices,required:true,...extra});
const checks = (name,label,choices,extra={}) => ({name,label,type:'checks',choices,full:true,...extra});
const people = (c,ids=c.state.users.map(x=>x.id)) => ids.map(id=>({value:id,label:c.userName(id)}));
const find = (items,id) => array(items).find(x=>x.id===id);
const current = item => find(item.versions,item.currentVersionId);
const prep = item => find(item.preparations,item.currentPreparationId);
const resolved = (item,issue) => issue.resolutions.some(r=>r.id===issue.activeResolutionId&&r.versionId===item.currentVersionId);
const canOrganize = c => c.role('pmo');
const json = value => JSON.stringify(value,null,2);
function removePaths(before,after,pointer='') {
  if(!before||typeof before!=='object'||!after||typeof after!=='object')return before&&typeof before==='object'?[pointer]:[];
  return Object.keys(before).flatMap(key=>!Object.hasOwn(after,key)?[`${pointer}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`]:removePaths(before[key],after[key],`${pointer}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`));
}
function section(title,content) {return `<section class="panel section-spacer"><header class="panel-header"><h2>${e(title)}</h2></header><div class="panel-body">${content}</div></section>`;}
const paragraph = value => `<p class="text-preserve">${e(value)}</p>`;
const action = (label,name,id,disabled=false) => b(label,`joint-${name}`,id,{small:true,disabled});
const currentRecords = item => item.preparationRecords.filter(r=>r.versionId===item.currentVersionId&&r.preparationId===item.currentPreparationId);
const scopeChoices = item => [{value:'',label:'全文及全部关联内容'},{value:'/process',label:'流程定义与边界'},{value:'/behaviors',label:'业务步骤及办理职责'},{value:'/flow_relations',label:'流程关系与交接'},...array(current(item).document.data_objects).map((d,i)=>({value:`/data_objects/${i}`,label:'数据对象：'+(d.data_name||`第${i+1}项`)})),{value:'/forms',label:'相关表单'},{value:'/terms',label:'相关术语'}];

export function renderJointReviews(c) {
  const items=array(c.state.jointReviews),item=find(items,c.view.jointReviewId),organizer=canOrganize(c);
  const top=heading('联合评审事项','每项流程连续办理；准备、到齐、即时处理、同版本全员表决及实际接收分别留痕。',organizer?b('制定并发出安排','joint-create','',{primary:true}):'');
  const list=section('连续事项',items.map(i=>`<button class="button joint-item ${item?.id===i.id?'primary':''}" data-action="joint-open" data-id="${e(i.id)}">${e(i.title)} · ${e(stages[i.stage])}</button>`).join('')||empty('尚未制定评审安排','PMO从本轮已有材料明确选定参评流程；不会自动导入联合评审管理流程JSON。'));
  if(!item)return top+list;
  const v=current(item),s=find(item.sessions,item.currentSessionId),required=item.plan.requiredIds.includes(c.user.id),p=prep(item);
  const next=s?.sequence?.[s.cursor];
  const summary=section('当前安排与明确版本',`<div class="joint-facts"><span><strong>阶段</strong>${e(stages[item.stage])}</span><span><strong>归口主体</strong>${e(c.userName(item.plan.ownerId))}</span><span><strong>当前版本</strong>第${item.versions.indexOf(v)+1}版 · ${e(v.digest.slice(0,12))}</span><span><strong>场次 / 表决</strong>${item.sessions.filter(x=>x.started).length} / ${item.rounds.length}轮</span></div>${paragraph(item.plan.scope)}${paragraph(item.plan.schedule)}<details><summary>启动依据、准备及权限要求、规定人员</summary>${paragraph(item.basis)}${paragraph(item.plan.requirements)}${paragraph('应到：'+item.plan.requiredIds.map(c.userName).join('、'))}${paragraph('表决全员：'+item.plan.voterIds.map(c.userName).join('、'))}</details><div class="button-row">${action('查看精确当前内容','content',item.id)}${action('查看版本与办理记录','history',item.id)}${['preparing','reviewing'].includes(item.stage)&&required?action('修订当前材料','revise',item.id):''}${['preparing','reviewing'].includes(item.stage)&&organizer?action('明确关联另一材料版本','select-version',item.id):''}${['approved','passed','handover','completed'].includes(item.stage)&&organizer?action('在同一事项续评','resume',item.id):''}</div><p class="subtle-text">当前版本独立保存；共享走查后续改动须在此明确纳入。合成身份及权限依据仅供隔离演练。</p>`);
  let body='';
  if(['preparing','ready'].includes(item.stage)) {
    const gaps=p.checks.at(-1)?.gaps||[];
    body+=section('会前准备',`<div class="button-row">${item.stage==='preparing'&&(required||item.plan.verifierIds.includes(c.user.id))?action('记录本人实际准备','prepare',item.id):''}${item.stage==='preparing'&&c.user.id===item.plan.ownerId?action('汇总提交拟评材料','submit',item.id):''}${item.stage==='preparing'&&organizer?action('检查准备及定向缺项','check',item.id)+action('补明PMO安排','amend-plan',item.id):''}${item.stage==='preparing'&&organizer?action('有据复用未受影响准备','reuse-prepare',item.id):''}${item.stage==='ready'&&organizer?action('核对本次实际到场','attendance',item.id)+action('准备有缺项，继续补齐','reopen-preparation',item.id):''}</div>${paragraph('核实经办：'+item.plan.verifierIds.map(c.userName).join('、')+'；承接预读：'+(item.plan.receiverIds.map(c.userName).join('、')||'安排已明确无本次承接预读主体'))}${gaps.length?`<ul>${gaps.map(g=>`<li>${e(g.label)}：${e(c.userName(g.subjectId))}尚未取得</li>`).join('')}</ul>`:''}<ul>${currentRecords(item).map(r=>`<li>${e(kinds[r.kind])} · ${e(c.userName(r.subjectId))} · ${r.reusedFromId?'有据复用原记录':'本人实际记录'}${r.unresolved?' · 含有据未决事项':''}</li>`).join('')}</ul>${p.checks.length?paragraph(p.checks.at(-1).note):''}${item.sessions.filter(x=>!x.started&&x.preparationId===p.id).map(x=>paragraph('未开评：尚缺 '+item.plan.requiredIds.filter(id=>!x.presentIds.includes(id)).map(c.userName).join('、'))).join('')}`);
  }
  if(item.stage==='reviewing') {
    body+=section('当前评审内办理',`${next?paragraph('下一环节：'+speech[next.kind]+' · '+c.userName(next.actorId)):paragraph('现场介绍及各方意见已完成；修订与处理后须汇总当前内容。')}<div class="button-row">${next?.actorId===c.user.id?action('记录本环节实际说明','speak',item.id):''}${organizer&&!next?action('汇总当前核对与影响','summary',item.id):''}${required?action('登记实际问题或冲突','issue',item.id):''}${required?action('确认同一当前版本','confirm',item.id):''}${organizer?action('检查条件并开启新一轮表决','vote-open',item.id):''}</div>${s?.summary?paragraph(s.summary.note):''}`);
    body+=section('逐项问题、决定、同步及即时确认',item.issues.map(issue=>`<article class="joint-issue"><h3>${e(issue.title)} · ${e(issueKinds[issue.kind])} · ${resolved(item,issue)?'当前版本已闭合':'待当前评审处理'}</h3>${paragraph(issue.description)}${paragraph('位置：'+issue.location+'；回应：'+issue.responderIds.map(c.userName).join('、'))}${issue.decisionMakerId?paragraph('本问题决定主体：'+c.userName(issue.decisionMakerId)+'；依据：'+issue.authorityBasis):''}<div class="button-row">${organizer&&issue.classificationRequired?action('明确带入问题类别与权限','classify',issue.id):''}${issue.responderIds.includes(c.user.id)?action('业务方当场说明','statement',issue.id):''}${(issue.kind==='definition'?issue.responderIds.includes(c.user.id):issue.decisionMakerId===c.user.id)?action('记录有效处理决定','decide',issue.id):''}${organizer?action('核对当前模型与关联影响','sync',issue.id):''}${[...issue.responderIds,issue.decisionMakerId].includes(c.user.id)?action('本方即时确认','issue-confirm',issue.id):''}${organizer&&issue.resolutions.length&&!resolved(item,issue)?action('有据复用原闭合结果','reuse-issue',issue.id):''}${organizer&&issue.kind==='origin'&&resolved(item,issue)&&!item.originReturns.some(r=>r.decisionId===find(issue.resolutions,issue.activeResolutionId)?.decision.id)?action('按本次决定返回受影响准备','origin-return',issue.id):''}</div><details><summary>查看原意见和历次处理</summary><pre class="joint-json">${e(json({statements:issue.statements,decisions:issue.decisions,syncs:issue.syncs,confirmations:issue.confirmations,resolutions:issue.resolutions}))}</pre></details></article>`).join('')||empty('没有已登记问题','有实际问题先登记，再绑定该问题处理；不虚构问题。'));
  }
  const round=find(item.rounds,item.currentRoundId);
  if(item.stage==='voting')body+=section('本轮逐人逐版本表决',`${paragraph('仅本轮完整范围的每人明确赞成才通过。未取得表态、沉默、旧轮票或附未解条件均不算赞成。')}<ul>${round.voterIds.map(id=>`<li>${e(c.userName(id))}：${e(ballotNames[round.ballots.find(b=>b.actorId===id)?.choice]||'本轮尚未明确表态')}</li>`).join('')}</ul><div class="button-row">${round.voterIds.includes(c.user.id)&&!round.ballots.some(b=>b.actorId===c.user.id)?action('本人对本轮当前版本表态','ballot',item.id):''}${organizer?action('记录本轮结果','vote-finish',item.id):''}</div>`);
  if(item.stage==='approved'&&organizer)body+=section('精确通过成果',paragraph('本轮全员明确赞成；保存精确内容、确认、问题处理及本轮投票后才能交接。')+action('固化精确通过包','freeze',item.id));
  if(item.packages.length)body+=section('已固化成果与实际接收',item.packages.map(pack=>`<article class="joint-issue"><strong>通过包 ${item.packages.indexOf(pack)+1} · ${dateTime(pack.at)} · ${e(pack.version.digest.slice(0,12))}</strong>${paragraph('保存位置：'+pack.storageLocation+'；保管责任：'+pack.custodian)}${action('查看该精确通过包','package',pack.id)}${organizer&&item.stage==='passed'&&item.activePackageId===pack.id?action('登记明确后续事项','plan-action',item.id)+action('交接通过成果及后续事项','send',item.id):''}</article>`).join('')+item.handovers.map(h=>`<article class="joint-issue">${paragraph(h.note)}<ul>${h.recipientIds.map(id=>`<li>${e(c.userName(id))}：${h.receipts.some(r=>r.actorId===id)?'已实际接收':'待实际接收'}</li>`).join('')}</ul>${h.id===item.currentHandoverId&&item.stage==='handover'&&h.recipientIds.includes(c.user.id)&&!h.receipts.some(r=>r.actorId===c.user.id)?action('确认本人实际接收','receive',item.id):''}${h.actions.map(a=>`<div>${paragraph(a.description+'；应形成：'+a.expectedResult+'；状态：'+(a.status==='pending'?'后续行动尚未完成':'已记录实际完成'))}${a.status==='pending'&&a.responsibleIds.includes(c.user.id)?action('记录后续实际完成','action-complete',a.id):''}</div>`).join('')}</article>`).join('')+paragraph('意见已处理、成果已接收与后续治理或系统实施完成分别记录。'));
  return top+list+summary+body;
}

export async function runJointAction(actionName,id,c) {
  if(!actionName.startsWith('joint-'))return false;
  const actionNameOnly=actionName.slice(6),items=array(c.state.jointReviews);
  if(actionNameOnly==='open'){c.view.jointReviewId=id;await c.navigate('joint');return true;}
  const item=find(items,c.view.jointReviewId),v=item&&current(item),organizer=canOrganize(c);
  const open=(name,title,fields,submit,values={},extra={})=>openDialog({key:`joint:${c.view.jointReviewId||'new'}:${name}:${id}`,title,fields,values,userId:c.user.id,baseRevision:c.state.revision,getRevision:()=>c.state.revision,onSubmit:submit,onSaved:()=>{
    const trigger=[...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===actionName&&el.dataset.id===(id||''));
    (trigger||document.querySelector('.joint-item')||document.querySelector('.page-heading button'))?.focus({preventScroll:true});
  },...extra});
  const command=(name,payload,revision)=>c.command(`joint.${name}`,{reviewId:item?.id,versionId:v?.id,...payload},revision);
  const note=(name,title,payload={})=>open(name,title,[long('note','实际内容及依据')],(values,revision)=>command(name,{...payload,...values},revision));
  const recordChoices=records=>records.map(r=>({value:r.id,label:`${kinds[r.kind]} · ${c.userName(r.subjectId)} · ${dateTime(r.at)}${r.reusedFromId?'（复用原记录）':''}`}));
  const inspect=(name,title,value)=>open(name,title,[long('content','保留的精确内容',{readOnly:true})],()=>{}, {content:json(value)},{transient:true,submit:'关闭'});
  if(actionNameOnly==='create'){
    open('create','制定并发出一项流程的评审安排',[
      {name:'title',label:'连续事项名称',required:true,full:true},select('materialId','明确参评材料身份',c.state.materials.filter(m=>isCurrentMaterial(c.state,m.id)).map(m=>({value:m.id,label:`${m.name} · ${materialSource(m)}`})),{full:true}),
      long('basis','启动、职责及表决范围依据'),long('scope','关联范围及归口、承接边界'),long('schedule','准备检查、预读及评审的实际时点安排'),long('requirements','材料、预读、知情及有效确认权限要求'),
      select('ownerId','归口汇总主体',people(c)),checks('verifierIds','归口负责人组织的实际核实经办人',people(c)),checks('receiverIds','本次承接预读主体（无承接时在范围中说明）',people(c)),checks('requiredIds','明确规定应到范围',people(c)),checks('voterIds','明确规定的全员表决范围',people(c))
    ],async(values,revision)=>{await c.command('joint.create',values,revision);c.view.jointReviewId=c.state.jointReviews.at(-1).id;await c.navigate('joint');}, {},{description:'一项参评流程保留一个连续事项。请按实际安排选择人员和权限依据，不从职务、来源目录或角色名推定。'});return true;
  }
  if(!item)throw new Error('请先打开连续评审事项。');
  switch(actionNameOnly){
    case 'amend-plan': open('amend-plan','补明范围、时点及准备要求',[long('scope','补明关联范围'),long('schedule','补明实际时点安排'),long('requirements','补明材料、预读及确认权限要求'),checks('affectedIds','受影响准备主体（其余结果有据复用）',people(c,[...new Set([...item.plan.requiredIds,...item.plan.verifierIds])])),long('note','补明依据与受影响要求')],(values,revision)=>command('plan.amend',values,revision),{scope:item.plan.scope,schedule:item.plan.schedule,requirements:item.plan.requirements});break;
    case 'reopen-preparation': note('preparation.reopen','记录准备缺项并继续补齐');break;
    case 'content': inspect('content','事项明确当前版本',v);break;
    case 'history': inspect('history','版本、准备、场次、投票及操作追溯',{versions:item.versions,preparations:item.preparations,preparationRecords:item.preparationRecords,submissions:item.submissions,sessions:item.sessions,confirmations:item.confirmations,rounds:item.rounds,events:item.events});break;
    case 'package': inspect('package','不可覆盖的精确通过包',find(item.packages,id));break;
    case 'prepare': {
      const available=Object.entries({verification:item.plan.verifierIds,preread:item.plan.receiverIds,informed:item.plan.requiredIds}).filter(([,people])=>people.includes(c.user.id)).map(([value])=>({value,label:kinds[value]}));
      open('prepare','记录本人实际准备',[select('kind','准备内容',available),checks('scopePaths','实际核对范围',scopeChoices(item)),long('note','已实际核实或预读内容、接收条件及依据'),long('unresolved','未决事项（无则留空）',{required:false}),{name:'position',label:'未决事项明确位置'},select('responderId','未决事项回应主体',people(c,item.plan.requiredIds),{required:false})],(values,revision)=>command('preparation.record',{...values,scopePaths:values.scopePaths},revision),{scopePaths:['']});break;
    }
    case 'submit': open('submit','归口汇总提交当前版本',[checks('recordIds','明确选定本次实际内部核实说明',recordChoices(currentRecords(item).filter(r=>r.kind==='verification'))),long('note','已核实内容、未决事项及本次提交说明')],(values,revision)=>command('submit',values,revision));break;
    case 'check': open('check','检查实际准备及缺项',[checks('recordIds','本次有效准备记录',recordChoices(currentRecords(item))),long('note','核对内容、缺项责任方及补齐要求')],(values,revision)=>command('preparation.check',values,revision),{}, {submit:'按实际记录检查'});break;
    case 'reuse-prepare': open('reuse-prepare','有据复用未受影响的原准备',[select('recordId','原记录（保留原版本和实际主体）',recordChoices(item.preparationRecords)),long('note','未受影响范围及有效复用依据')],(values,revision)=>command('preparation.reuse',values,revision));break;
    case 'attendance': {
      const candidates=item.plan.requiredIds.filter(id=>id!==item.organizerId);
      open('attendance','核对实际到场与现场顺时针座次',[checks('presentIds','本次实际到场（缺一人不开始）',people(c,item.plan.requiredIds)),...candidates.map(userId=>select(`seat-${userId}`,`${c.userName(userId)}的质疑顺序`,candidates.map((_,i)=>({value:String(i+1),label:`顺时针第${i+1}位`})),{required:false})),long('note','到场、负责人范围与实际座位依据')],(values,revision)=>{
        const seats=candidates.filter(userId=>values[`seat-${userId}`]).map(userId=>({id:userId,order:Number(values[`seat-${userId}`])}));
        if(new Set(seats.map(s=>s.order)).size!==seats.length)throw new Error('实际座位顺序不可重复。');
        return command('attendance',{presentIds:values.presentIds,questionerIds:seats.sort((a,b)=>a.order-b.order).map(s=>s.id),note:values.note},revision);
      });break;
    }
    case 'speak': {const next=find(item.sessions,item.currentSessionId)?.sequence[find(item.sessions,item.currentSessionId).cursor];note('meeting.speak',speech[next?.kind]||'现场实际说明',{kind:next?.kind});break;}
    case 'summary': note('summary','汇总当前问题、处理及关联影响');break;
    case 'revise': {
      open('revise','修订明确当前材料（实际改变才产生新版本）',[long('documentText','当前材料完整JSON（保留未知字段）',{rows:12,status:values=>{try{const doc=JSON.parse(values.documentText),removed=removePaths(v.document,doc);return removed.length?'实际删除位置：'+removed.join('、'):'未删除原字段；请核对全部实际变化及关联影响。';}catch{return '请输入有效JSON，原输入保留。';}}}),long('reason','实际变化、业务依据及关联影响'),checks('affectedIds','准备阶段受影响的准备主体',people(c,item.plan.requiredIds)),checks('acknowledged','修订内容核对',[{value:'yes',label:'已核对修改及删除位置，按本次明确修改保存新版本'}])],(values,revision)=>{
        if(!values.acknowledged.includes('yes'))throw new Error('请先核对实际改动及删除位置。');
        const document=JSON.parse(values.documentText);return command('version.revise',{document,beforeDigest:v.digest,reason:values.reason,removedPaths:removePaths(v.document,document),affectedIds:values.affectedIds},revision);
      },{documentText:json(v.document)});break;
    }
    case 'select-version': {
      open('select-version','明确关联已有材料或纳入共享走查修订',[select('materialId','明确选择来源材料',c.state.materials.filter(m=>isCurrentMaterial(c.state,m.id)).map(m=>({value:m.id,label:`${m.name} · ${materialSource(m)}`})),{full:true}),long('reason','同一事项连续关系、版本变化及影响'),checks('affectedIds','受影响的准备主体',people(c,item.plan.requiredIds))],async(values,revision)=>{
        const material=await c.material(values.materialId),document=projectWalkDocument(material.document,materialWalkEdits(c.state.audit,values.materialId));
        const removed=removePaths(v.document,document);
        if(removed.length)throw new Error('所选内容删除了原字段。请使用“修订当前材料”逐项核对删除位置后保存。');
        return command('version.select',{...values,beforeDigest:v.digest,removedPaths:[]},revision);
      },{materialId:v.materialId});break;
    }
    case 'issue': open('issue','登记实际问题并明确位置和回应主体',[{name:'title',label:'问题标题',required:true,full:true},long('description','事实、分歧及依据'),long('location','明确版本内位置'),select('kind','问题类别',opts(issueKinds)),checks('sourceOpinionIds','明确引用本事项已提交原意见（可不选）',c.state.opinions.filter(o=>o.status==='submitted'&&item.materialIds.includes(o.materialId)).map(o=>({value:o.id,label:c.userName(o.authorId)+' · '+o.text}))),checks('sourceLegacyIssueIds','明确引用原问题台账记录（其状态不代替本次闭合）',c.state.issues.filter(i=>i.materialIds.some(id=>item.materialIds.includes(id))).map(i=>({value:i.id,label:i.title}))),checks('responderIds','相关业务回应及确认主体',people(c,item.plan.requiredIds)),select('decisionMakerId','实质冲突的有权决定主体',people(c,item.plan.requiredIds),{required:false}),long('authorityBasis','本问题实际权限依据（实质冲突必填）',{required:false}),checks('scopePaths','受影响内容范围',scopeChoices(item))],(values,revision)=>command('issue.register',{...values,scopePaths:values.scopePaths},revision),{scopePaths:['']});break;
    case 'statement': note('issue.statement','相关业务方当场说明',{issueId:id});break;
    case 'classify': open('classify','明确带入问题类别及实际权限',[select('kind','实际问题类别',opts(issueKinds)),checks('responderIds','相关业务回应主体',people(c,item.plan.requiredIds)),select('decisionMakerId','实质冲突有权决定主体',people(c,item.plan.requiredIds),{required:false}),long('authorityBasis','本问题实际有效权限依据',{required:false})],(values,revision)=>command('issue.classify',{issueId:id,...values},revision),{responderIds:find(item.issues,id).responderIds});break;
    case 'decide': {
      const issue=find(item.issues,id);
      open('decide','按本问题权限记录有效处理决定',[long('note','澄清、修订或有据不采纳的结论及依据'),...(issue.kind==='origin'?[select('newOwnerId','有效决定明确的新归口主体',people(c,item.plan.requiredIds))]:[])],(values,revision)=>command('issue.decide',{issueId:id,...values},revision));break;
    }
    case 'sync': open('sync','核对决定与当前模型及关联影响',[long('modelNote','当前模型对应位置、表达及实际修订情况'),long('impactNote','业务接续、CRUD、RACI及认责关联影响')],(values,revision)=>command('issue.sync',{issueId:id,...values},revision));break;
    case 'issue-confirm': note('issue.confirm','本方对当前模型及认责即时确认',{issueId:id});break;
    case 'reuse-issue': {const issue=find(item.issues,id);open('reuse-issue','有据复用原问题闭合结果',[select('resolutionId','明确原闭合记录',issue.resolutions.map(r=>({value:r.id,label:dateTime(r.at)+' · '+r.versionId}))),long('note','原决定、模型及确认未受影响的依据')],(values,revision)=>command('issue.reuse',{issueId:id,...values},revision));break;}
    case 'origin-return': open('origin-return','按有效归口决定返回受影响准备',[checks('affectedIds','本次受影响准备主体',people(c)),checks('verifierIds','调整后的实际核实经办人',people(c)),checks('receiverIds','调整后的承接预读主体',people(c,item.plan.requiredIds)),long('note','有效归口变更、受影响安排及准备要求')],(values,revision)=>command('origin.return',{issueId:id,...values},revision),{verifierIds:item.plan.verifierIds,receiverIds:item.plan.receiverIds});break;
    case 'confirm': open('confirm','确认同一明确当前版本',[long('scope','本方业务、承接、认责或PMO核对范围'),long('note','已实际核对当前版本及本方有效确认依据')],(values,revision)=>command('confirm',values,revision),{}, {description:'PMO核对业务模型和后续信息化分析基础；不替业务方决定专业规则，不确定系统实现方案。'});break;
    case 'vote-open': note('vote.open','检查条件并开启全员新轮表决');break;
    case 'ballot': open('ballot','本人对本轮明确当前版本表态',[select('choice','本轮明确表态',opts(ballotNames)),long('note','未明确赞成时的理由及对应位置（明确赞成可留空）',{required:false}),long('condition','仍附本轮未解条件（存在时不得记赞成）',{required:false})],(values,revision)=>command('vote.cast',{roundId:item.currentRoundId,...values},revision));break;
    case 'vote-finish': note('vote.finish','记录实际表态或未取得表态并判断本轮结果');break;
    case 'freeze': open('freeze','固化精确通过内容及本轮确认',[long('storageLocation','通过成果保存位置'),long('custodian','保管责任'),long('note','实际通过内容、引用材料、确认及投票说明')],(values,revision)=>command('package.freeze',values,revision));break;
    case 'resume': note('resume','保留原通过包，在同一事项重新评审');break;
    case 'plan-action': open('plan-action','登记已明确的后续事项',[long('description','后续事项'),checks('responsibleIds','明确执行主体',people(c)),long('expectedResult','应形成结果'),long('authorityBasis','既有职责或本轮有效决定依据'),long('followup','配合、核验、有权决定及实际反馈安排')],(values,revision)=>command('action.plan',values,revision));break;
    case 'send': {const plans=array(item.actionPlans).filter(a=>a.packageId===item.activePackageId);open('send','交接通过成果及后续事项',[checks('recipientIds','实际接收责任方',people(c)),checks('actionIds','随成果交接的明确后续事项（无则不选）',plans.map(a=>({value:a.id,label:a.description+' · '+a.responsibleIds.map(c.userName).join('、')}))),long('note','发送内容、责任范围及无后续事项时的说明')],(values,revision)=>command('handover.send',{packageId:item.activePackageId,recipientIds:values.recipientIds,note:values.note,actions:plans.filter(a=>values.actionIds.includes(a.id))},revision));break;}
    case 'receive': note('handover.receive','确认本人已实际接收成果及承担内容',{handoverId:item.currentHandoverId});break;
    case 'action-complete': {const h=item.handovers.find(h=>h.actions.some(a=>a.id===id));note('action.complete','记录已接收后续事项的实际完成',{handoverId:h.id,actionId:id});break;}
    default: throw new Error('未识别的联合评审操作。');
  }
  return true;
}
