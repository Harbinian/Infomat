import {escape as e,array,short,tag,button as b,empty,heading,options,choices,field,dateTime,statusNames} from './ui.js';
import {classifyHandoffs,describeActor} from './handoffs.js';
import {walkEditFields, walkElementIndex} from './walk-edits.js';
import {batchFreezeBlockers, walkCoverageReadiness} from './review-status.js';
import {renderContextPage,renderMaterialContext} from './review-context.js';
import {scopedMaterials,materialSource,isCurrentMaterial} from './material-scope.js';
import {renderJointReviews} from './joint-review.js';

const materialOptions = c => c.state.materials.map(item=>({value:item.id,label:`${item.sourceDepartment||'待认领'} · ${short(item.name,52)} · ${materialSource(item).split(/[\\/]/).slice(-3).join('/')}`}));
const jsonMatrixLink=(materialId,pointer)=>`http://${globalThis.location?.hostname||'127.0.0.1'}:9992/matrix?material=${encodeURIComponent(materialId)}&pointer=${encodeURIComponent(pointer)}`;
const auditLabels={'review.scope_retain_only':'调整联合评审对象范围','walk.create':'新增走查元素','walk.remove':'移除走查元素','walk.edit':'保存走查修订','material.confirm':'确认材料版本','material.link_version':'关联后续版本','batch.create':'创建评审批次','batch.update':'调整批次计划','batch.freeze':'冻结批次','batch.feedback':'记录部门反馈','batch.coverage':'更新走查覆盖','batch.present':'更新投屏位置','opinion.save':'保存或提交意见','issue.create':'形成评审问题','issue.assign':'分派跟进与复核','issue.respond':'提交跟进及证据','issue.review':'记录复核决定','issue.authority':'记录有权主体依据','issue.reopen':'重新打开问题','observation.save':'保存系统性观察','materials.import':'导入材料','import':'导入材料'};
export function renderPage(c){
  const pageContext=c.view.route==='overview'?{...c,state:{...c.state,materials:scopedMaterials(c.state)}}:c;
  const content=({overview:overview,joint:renderJointReviews,materials:materials,history:materials,batches:batches,walk:walk,lineage:renderContextPage,opinions:myOpinions,issues:issues,observations:observations}[c.view.route]||overview)(pageContext);
  return c.view.route==='overview'?content+departmentCoverage(pageContext):content;
}
function departmentCoverage(c){
  const names=[...c.state.departments];
  if(c.state.materials.some(m=>!names.includes(m.sourceDepartment)))names.push('');
  const assigned=new Set(c.state.batches.flatMap(b=>b.materialIds||[]));
  const reviewed=new Set(c.state.batches.flatMap(b=>Object.entries(b.coverage||{}).filter(([,value])=>value.status==='reviewed').map(([id])=>id)));
  return `<section class="panel section-spacer" aria-label="提交部门材料覆盖"><header class="panel-header"><h2>逐部门核对材料覆盖</h2><span class="subtle-text">按本轮共享目录材料统计</span></header><div class="table-wrap"><table class="data-table"><thead><tr><th>提交目录</th><th>候选材料</th><th>已确认版本</th><th>已排入计划</th><th>已完成走查</th><th>核对提示</th></tr></thead><tbody>${names.map(name=>{const items=c.state.materials.filter(m=>name?m.sourceDepartment===name:!c.state.departments.includes(m.sourceDepartment));return `<tr><td>${e(name||'来源待明确')}</td><td>${items.length}</td><td>${items.filter(m=>m.status==='confirmed').length}</td><td>${items.filter(m=>assigned.has(m.id)).length}</td><td>${items.filter(m=>reviewed.has(m.id)).length}</td><td>${items.length?'版本与实际主责仍需逐项核对':'目录未提供材料，不能据此排除参会'}</td></tr>`;}).join('')}</tbody></table></div></section>`;
}

function materialProvenance(material,c){
  return `<details class="disclosure"><summary>查看材料来源与版本说明</summary><dl class="record-detail">${material.currentSource?field('本轮共享目录位置',material.currentSource.sourcePath):''}${field('导入时来源路径',material.sourcePath)}${field('版本确认理由',material.confirmationNote||'尚未确认')}${material.predecessorId?field('关联前序材料',c.materialName(material.predecessorId))+field('变化与续评说明',material.changeNote):field('版本关联','尚未指定前序快照')}</dl>${array(material.impactedIssueIds).length?`<p>需核对影响的问题：${array(material.impactedIssueIds).map(id=>e(c.state.issues.find(issue=>issue.id===id)?.title||'待定位问题')).join('；')}</p>`:''}</details>`;
}
function overview(c){
  const s=c.state,confirmed=s.materials.filter(item=>item.status==='confirmed').length;
  const reviewed=new Set(s.batches.flatMap(batch=>Object.entries(batch.coverage||{}).filter(([,value])=>value.status==='reviewed').map(([id])=>id))).size;
  const open=s.issues.filter(item=>item.status!=='closed').length,frozen=s.batches.filter(item=>item.status==='frozen').length;
  const steps=[['01','会前 · 核对材料',s.materials.length-confirmed,'份待确认','提交部门代表核对有效版本','materials'],['02','会前 · 安排批次',s.batches.filter(item=>item.status==='planned').length,'个计划待准备',`${frozen} 个批次已冻结，可进入走查`,'batches'],['03','会上 · 逐步走查',reviewed,'份已完成走查','核对职责、交接，记录意见与分歧','walk'],['04','会后 · 跟进问题',open,'项尚未关闭',`${s.issues.filter(item=>item.status==='awaiting_review').length} 项等待指定人复核`,'issues']];
  return heading('评审工作台','通过连续事项办理准备、评审、全员表决和实际接收；材料与批次入口继续供辅助走查。',b('进入联合评审事项','go-page','joint',{primary:true}))+`<section class="review-journey" aria-label="评审办理步骤">${steps.map(([number,title,count,unit,note,route])=>`<button class="journey-card" data-action="go-page" data-id="${route}"><span class="journey-heading"><span class="journey-number">${number}</span>${title}<span class="journey-arrow">→</span></span><span class="journey-count"><strong>${count}</strong>${unit}</span><span class="journey-note">${e(note)}</span></button>`).join('')}</section><section class="next-action" aria-label="当前身份操作提示"><div><strong>${c.role('representative')?'先核对本部门提交的材料':c.role('pmo')?'先核对材料覆盖，再编排评审批次':'从具体流程开始讨论'}</strong><p>${c.role('representative')?'打开材料、核对版本理由，再明确确认。':c.role('pmo')?'有效版本由提交部门代表确认；空计划补齐材料和参会安排后才能冻结。':'点击流程步骤查看职责和交接，意见可先保存为个人草稿。'}</p></div>${c.role('pmo')||c.role('representative')?b('查看待确认材料','pending-materials','',{primary:true}):b('浏览流程','browse-flow','',{primary:true})}</section><div class="overview-grid"><section class="panel"><header class="panel-header"><h2>按业务主题进入</h2><span class="subtle-text">${s.materials.length} 份第19周待联合评审材料</span></header><div class="panel-body"><div class="theme-tiles">${s.themes.map(theme=>{
    const items=s.materials.filter(item=>item.themeId===theme.id),done=items.filter(item=>item.status==='confirmed').length;
    const sources=[...new Set(items.map(item=>item.sourceDepartment).filter(Boolean))];
    return `<button class="theme-tile" data-action="theme-materials" data-id="${e(theme.id)}"><span class="theme-tile-heading"><span class="theme-code">${e(theme.id)}</span><strong>${e(theme.name)}</strong><span>↗</span></span><span class="theme-tile-count"><b>${items.length}</b> 份材料 <span>${items.length-done} 份待确认</span></span><span class="theme-sources">材料来自：${e(sources.slice(0,2).join('、')||'尚无材料')}${sources.length>2?` 等${sources.length}个目录`:''}</span></button>`;
  }).join('')}</div></div><div class="table-footnote">主题为候选分组，目录来源不代表业务主责。每份有效材料仍需明确评审批次。</div></section><aside class="list-cards"><section class="panel"><header class="panel-header"><h2>本轮材料</h2></header><div class="panel-body coverage-key"><strong>${confirmed}<span> / ${s.materials.length}</span></strong><p>份材料版本已确认</p><div class="progress"><span style="width:${s.materials.length?confirmed/s.materials.length*100:0}%"></span></div><p class="section-spacer">评审完成、问题关闭和正式发布分别记录。</p></div></section><section class="panel"><header class="panel-header"><h2>最近活动</h2></header><div class="panel-body activity-list">${s.audit.slice(-3).reverse().map(item=>`<div class="activity">${e(auditLabels[item.operation||item.type]||'评审记录更新')}<small>${e(c.userName(item.actorId||item.userId))} · ${dateTime(item.time||item.at||item.createdAt||item.timestamp)}</small></div>`).join('')||'<span class="subtle-text">尚无操作记录</span>'}</div></section></aside></div>`;
}
function materials(c){
  const page=c.view.route==='history'?'history':'materials',f=c.filters[page];
  const available=scopedMaterials(c.state,page==='history'?'history':'current');
  const departments=[...new Set(available.map(item=>item.sourceDepartment).filter(Boolean))];
  const rows=available.filter(item=>(!f.query||`${item.name} ${materialSource(item)} ${item.sourcePath}`.toLowerCase().includes(f.query.toLowerCase()))&&(!f.theme||(f.theme==='unassigned'?!item.themeId:item.themeId===f.theme))&&(!f.department||item.sourceDepartment===f.department)&&(!f.status||item.status===f.status));
  return heading(page==='history'?'历史快照':'材料与版本',page==='history'?'本轮清单之外的既有材料；原意见、修订和版本关联继续保留。':'各部门在第19周主动提交、等待联合评审的对象；仅显示已核对清单中的材料。',page==='materials'&&c.role('pmo')&&!c.state.reviewRound?.retainOnly?b('导入 JSON 材料','import','',{primary:true}):'')+`<div class="toolbar"><input type="search" placeholder="搜索流程名称或来源路径" value="${e(f.query)}" data-filter="${page}.query" aria-label="搜索材料"><select data-filter="${page}.theme" aria-label="筛选主题">${options([...choices(c.state.themes),{value:'unassigned',label:'待分组'}],f.theme,'全部主题')}</select><select data-filter="${page}.department" aria-label="筛选提交部门">${options(departments.map(value=>({value,label:value})),f.department,'全部提交目录')}</select><select data-filter="${page}.status" aria-label="筛选材料状态">${options([{value:'pending',label:'待代表确认'},{value:'confirmed',label:'已确认版本'}],f.status,'全部确认状态')}</select><span class="spacer"></span><span class="subtle-text" data-filter-region="count">${rows.length} 份材料快照</span></div><section class="panel" data-filter-region="results"><div class="table-wrap"><table class="data-table"><thead><tr><th>流程材料 / 来源</th><th>提交目录 / 材料所述归属</th><th>候选主题</th><th>版本状态</th><th>操作</th></tr></thead><tbody>${rows.map(item=>`<tr><td><div class="material-title">${e(item.name)}</div><span class="file-path">${e(materialSource(item))}</span>${array(item.warnings).length?`<span class="tag amber">${item.warnings.length} 项待核对</span>`:''}</td><td>${e(item.sourceDepartment||'待认领')}<br><span class="subtle-text">材料所述：${e(item.declaredDepartment||'未填写')}</span></td><td>${e(c.themeName(item.themeId))}</td><td>${tag(item.status)}${item.predecessorId?'<div class="subtle-text">已关联前序快照</div>':''}</td><td><div class="table-actions">${b('查看','open-material',item.id,{small:true})}${c.role('representative')&&(!item.sourceDepartment||item.sourceDepartment===c.user.department)?b('确认版本','confirm-material',item.id,{small:true}):''}${c.role('pmo')?b('关联版本','link-version',item.id,{small:true}):''}</div></td></tr>`).join('')}</tbody></table></div>${rows.length?'':empty('没有符合条件的材料','调整筛选，或由 PMO 导入本地 JSON 材料。')}<div class="table-footnote">确认版本须由提交部门代表明确操作。文件名、修改日期和“最新”字样不自动赋予有效性。</div></section>`;
}
function batches(c){
  return heading('批次计划','按主题组织跨部门讨论，并逐部门核对参与和交接覆盖。',c.role('pmo')?b('新建批次','create-batch','',{primary:true}):'')+`<div class="list-cards">${c.state.batches.map(batch=>{
    const count=Object.values(batch.coverage||{}).filter(item=>item.status==='reviewed').length;
    const assigned=array(batch.materialIds);
    const candidates=scopedMaterials(c.state).filter(item=>item.themeId===batch.themeId).length;
    const entry=assigned.length?b('进入走查','open-batch',batch.id,{small:true,primary:true})
      :candidates?b('浏览主题候选','browse-theme',batch.themeId,{small:true,primary:true})
        :b('浏览材料库','browse-all-materials','',{small:true});
    const canPlan=c.role('pmo')&&batch.status==='planned';
    const blockers=canPlan?batchFreezeBlockers(batch,c.state):[];
    const planning=canPlan
      ?b(assigned.length?'编辑计划':'选入材料','edit-batch',batch.id,{small:true})+b('冻结批次','freeze-batch',batch.id,{small:true,disabled:blockers.length>0}):'';
    const readiness=assigned.length&&blockers.length?`<div class="batch-blockers"><strong>冻结前待办理</strong><ul>${blockers.map(item=>`<li>${e(item)}</li>`).join('')}</ul></div>`:'';
    return `<article class="batch-card"><div class="batch-top"><div><h3>${e(batch.title)}</h3><span class="subtle-text">${e(c.themeName(batch.themeId))}</span></div><div class="button-row">${tag(batch.status)}${entry}${planning}</div></div><div class="batch-meta"><span>主讲 / 主持：${e(c.userName(batch.leadId))}</span><span>记录员：${e(c.userName(batch.recorderId))}</span><span>参与者 ${array(batch.memberIds).length} 人</span><span>批次材料 ${assigned.length} 份</span><span>已走查 ${count} 份</span></div><div class="batch-materials">${array(batch.requiredDepartments).map(dept=>`<span class="tag blue">${e(dept)}</span>`).join('')||'<span class="subtle-text">尚未明确必须反馈的交接部门</span>'}</div><div class="subtle-text">${assigned.map(id=>e(c.materialName(id))).join('；')||`本批次待选材 · 本主题有 ${candidates} 份候选材料` }</div>${readiness}</article>`;
  }).join('')||empty('尚无评审批次')}</div>`;
}
function walk(c){
  const s=c.state,v=c.view;
  const batch=s.batches.find(item=>item.id===v.batchId);
  const theme=v.walkThemeId?s.themes.find(item=>item.id===v.walkThemeId):null;
  const browsing=scopedMaterials(s,v.materialScope);
  const available=batch?array(batch.materialIds).map(id=>s.materials.find(item=>item.id===id)).filter(Boolean)
    :theme?browsing.filter(item=>item.themeId===theme.id):browsing;
  const browseAll=b(v.materialScope==='history'?'全部历史快照':'本轮全部材料','browse-all-materials','',{small:true});
  const batchesWithMaterials=s.batches.filter(item=>array(item.materialIds).length).map(item=>({value:item.id,label:item.title}));
  if(!v.materialId){v.materialId=available[0]?.id||'';if(v.materialId)v.materialScope=isCurrentMaterial(s,v.materialId)?'current':'history';}
  const material=available.find(item=>item.id===v.materialId);
  if(!material){
    const recovery=b('返回批次计划','go-batches')+(batch?b('浏览主题候选','browse-theme',batch.themeId):browseAll);
    const message=batch?'批次材料清单已变化，可返回批次计划或独立浏览主题候选。'
      :theme?'当前主题没有可浏览的候选材料。':'可从「材料与版本」导入或选择走查材料。';
    return heading('流程走查',message,recovery)+empty('当前没有可显示的走查材料');
  }
  const isLead=batch&&[batch.leadId,batch.recorderId].includes(c.user.id);
  const f=c.filters.walk;
  const departments=[...new Set(available.map(item=>item.sourceDepartment||'待认领'))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const words=f.query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  const matches=available.filter(item=>(!f.department||(item.sourceDepartment||'待认领')===f.department)&&words.every(word=>`${item.name} ${materialSource(item)} ${item.sourcePath} ${item.sourceDepartment||''}`.toLocaleLowerCase('zh-CN').includes(word)));
  const materialChoices=materialOptions({...c,state:{...s,materials:matches}});
  const includesCurrent=matches.some(item=>item.id===material.id);
  const materialPrompt=matches.length?(includesCurrent?null:'请选择匹配流程 · 当前流程仍保持打开'):'没有匹配的流程 · 请调整筛选';
  const picker=`<div class="walk-material-picker" aria-label="筛选走查材料"><label>提交部门<select data-filter="walk.department" aria-label="筛选走查提交部门">${options(departments.map(value=>({value,label:value})),f.department,'全部提交部门')}</select></label><label>搜索流程<input type="search" data-filter="walk.query" aria-label="搜索走查流程" placeholder="流程名称、来源文件或路径" value="${e(f.query)}"></label><label>走查材料<select id="walk-material" aria-label="当前走查材料" aria-describedby="walk-material-count" data-filter-region="walk-material-options">${materialPrompt===null?'':`<option value="" selected>${e(materialPrompt)}</option>`}${options(materialChoices,material.id,null)}</select></label>${b('清除筛选','clear-walk-filters','',{small:true})}<div class="walk-picker-summary"><span id="walk-material-count" class="walk-material-count" data-filter-region="walk-material-count" role="status">匹配 ${matches.length} / ${available.length} 份${includesCurrent?'':' · 当前流程不在筛选结果中，仍保持打开'}</span><span id="walk-batch-help">评审对象仅限各部门第19周主动提交材料；批次用于组织部门反馈与走查。</span></div></div>`;
  const buffer=c.opinionBuffer();
  const edits=c.walkEdits(material.id);
  if(v.compare)return heading('并排材料对照','对照目的、边界、步骤和完成标准；此处不合并、不改写材料。',b('返回走查','compare'))+`<div class="comparison">${['Left','Right'].map(side=>`<section class="panel"><div class="panel-header"><select data-compare="compare${side}" aria-label="${side==='Left'?'左':'右'}侧对照材料">${options(materialOptions({...c,state:{...s,materials:scopedMaterials(s,v.materialScope)}}),v[`compare${side}`],'选择对照材料')}</select></div><div class="panel-body" id="compare-${side.toLowerCase()}">${empty('正在载入材料')}</div></section>`).join('')}</div>`;
  return `<div class="walk-toolbar" aria-label="流程走查工具"><h1>流程走查</h1>${s.reviewRound?.retainOnly?'<span class="tag">第19周待联合评审材料</span>':batch?'<span class="tag">批次选材范围</span>':`<label class="walk-batch-field">材料范围<select id="walk-scope" aria-label="选择走查材料范围">${options([{value:'current',label:'本轮材料 · 第19周'},{value:'history',label:'历史快照'}],v.materialScope,null)}</select></label>`}<label class="walk-batch-field">评审批次<select id="walk-batch" aria-label="当前评审批次" aria-describedby="walk-batch-help">${options(batchesWithMaterials,v.batchId,theme?`主题候选 · ${theme.name}`:'独立浏览 · 不关联批次')}</select></label><div class="button-row"><label class="checkbox-label"><input type="checkbox" id="follow-presenter" ${v.follow?'checked':''} ${!batch?'disabled':''}>跟随主持投屏</label>${b('发布投屏位置','present','',{small:true,disabled:!isLead||batch?.status!=='frozen'})}${b('并排对照','compare','',{small:true})}${theme?browseAll:''}</div></div>${picker}<div class="walk-layout"><section class="panel graph-panel"><header class="panel-header"><div><h3>${e(material.name)}</h3><span class="subtle-text">${s.reviewRound?(material.currentSource?'本轮材料 · ':'历史快照 · '):''}${e(material.sourceDepartment||'待认领')} · ${e(c.themeName(material.themeId))} · ${e(statusNames[material.status])}${edits.length?` · 共享走查修订 ${edits.length} 次`:''}</span></div><div class="graph-actions">${c.role('participant')?b('新增步骤','create-walk-step','',{small:true,primary:true})+b('新增连线','create-walk-relation','',{small:true,disabled:true}):''}${b('−','graph-out','',{small:true})}${b('+','graph-in','',{small:true})}${b('定位入口','graph-entry','',{small:true,teal:true,disabled:true})}${b('清晰阅读','graph-readable','',{small:true})}${b('全图','graph-fit','',{small:true})}${b(v.projection?'退出投屏':'会议投屏','projection','',{small:true,teal:true})}</div></header><div class="graph-navigator"><label>定位步骤<select id="walk-step" aria-label="定位流程步骤"><option value="">正在载入步骤</option></select></label><label class="lane-select-label">查看部门<select id="walk-lane" aria-label="定位部门泳道"><option value="">全部部门泳道</option></select></label><div class="handoff-toolbar"><label class="checkbox-label"><input type="checkbox" id="handoff-focus" ${v.handoffFocus?'checked':''}>突出跨部门交接</label><span id="handoff-count"></span><span class="line-legend"><i class="cross"></i>跨部门 <i class="pending"></i>待核对</span></div></div><div id="graph" class="graph-container" aria-label="可缩放部门泳道流程图"></div><div id="graph-position" class="graph-position" role="status"></div><div id="graph-warning" class="graph-warning" hidden></div><div class="graph-caption">按部门泳道查看分工，归属不明的步骤列入“待核对”；箭头表示当前走查关系。点击连线查看两端职责并记录意见。</div>${materialProvenance(material,c)}${edits.length?`<details class="disclosure walk-history"><summary>共享走查修订（${edits.length} 次）</summary><div id="walk-revision-history"></div></details>`:""}<div class="scope-summary"><span><strong>版本</strong>${e(statusNames[material.status])}</span><span><strong>批次</strong>${batch?e(statusNames[batch.status]):theme?'主题候选 · 未关联批次':'独立浏览'}</span><span><strong>本快照走查</strong>${e(({pending:'待走查',needs_followup:'待续议',reviewed:'已完成走查'})[batch?.coverage?.[material.id]?.status]||(batch?'待走查':'未关联批次'))}</span></div></section><aside class="panel details-panel"><section id="walk-coverage" class="walk-coverage" aria-label="当前材料走查状态">${renderWalkCoverage(c)}</section><div class="detail-tabs">${[['node','步骤 / 关系'],['data','数据与表单'],['lineage','数据血缘'],['list','步骤列表'],['handoffs','交接清单']].map(([key,label])=>`<button class="detail-tab ${v.detailTab===key?'active':''}" data-detail-tab="${key}" aria-pressed="${v.detailTab===key}">${label}</button>`).join('')}</div><div id="walk-detail" class="detail-content">${empty('选择节点查看详情')}</div><div class="projection-note">会议投屏中 · 个人意见已收起，退出后可继续编辑。</div><section class="opinion-editor"><h3 id="opinion-editor-title">${buffer.opinionId?'更正 / 续写我的意见':'记录我的意见'}</h3><div id="editor-context" class="editor-context"></div><textarea id="opinion-text" aria-labelledby="opinion-editor-title" aria-describedby="editor-context" placeholder="记录事实、分歧、影响或需补充的证据；不确定内容请明确说明。">${e(buffer.text)}</textarea><div id="opinion-conflict">${renderOpinionConflict(c)}</div><div id="opinion-actions" class="button-row" style="margin-top:9px">${renderOpinionActions(c)}</div><div class="editor-context">草稿仅本人可见；提交后原文及更正历史均保留。</div></section></aside></div><section id="walk-discussion" class="panel section-spacer" data-revision="${s.revision}">${renderWalkDiscussion(c)}</section>`;
}
export function renderOpinionActions(c){
  const buffer=c.opinionBuffer(),submitted=c.state.opinions.some(item=>item.id===buffer.opinionId&&item.status==='submitted');
  const blocked=Boolean(buffer.conflict);
  return b('保存草稿','save-opinion','',{small:true,disabled:submitted||blocked})+
    b(submitted?'提交更正':'提交意见','submit-opinion','',{primary:true,small:true,disabled:blocked})+
    (buffer.opinionId?b('另写一条','new-opinion','',{small:true,disabled:buffer.dirty,title:'有未保存输入时，请先保存或提交。'}):'');
}
export function renderOpinionConflict(c){
  const {conflict}=c.opinionBuffer();
  if(!conflict)return '';
  return `<div class="opinion-conflict" role="alert"><strong>这条意见已有更新</strong><p>当前输入已保留。核对服务端最新内容后，可继续编辑并提交。</p>${conflict.text===undefined?'<p>当前无法读取该意见。</p>':`<p class="text-preserve">${e(conflict.text)}</p>${b('核对后继续编辑','acknowledge-opinion-conflict','',{small:true})}`}</div>`;
}
export function renderWalkDiscussion(c){
  const v=c.view;
  const opinions=c.state.opinions.filter(item=>item.materialId===v.materialId&&(!v.batchId||item.batchId===v.batchId));
  return `<header class="panel-header"><h3>当前材料的讨论记录 <span class="count">${opinions.length} 条</span></h3><span class="subtle-text">已提交意见供参与者查看</span></header><div class="panel-body opinion-list">${opinions.map(item=>`<article class="opinion-card"><div class="meta"><span>${e(c.userName(item.authorId))} · ${dateTime(item.createdAt)}</span>${tag(item.status)}</div><p>${e(item.text)}</p><div class="button-row">${item.authorId===c.user.id?b(item.status==='draft'?'继续编辑':'更正意见','edit-opinion',item.id,{small:true}):''}${c.role('recorder')&&item.status==='submitted'?b('据此形成问题','issue-from-opinion',item.id,{small:true}):''}${array(item.history).length?b('查看更正历史','opinion-history',item.id,{small:true}):''}</div></article>`).join('')||empty('暂时没有讨论记录','可先保存个人草稿，再决定是否提交。')}</div>`;
}
export function renderWalkCoverage(c){
  const assigned=c.state.batches.find(item=>item.materialIds.includes(c.view.materialId));
  const batch=assigned?.id===c.view.batchId?assigned:null;
  if(!batch){
    const destination=assigned?b('进入所属批次','open-assigned-batch',assigned.id,{small:true,primary:true}):b('查看批次计划','go-batches','',{small:true});
    const hint=assigned?`已选入「${assigned.title}」，进入批次可查看或办理走查。`:'将材料选入批次后，可记录完成状态。';
    return `<div class="walk-coverage-title"><strong>走查状态</strong><span class="tag">独立浏览</span></div><p>${e(hint)}</p>${destination}<details class="walk-coverage-help"><summary>查看完成条件</summary><ol><li>PMO 将材料选入批次并冻结批次。</li><li>指定部门对本材料提交反馈。</li><li>主持人或本批次记录员填写结论，选择“已完成走查”并保存。</li></ol></details>`;
  }
  const {coverage,required,missing,completionBlocker}=walkCoverageReadiness(batch,c.view.materialId);
  const isLead=[batch.leadId,batch.recorderId].includes(c.user.id);
  const canRespond=batch.status==='frozen'&&array(batch.memberIds).includes(c.user.id)&&c.role('representative');
  const status=coverage.status||'pending';
  const next=completionBlocker||(status==='reviewed'?'本材料已完成走查。':'指定部门反馈齐全，主持人或记录员可填写结论并标记完成。');
  return `<div class="walk-coverage-title"><strong>走查状态</strong>${tag(status,status==='pending'?'待走查':undefined)}</div><p>${e(next)}</p><div class="button-row">${canRespond?b('提交本部门反馈','batch-feedback',batch.id,{small:true}):''}${isLead?b('记录走查覆盖','batch-coverage',batch.id,{small:true,primary:batch.status==='frozen'&&!missing.length&&status!=='reviewed'}):''}</div>
    <details class="walk-coverage-help"><summary>查看完成条件</summary><ol><li>PMO 冻结批次。当前${batch.status==='frozen'?'已冻结':'未冻结'}。</li><li>指定部门对本材料提交反馈。${missing.length?`待反馈：${e(missing.join('、'))}。`:required.length?'已全部反馈。':'当前尚未指定反馈部门。'}</li><li>主持人或本批次记录员填写结论，选择“已完成走查”并保存。</li></ol><p>已登记的问题可继续跟进。</p>${coverage.note?`<p class="text-preserve">走查记录：${e(coverage.note)}</p>`:''}</details>`;
}
function walkEditControls(c,kind,index){
  if(index<0)return '';
  const edits=c.walkEdits().filter(({detail})=>detail.kind===kind&&detail.index===index);
  const target=kind==='step'?'步骤':'连线';
  const actions=c.role('participant')?`<div class="button-row">${b(`编辑${target}`,`edit-walk-${kind}`,'',{small:true})}${b(`移除${target}`,`remove-walk-${kind}`,'',{small:true,danger:true})}</div>`:'';
  const history=edits.length?`<details class="disclosure"><summary>修订记录（${edits.length}）</summary>${renderWalkHistory(c,edits)}</details>`:'';
  return `<div class="walk-edit-controls">${actions}${history}</div>`;
}

export function renderWalkHistory(c,edits){
  const document=c.walkDocument();
  return edits.slice().reverse().map(({actorId,time,operation,detail})=>{
    const before=detail.before||{},after=detail.after||{};
    const display=(field,value)=>{
      if(field.endpoint)return array(document?.behaviors).find(node=>node.behavior_ref===value)?.behavior_name||value||'未填写';
      return field.choices?.find(choice=>choice.value===value)?.label||value||'未填写';
    };
    const changes=walkEditFields[detail.kind].filter(({name})=>Object.hasOwn(before,name)||Object.hasOwn(after,name)).map(field=>
      `<div class="text-preserve"><strong>${field.label}</strong><br>修改前：${e(display(field,before[field.name]))}<br>修改后：${e(display(field,after[field.name]))}</div>`).join('');
    return `<div class="history-item"><strong>${e(auditLabels[operation])}</strong> · ${e(c.userName(actorId))} · ${dateTime(time)}<p class="text-preserve">${e(detail.reason)}</p>${changes}</div>`;
  }).join('');
}
function walkFieldTable({name,columns,rows,emptyMessage,form=false,fieldLinks=[]}){
  if(!rows.length)return `<p class="subtle-text">${e(emptyMessage)}</p>`;
  return `<table class="walk-field-table ${form?'form-fields':''}" aria-label="${e(name)}"><thead><tr>${columns.map(column=>`<th scope="col">${column}</th>`).join('')}</tr></thead><tbody>${rows.map(([name,...values],index)=>`<tr><th scope="row">${fieldLinks[index]?`<a href="${e(fieldLinks[index])}" target="_blank" rel="noopener" title="在数据矩阵中评审此项">${e(name)} ↗</a>`:e(name)}</th>${values.map(value=>`<td>${e(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function walkDataObject(item,expanded,materialId,objectIndex){
  const name=item.data_name||'未命名对象',fields=array(item.fields).filter(Boolean);
  const rows=fields.map(value=>[value.field_name||'未命名字段',value.field_type||'未填写',value.definition||value.description||value.field_description||'定义待补充']);
  const fieldLinks=fields.map(value=>jsonMatrixLink(materialId,`/data_objects/${objectIndex}/fields/${array(item.fields).indexOf(value)}`));
  return `<details class="walk-data-record" ${expanded?'open':''}><summary>${e(name)} <span class="count">${fields.length} 个字段</span></summary><div class="walk-data-record-body">${item.description?`<p>${e(item.description)}</p>`:''}${walkFieldTable({name:`${name}字段`,columns:['字段名称','类型','定义 / 说明'],rows,fieldLinks,emptyMessage:'材料未列出字段。'})}</div></details>`;
}
function walkForm(item,expanded,materialId,formIndex){
  const name=item.form_name||'未命名表单',areas=array(item.areas).filter(Boolean);
  const designState=({current_state:'现状材料',proposed_design:'拟议设计',to_be:'拟议设计'})[item.form_design_state]||'现状或设计属性待核对';
  const sections=areas.map(area=>{
    const title=area.area_title||area.area_name||'未命名表单区域';
    const rows=array(area.items).filter(Boolean).map(value=>[value.item_name||'未命名字段',value.item_type||'未填写',value.required===true?'必填':value.required===false?'非必填':'待核对',value.instructions||'未填写']);
    const fieldLinks=array(area.items).filter(Boolean).map(value=>jsonMatrixLink(materialId,`/forms/${formIndex}/areas/${array(item.areas).indexOf(area)}/items/${array(area.items).indexOf(value)}`));
    return `<section class="walk-form-area"><h4>${e(title)}</h4>${walkFieldTable({name:`${name} · ${title}`,columns:['字段名称','类型','必填','填写说明'],rows,fieldLinks,emptyMessage:'材料未列出区域字段。',form:true})}</section>`;
  });
  return `<details class="walk-data-record" ${expanded?'open':''}><summary>${e(name)} <span class="count">${areas.length} 个区域</span></summary><div class="walk-data-record-body"><p class="subtle-text">表单编号：${e(item.form_no||'未填写')} · ${e(designState)}</p>${sections.join('')||'<p class="subtle-text">材料未列出表单区域。</p>'}</div></details>`;
}
function renderDataAndForms(c,document){
  const node=c.view.selectedNode,nodeRef=node?.behavior_ref;
  const linked=item=>!nodeRef||array(item.behavior_links).some(link=>link?.behavior_ref===nodeRef);
  const data=array(document.data_objects).filter(Boolean),forms=array(document.forms).filter(Boolean);
  const renderObject=(item,expanded)=>walkDataObject(item,expanded,c.view.materialId,array(document.data_objects).indexOf(item));
  const renderForm=(item,expanded)=>walkForm(item,expanded,c.view.materialId,array(document.forms).indexOf(item));
  const primaryData=data.filter(linked),primaryForms=forms.filter(linked);
  const otherData=data.filter(item=>!linked(item)),otherForms=forms.filter(item=>!linked(item));
  const section=(key,title,items,render,emptyMessage)=>`<section class="walk-data-section"><h3 id="walk-${key}" tabindex="-1">${title} <span class="count">${items.length}</span></h3>${items.map((item,index)=>render(item,index===0)).join('')||`<p class="subtle-text">${emptyMessage}</p>`}</section>`;
  const dataEmpty=nodeRef?'材料未列出与当前步骤关联的数据对象。':'材料未列出数据对象。';
  const formsEmpty=nodeRef?'材料未列出与当前步骤关联的表单。':'材料未列出表单。';
  const other=otherData.length+otherForms.length;
  return `<div class="walk-data-navigation"><span>${nodeRef?`当前步骤：${e(node.behavior_name||'未命名步骤')}`:'整份流程'}</span><div class="button-row" aria-label="定位表格分组"><button type="button" class="button small" data-walk-data-section="data-objects">数据对象 ${primaryData.length}</button><button type="button" class="button small" data-walk-data-section="forms">表单 ${primaryForms.length}</button></div></div><p class="subtle-text">点击字段或表单项名称，可在数据矩阵中逐项评审；原始快照与共享走查修订分别保留。</p>${section('data-objects','数据对象',primaryData,renderObject,dataEmpty)}${section('forms','表单',primaryForms,renderForm,formsEmpty)}${other?`<details class="walk-data-record other-walk-data"><summary>查看其余数据与表单（${other}）</summary><div class="walk-data-record-body">${otherData.map(item=>renderObject(item,false)).join('')}${otherForms.map(item=>renderForm(item,false)).join('')}</div></details>`:''}`;
}
export function renderWalkDetails(c,document){
  if(!document)return empty('正在载入材料');
  if(c.view.detailTab==='lineage')return renderMaterialContext(c);
  const handoffs=classifyHandoffs(document,c.state.departments,c.state.organizationCatalog?.roles_by_department);
  if(c.view.detailTab==='handoffs'){
    const cross=handoffs.filter(item=>item.kind==='cross'),pending=handoffs.filter(item=>item.kind==='pending'),internal=handoffs.filter(item=>item.kind==='internal');
    const cards=items=>items.map(item=>`<button class="handoff-card ${item.kind}" data-relation-index="${item.index}"><strong>${e(item.label)}</strong><span>${e(item.source?.node.behavior_name||'起点待核对')} → ${e(item.target?.node.behavior_name||'终点待核对')}</span>${item.relation.condition?`<small>${e(item.relation.condition)}</small>`:''}</button>`).join('');
    return `<div class="handoff-intro">按当前走查内容中的办理角色与分配规则提示交接。未明确到固定部门的步骤保留待核对，不按目录归属推定。</div><h3>跨部门交接 <span class="count">${cross.length}</span></h3>${cards(cross)||'<p class="subtle-text">当前材料尚无两端均明确到固定部门的交接。</p>'}<details class="disclosure" ${!cross.length?'open':''}><summary>交接部门待核对（${pending.length}）</summary>${cards(pending)}</details><details class="disclosure"><summary>同部门流转（${internal.length}）</summary>${cards(internal)}</details>`;
  }
  if(c.view.detailTab==='list'){
    const groups=new Map();
    array(document.behaviors).forEach((node,index)=>{const actor=describeActor(node,c.state.departments,c.state.organizationCatalog?.roles_by_department),key=actor.department?`department:${actor.department}`:'pending';if(!groups.has(key))groups.set(key,{label:actor.department||'待核对',items:[]});groups.get(key).items.push({node,index,actor});});
    const keys=[...groups.keys()].filter(key=>key!=='pending');if(groups.has('pending'))keys.push('pending');
    return keys.filter(key=>!c.view.laneId||c.view.laneId===key).map(key=>{const group=groups.get(key);return `<section class="lane-step-group ${key==='pending'?'pending':''}"><h3>${e(group.label)} <span class="count">${group.items.length}步</span></h3>${group.items.map(({node,index,actor})=>`<div class="step-item"><button class="button subtle small" data-node-index="${index}">${index+1}. ${e(node.behavior_name)}</button><p>${e(actor.role||'办理角色待补充')}</p>${key==='pending'?`<p>${e(actor.reason)}</p>`:''}</div>`).join('')}</section>`;}).join('');
  }
  if(c.view.detailTab==='data')return renderDataAndForms(c,document);
  const node=c.view.selectedNode,relation=c.view.selectedRelation;
  if(relation){
    const item=handoffs.find(h=>h.relation===relation),source=item?.source,target=item?.target;
    return `<div class="handoff-banner ${item?.kind||'pending'}"><span>${item?.kind==='cross'?'跨部门交接':item?.kind==='internal'?'同部门流转':'交接部门待核对'}</span><h3>${e(item?.label||'流程关系')}</h3></div>${walkEditControls(c,'relation',walkElementIndex(document,'relation',relation))}${b(c.view.projection?'退出投屏并记录意见':'记录本交接意见','record-handoff','',{small:true,primary:true})}<p class="handoff-record-help">提交意见后，由记录员确认需要核实或处理，再整理为问题。</p><div class="handoff-fact"><strong>交出方</strong>${source?`<button class="neighbor-step" data-node-index="${source.index}">${e(source.node.behavior_name)}</button><p>${e(source.actor.role||'办理角色未填写')}</p>${source.actor.status==='pending'?`<small>${e(source.actor.reason)}</small>`:''}`:'起点待核对'}</div><div class="handoff-fact"><strong>接收方</strong>${target?`<button class="neighbor-step" data-node-index="${target.index}">${e(target.node.behavior_name)}</button><p>${e(target.actor.role||'办理角色未填写')}</p>${target.actor.status==='pending'?`<small>${e(target.actor.reason)}</small>`:''}`:'终点待核对'}</div><dl>${field('交出内容',source?.node.output_description)}${field('接收要求',target?.node.input_description)}${field('流转条件',relation.condition||'材料未填写条件')}${field('接收方完成标准',target?.node.completion_standard)}</dl><details class="disclosure"><summary>查看两端部门分配依据</summary><dl>${field('交出方分配规则',source?.node.actor_position_rule)}${field('接收方分配规则',target?.node.actor_position_rule)}</dl></details>`;
  }
  if(node){
    const steps=array(document.behaviors),relations=array(document.flow_relations);
    const neighbors=(direction)=>relations.filter(r=>r[direction==='before'?'to_behavior_ref':'from_behavior_ref']===node.behavior_ref).map(r=>{
      const ref=r[direction==='before'?'from_behavior_ref':'to_behavior_ref'],matches=steps.map((n,i)=>({n,i})).filter(({n})=>n.behavior_ref===ref);
      return matches.length===1?`<button class="neighbor-step" data-node-index="${matches[0].i}" title="${e(r.condition||'材料未列流转条件')}">${direction==='before'?'←':'→'} ${e(matches[0].n.behavior_name)}${r.condition?`<small>${e(r.condition)}</small>`:''}</button>`:`<span class="subtle-text">关联步骤待核对</span>`;
    }).join('');
    return `<div class="step-heading"><span class="step-number">${steps.indexOf(node)+1}</span><div><h3>${e(node.behavior_name)}</h3><span class="actor-chip">${e(node.current_actor_role||'办理角色待补充')}</span></div></div>${walkEditControls(c,'step',walkElementIndex(document,'step',node))}<div class="lane-membership">泳道：${e(describeActor(node,c.state.departments,c.state.organizationCatalog?.roles_by_department).department||'待核对')}<small>${e(describeActor(node,c.state.departments,c.state.organizationCatalog?.roles_by_department).reason)}</small></div><div class="handoff-neighbors"><div><strong>从哪里来</strong>${neighbors('before')||'<span class="subtle-text">材料未列前置关系</span>'}</div><div><strong>交给谁 / 下一步</strong>${neighbors('after')||'<span class="subtle-text">材料未列后续关系</span>'}</div></div><dl>${field('办理说明',node.behavior_description)}${field('输入',node.input_description)}${field('完成标准',node.completion_standard)}${field('输出',node.output_description)}</dl><details class="disclosure"><summary>查看触发、前置条件与时限</summary><dl>${field('触发条件',node.trigger)}${field('前置条件',node.precondition)}${field('时限',node.timing)}</dl></details>`;
  }
  return `<h3>流程范围</h3><dl>${field('目的',document.process?.purpose)}${field('范围',document.process?.scope)}</dl><div class="muted-block">点击流程节点或连线，查看本步骤的角色、输入输出和完成标准。</div>`;
}
function opinionSource(c,item){
  const material=c.state.materials.find(value=>value.id===item.materialId);
  const batch=c.state.batches.find(value=>value.id===item.batchId);
  const position=item.nodeRef?'流程步骤':item.relationRef?'连线':'整份材料';
  return `<strong>${e(material?.name||'来源材料')}</strong><span class="subtle-text">${e(batch?.title||(item.batchId?'原批次':'独立浏览'))} · ${position}${material?.sourcePath?` · ${e(material.sourcePath)}`:''}</span>`;
}
function myOpinions(c){
  const {query,status}=c.filters.opinions;
  const mine=c.state.opinions.filter(item=>item.authorId===c.user.id);
  const rows=mine.filter(item=>(!status||item.status===status)&&(!query||`${item.text} ${c.materialName(item.materialId)}`.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a,b)=>(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt));
  return heading('我的意见','集中查看当前演练身份保存的草稿和已提交意见。',b('返回流程走查','browse-flow'))+
    `<div class="toolbar"><input type="search" placeholder="搜索意见或流程名称" value="${e(query)}" data-filter="opinions.query" aria-label="搜索我的意见"><select data-filter="opinions.status" aria-label="筛选意见状态">${options([{value:'draft',label:'草稿'},{value:'submitted',label:'已提交'}],status,'全部状态')}</select><span class="subtle-text" data-filter-region="count">显示 ${rows.length} / ${mine.length} 条</span></div>
    <section class="panel personal-opinions" data-filter-region="results">${rows.map(item=>{
      const linked=c.state.issues.filter(issue=>array(issue.opinionIds).includes(item.id));
      const editable=!item.batchId||c.state.batches.some(batch=>batch.id===item.batchId&&batch.materialIds.includes(item.materialId));
      return `<article class="opinion-card"><div class="meta"><span>${dateTime(item.updatedAt||item.createdAt)}</span>${tag(item.status)}${item.status==='submitted'?`<span class="tag ${linked.length?'green':'amber'}">${linked.length?'已关联问题':'待记录员整理'}</span>`:''}</div><div class="opinion-source">${opinionSource(c,item)}</div><p class="text-preserve">${e(item.text)}</p><div class="button-row">${b('定位来源','open-opinion-source',item.id,{small:true})}${editable?b(item.status==='draft'?'继续编辑':'更正意见','edit-opinion',item.id,{small:true}):''}${array(item.history).length?b('查看更正历史','opinion-history',item.id,{small:true}):''}${linked.map(issue=>b(`查看问题 · ${short(issue.title,30)}`,'open-linked-issue',issue.id,{small:true})).join('')}</div></article>`;
    }).join('')||empty(mine.length?'没有匹配的意见':'还没有保存的意见',mine.length?'调整搜索词或状态后再查看。':'在流程走查中保存草稿或提交后，可在这里查找。')}</section>`;
}
function pendingOpinions(c){
  const linked=new Set(c.state.issues.flatMap(issue=>array(issue.opinionIds)));
  const pending=c.state.opinions.filter(item=>item.status==='submitted'&&!linked.has(item.id));
  const recorder=c.role('recorder');
  return `<details class="panel opinion-queue" ${pending.length&&!c.state.issues.length?'open':''}><summary>待整理意见 <span class="count">${pending.length} 条</span></summary><div class="panel-body"><p class="subtle-text">${recorder?'核对提交的意见后，可据此形成问题。':'已提交意见在此等候记录员整理。'}</p>${pending.map(item=>
    `<article class="opinion-card"><div class="meta"><span>${e(c.userName(item.authorId))} · ${dateTime(item.updatedAt||item.createdAt)}</span></div><div class="opinion-source">${opinionSource(c,item)}</div><p class="text-preserve">${e(item.text)}</p><div class="button-row">${b('定位来源','open-opinion-source',item.id,{small:true})}${recorder?b('据此形成问题','issue-from-opinion',item.id,{small:true,primary:true}):''}</div></article>`).join('')||'<p class="subtle-text">当前没有待整理的已提交意见。</p>'}</div></details>`;
}
function issues(c){
  const f=c.filters.issues,rows=c.state.issues.filter(item=>(!f.query||`${item.title} ${item.description}`.includes(f.query))&&(!f.status||item.status===f.status));
  const current=rows.find(item=>item.id===c.view.issueId)||rows[0];
  if(current)c.view.issueId=current.id;
  return heading('问题台账','由意见形成可跟进的问题；分派、答复、证据和指定复核各自留痕。',c.role('recorder')?b('新建问题','create-issue','',{primary:true}):'')+pendingOpinions(c)+`<div class="toolbar"><input type="search" placeholder="搜索问题或描述" value="${e(f.query)}" data-filter="issues.query" aria-label="搜索问题"><select data-filter="issues.status" aria-label="筛选问题状态">${options(['open','in_progress','awaiting_review','closed'].map(value=>({value,label:statusNames[value]})),f.status,'全部状态')}</select><span class="subtle-text" data-filter-region="count">${rows.length} 项问题</span></div><div class="issue-stages" data-filter-region="stages" aria-label="按处理阶段筛选">${[['open','待跟进'],['in_progress','跟进中'],['awaiting_review','待复核'],['closed','已关闭']].map(([status,label])=>`<button class="issue-stage ${f.status===status?'active':''}" data-action="issue-status" data-id="${status}"><span>${label}</span><strong>${c.state.issues.filter(item=>item.status===status).length}</strong></button>`).join('')}</div><div class="issue-grid" data-filter-region="results"><section class="panel"><table class="data-table"><thead><tr><th>问题与影响范围</th><th>跟进 / 截止</th><th>状态</th></tr></thead><tbody>${rows.map(item=>`<tr class="issue-list-item ${current?.id===item.id?'selected':''}" data-action="select-issue" data-id="${e(item.id)}"><td><button type="button" class="issue-title issue-select" data-action="select-issue" data-id="${e(item.id)}" aria-pressed="${current?.id===item.id}">${e(item.title)}</button><span class="subtle-text">${e(array(item.affectedDepartments).join('、')||'待明确影响部门')}</span></td><td>${e(c.userName(item.assigneeId))}<br><span class="subtle-text">${e(item.dueDate||'期限待定')}</span></td><td>${tag(item.status)}</td></tr>`).join('')}</tbody></table>${rows.length?'':f.query||f.status?empty('没有符合筛选条件的问题','可调整搜索词或状态。'):empty('尚无问题','记录员可以从已提交意见创建问题。')}</section><section class="panel issue-detail-panel">${current?issueDetail(current,c):empty('选择问题查看详情')}</section></div>`;
}
function issueDetail(item,c){
  const reviewer=array(item.reviewerIds).includes(c.user.id),authority=item.authorityId===c.user.id;
  return `<header class="panel-header"><h3>${e(item.title)}</h3>${tag(item.status)}</header><div class="panel-body record-detail"><div class="tag-list">${tag(item.scope)}${array(item.materialIds).map(id=>`<span class="tag">${e(short(c.materialName(id),30))}</span>`).join('')}</div><dl>${field('问题描述',item.description)}${field('影响',item.impact)}${field('跟进人 / 期限',`${c.userName(item.assigneeId)} / ${item.dueDate||'待定'}`)}${field('指定复核人',array(item.reviewerIds).map(c.userName).join('、')||'待指定')}${item.scope==='policy'?field('有权主体',c.userName(item.authorityId)):''}</dl><div class="button-row section-spacer">${c.role('recorder')&&item.status!=='closed'?b('分派 / 调整','assign-issue',item.id,{small:true}):''}${item.assigneeId===c.user.id&&item.status!=='closed'?b('答复与证据','respond-issue',item.id,{small:true,primary:true}):''}${reviewer&&item.status==='awaiting_review'?b('复核决定','review-issue',item.id,{small:true,primary:true}):''}${authority&&item.status==='awaiting_review'?b('记录决定依据','authority-issue',item.id,{small:true}):''}${(reviewer||authority)&&item.status==='closed'?b('重新打开','reopen-issue',item.id,{small:true}):''}</div><h3 class="section-spacer">跟进答复与证据</h3>${array(item.responses).map(response=>`<div class="response-card"><p>${e(response.text)}</p><p><strong>证据：</strong>${e(response.evidence)}</p><small>${e(c.userName(response.authorId||response.actorId||response.by))} · ${dateTime(response.at||response.createdAt)}</small></div>`).join('')||'<p class="subtle-text">尚未提交跟进答复。</p>'}<h3 class="section-spacer">本轮复核</h3>${renderReviews(item,c)}${item.authorityEvidence?`<div class="muted-block">有权主体依据：${e(typeof item.authorityEvidence==='string'?item.authorityEvidence:item.authorityEvidence.evidence)}</div>`:''}<details class="disclosure"><summary>查看处理历史（${array(item.history).length}）</summary>${renderHistory(item.history,c)}</details></div>`;
}
function renderReviews(item,c){
  const reviews=Array.isArray(item.reviews)?item.reviews:Object.entries(item.reviews||{}).map(([userId,value])=>({...value,userId}));
  return reviews.map(review=>`<div class="response-card"><p>${e(c.userName(review.reviewerId||review.userId||review.actorId))} · ${e(statusNames[review.decision]||'已记录')}</p><p>${e(review.note)}</p></div>`).join('')||'<p class="subtle-text">尚无本轮复核意见。新答复或退回后需要重新复核。</p>';
}
export function renderHistory(history,c){
  const labels={text:'意见内容',status:'处理状态',title:'标题',description:'问题描述',impact:'影响',assigneeId:'跟进人',dueDate:'期限',reviewerIds:'指定复核人',authorityId:'有权主体',phenomenon:'观察现象',timePattern:'时间变化',variables:'变量与度量',hypotheses:'解释假设',feedback:'反馈关系',delays:'时滞',evidence:'支持证据',counterEvidence:'反例与反证',nextEvidence:'下一步取证'};
  const display=(key,value)=>key==='status'?(statusNames[value]||value||'未填写'):['assigneeId','authorityId'].includes(key)?c.userName(value):key==='reviewerIds'?array(value).map(c.userName).join('、')||'未指定':String(value??'未填写');
  return array(history).map(item=>{
    const before=item.before||{},after=item.after||{};
    const changes=Object.entries(labels).filter(([key])=>JSON.stringify(before[key])!==JSON.stringify(after[key])&&key in after).map(([key,label])=>`<div class="text-preserve"><strong>${label}</strong><br>原：${e(display(key,before[key]))}<br>新：${e(display(key,after[key]))}</div>`).join('');
    const response=array(after.responses).length>array(before.responses).length?array(after.responses).at(-1):null;
    return `<div class="history-item"><strong>${e(auditLabels[item.operation||item.type]||'记录更新')}</strong> · ${e(c.userName(item.actorId||item.authorId||item.by))} · ${dateTime(item.at||item.createdAt)}${changes}${item.decision?`<p>复核：${e(statusNames[item.decision.decision]||'已记录')} · ${e(item.decision.note)}</p>`:''}${response?`<p>答复：${e(response.text)}</p><p>证据：${e(response.evidence)}</p>`:''}${after.authorityEvidence&&JSON.stringify(after.authorityEvidence)!==JSON.stringify(before.authorityEvidence)?`<p>决定依据：${e(after.authorityEvidence.evidence)}</p>`:''}${item.note||item.reason?`<p>${e(item.note||item.reason)}</p>`:''}</div>`;
  }).join('')||'<p class="subtle-text">暂无历史变更。</p>';
}
function observations(c){
  return heading('系统性问题观察','记录跨流程现象、时间变化、反馈与反例，为后续系统动力学建模准备证据。',b('新增观察','create-observation','',{primary:true}))+`<div class="form-callout">这里记录待验证的解释与证据，不自动判定因果，不生成仿真结论。流程走向、相关性和因果反馈需要分别核对。</div><div class="observation-grid">${c.state.observations.map(item=>`<article class="panel observation-card"><div class="batch-top"><h3>${e(item.title)}</h3>${item.createdBy===c.user.id?b('编辑观察','edit-observation',item.id,{small:true}):''}</div><div class="tag-list">${array(item.materialIds).map(id=>`<span class="tag">${e(short(c.materialName(id),24))}</span>`).join('')}</div><dl class="record-detail">${[['观察到的现象','phenomenon'],['随时间的变化','timePattern'],['变量与度量','variables'],['解释假设','hypotheses'],['反馈关系','feedback'],['时滞','delays'],['支持证据','evidence'],['反例与反证','counterEvidence'],['下一步取证','nextEvidence']].map(([label,key])=>field(label,item[key]||'待补充')).join('')}</dl><div class="subtle-text section-spacer">关联 ${array(item.issueIds).length} 项问题 · ${e(c.userName(item.createdBy))}</div><details class="disclosure"><summary>修订历史（${array(item.history).length}）</summary>${renderHistory(item.history,c)}</details></article>`).join('')||empty('尚无系统性观察','先从跨流程反复出现的现象开始，明确证据和反例。')}</div>`;
}
