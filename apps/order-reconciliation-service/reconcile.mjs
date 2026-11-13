// Source identities are retained separately from business numbers. No value is
// repaired, filled from another source, or chosen as the correct value here.
export const DATASETS = {
  'u8-sales': {source:'u8',object:'dbo.SO_SODetails',key:'iSOsID'},
  'u8-production': {source:'u8',object:'dbo.mom_orderdetail',key:'MoDId'},
  'kfu-sales': {source:'kfu',object:'dbo.SODetails',key:'ID'},
  'kfu-production': {source:'kfu',object:'dbo.momorderdetail',key:'ID'},
  'mes-tasks': {source:'mes',object:'dbo.生产任务单_主表',key:'生产编号'},
  'mes-intermediate': {source:'mes',object:'dbo.生产订单中间表新_明细',key:'ExcelServerRCID'},
  'mes-travelers': {source:'mes',object:'dbo.产品制造大纲流转卡_主表',key:'制造大纲编号'},
  'mes-process': {source:'mes',object:'dbo.工艺清单汇总_主表',key:'零件编号'}
};
const missing = v => v === null || v === undefined || v === '';
const integer = v => { if (missing(v) || !/^\s*\+?\d+\s*$/.test(String(v))) return null; return BigInt(String(v).trim()).toString(); };
function index(rows,key) { const result=new Map(); for(const row of rows) {const v=key(row);if(v!==null && v!==undefined){if(!result.has(v))result.set(v,[]);result.get(v).push(row);}} return result; }
const unique = values => [...new Set(values)];
const shown = values => {const v=unique(values.map(x=>x??null));return v.length<2?(v[0]??null):`多值 ${JSON.stringify(v)}`;};
export function reconcile(datasets,reads=[]) {
  for(const key of Object.keys(DATASETS))if(!Array.isArray(datasets[key]))throw new Error(`REQUIRED_DATASET_MISSING:${key}`);
  const sales=datasets['u8-sales'], production=datasets['u8-production'];
  const saleById=index(sales,s=>integer(s.iSOsID));
  const saleByNumber=index(sales,s=>missing(s.cDefine25)?null:s.cDefine25);
  const productionById=index(production,p=>integer(p.MoDId));
  const productionBySalesPart=index(production,p=>String(p.OrderType)==='1'&&!missing(p.Define28)?`${integer(p.OrderDId)}\0${p.Define28}`:null);
  const kfuSales=index(datasets['kfu-sales'],r=>integer(r.U8AUTOID));
  const kfuProduction=index(datasets['kfu-production'],r=>integer(r.U8AUTOID));
  const tasks=datasets['mes-tasks'].filter(t=>t['账套号']==='333');
  const taskByLocal=index(tasks,t=>t['生产编号']);
  const taskSale=new Map();
  for(const task of tasks) {
    const matches=saleByNumber.get(task['U8生产编号'])||[];
    if(matches.length===1 && (missing(task['订单号']) || task['订单号']===matches[0].cSOCode))taskSale.set(task,matches[0]);
  }
  const intermediateByProduction=new Map();
  const mesScope=new Map();
  const addMes=(p,key,r,basis,taskReferences=[])=>{if(!mesScope.has(key))mesScope.set(key,new Set());mesScope.get(key).add(r);if(!intermediateByProduction.has(p))intermediateByProduction.set(p,[]);intermediateByProduction.get(p).push({key,r,basis,taskReferences});};
  for(const r of datasets['mes-intermediate']) {
    const candidates=productionById.get(integer(r.u8autoid))||[];
    if(candidates.length!==1)continue;
    const p=candidates[0];if(integer(r.u8id)!==integer(p.MoId))continue;
    const interfaces=(kfuProduction.get(integer(p.MoDId))||[]).filter(k=>k['账套号']==='333' && integer(k.U8ID)===integer(p.MoId) && !missing(k['BOM编号']) && k['BOM编号']===r['生产订单表编号']);
    const scopedTasks=(taskByLocal.get(r['生产编号'])||[]).filter(t=>taskSale.has(t));
    if(interfaces.length || scopedTasks.length)addMes(p,'mes-intermediate',r,interfaces.length?'333接口的U8AUTOID、U8ID、BOM编号三项源引用一致':'333任务范围与u8autoid、u8id源引用一致；任务销售来源另行核对',scopedTasks);
  }
  for(const key of ['mes-travelers','mes-process'])for(const r of datasets[key]) {
    const matchingTasks=(taskByLocal.get(r['生产编号'])||[]).filter(t=>taskSale.has(t));
    if(matchingTasks.length!==1)continue;
    const task=matchingTasks[0],s=taskSale.get(task);
    const part=r['U8零件编号'];
    if(missing(part))continue;
    const candidates=productionBySalesPart.get(`${integer(s.iSOsID)}\0${part}`)||[];
    if(candidates.length===1)addMes(candidates[0],key,r,'333任务本地生产编号引用＋销售来源下唯一U8零件编号；原值精确匹配',[task]);
  }
  const usedEvidence=Object.fromEntries(Object.keys(DATASETS).map(key=>[key,new Set()]));
  const rows=[],coveredSales=new Set(),usedKfuSales=new Set(),usedKfuProduction=new Set();
  const evidence=(key,r)=>{usedEvidence[key].add(r);const { _expectedCount,...values }=r;const meta=DATASETS[key],read=reads.find(x=>x.dataset===key);const sourceId=key.startsWith('mes-')?`${r[meta.key]??'缺失'} / RCID:${r.ExcelServerRCID??'NULL'} / RN:${r.ExcelServerRN??'NULL'}`:String(r[meta.key]??'缺失');return {source:meta.source,object:meta.object,sourceId,readAt:read?.finishedAt??null,values};};
  function makeRow(s,p,ordinal) {
    const baseId=p?`production:${p.MoDId??ordinal}`:`sales:${s.iSOsID??ordinal}`;
    const result={id:baseId,productionNumber:s?s.cDefine25:p?.Define25??null,salesOrder:s?.cSOCode??null,salesDetailId:s?.iSOsID??null,productionOrder:p?.MoCode??null,productionDetailId:p?.MoDId??null,interfaceId:null,mesId:null,qualitySales:s?.cDefine29??null,qualityProduction:p?.Define29??null,qualityMes:null,inventoryCode:p?.InvCode??s?.cInvCode??null,status:'matched',issues:[],associationBasis:p?'尚未确认销售来源':'销售明细；尚未转生产不单独判为异常',evidence:[]};
    const issue=(code,label,field,values,basis)=>result.issues.push({code,label,field,values,basis});
    const compare=(a,b,label,field,basis)=>{if(a!==b)issue('RAW_DIFFERENCE',`${label}原值不同`,field,{left:a??null,right:b??null},`${basis}；不判定哪方正确，不做格式等价处理`);};
    const number=(v,where)=>{if(missing(v))issue('PRODUCTION_NUMBER_MISSING',`${where}生产编号缺失`,'生产编号',{value:v??null},'生产编号为18位字符串');else if([...String(v)].length!==18)issue('PRODUCTION_NUMBER_LENGTH',`${where}生产编号不是18位`,'生产编号',{value:v,length:[...String(v)].length},'按原值字符数检查，未去除空格或标点');};
    if(s){coveredSales.add(s);result.evidence.push(evidence('u8-sales',s));number(s.cDefine25,'销售');if(missing(s.cDefine29))issue('QUALITY_MISSING','销售质量编号缺失','质量编号',{value:s.cDefine29??null},'展示源端缺失，不从其他来源补填');if(!missing(s.cDefine25)&&(saleByNumber.get(s.cDefine25)||[]).length>1)issue('SALES_NUMBER_REUSED','同一生产编号对应多条销售明细','生产编号',{salesDetailIds:saleByNumber.get(s.cDefine25).map(x=>x.iSOsID)},'生产编号与销售明细应一对一，未合并这些明细');}
    if(p){result.evidence.push(evidence('u8-production',p));number(p.Define25,'生产');if(s){result.associationBasis='OrderType=1且OrderDId指向销售iSOsID；编号与订单号另行核对';compare(s.cDefine25,p.Define25,'销售与生产的生产编号','cDefine25 / Define25','源明细引用关联');compare(s.cDefine29,p.Define29,'销售与生产的质量编号','cDefine29 / Define29','原值比较，手工字段等价规则待明确');if(!missing(p.OrderCode)&&p.OrderCode!==s.cSOCode)issue('SALES_REFERENCE_CONFLICT','生产的销售订单号与明细引用不一致','OrderCode',{referencedOrder:s.cSOCode,recordedOrder:p.OrderCode},'保留明确明细引用及双方原值，不按编号重新分配归属');}else {result.status='unmatched';issue('SALES_REFERENCE_UNRESOLVED','生产订单未确认已审核销售来源','OrderDId',{OrderType:p.OrderType,OrderDId:p.OrderDId,Define25:p.Define25},'只在已审核销售范围匹配明确引用，不按相同编号猜并');}}
    const ks=s?kfuSales.get(integer(s.iSOsID))||[]:[];
    for(const r of ks){usedKfuSales.add(r);result.evidence.push(evidence('kfu-sales',r));if(integer(r.U8ID)!==integer(s.ID))issue('KFU_PARENT_REFERENCE_CONFLICT','KFU销售父单引用不一致','U8ID',{u8:s.ID,kfu:r.U8ID},'U8AUTOID可定位明细，父单引用仍需单独核对');compare(s.cDefine25,r['生产编号'],'U8销售与KFU销售的生产编号','cDefine25 / 生产编号','333账套及U8AUTOID明细引用');}
    const kp=p?kfuProduction.get(integer(p.MoDId))||[]:[];
    for(const r of kp){usedKfuProduction.add(r);result.evidence.push(evidence('kfu-production',r));if(integer(r.U8ID)!==integer(p.MoId))issue('KFU_PARENT_REFERENCE_CONFLICT','KFU生产父单引用不一致','U8ID',{u8:p.MoId,kfu:r.U8ID},'U8AUTOID可定位明细，父单引用仍需单独核对');compare(p.Define25,r['生产编号'],'U8与KFU生产的生产编号','Define25 / 生产编号','333账套及U8AUTOID明细引用');compare(p.Define29,r['质量编号'],'U8与KFU的质量编号','Define29 / 质量编号','直接复制字段原值比较');compare(p.Define28,r['零件编号'],'U8与KFU的零件编号','Define28 / 零件编号','直接复制字段原值比较');}
    result.interfaceId=kp.length?kp.map(x=>x.ID).join('、'):ks.length?ks.map(x=>`销售:${x.ID}`).join('、'):null;
    const mes=p?intermediateByProduction.get(p)||[]:[];
    for(const item of mes){const {key,r,basis,taskReferences}=item;result.evidence.push(evidence(key,r));
      for(const task of taskReferences){result.evidence.push(evidence('mes-tasks',task));const taskSource=taskSale.get(task);if(taskSource && (String(p.OrderType)!=='1'||integer(taskSource.iSOsID)!==integer(p.OrderDId)))issue('MES_TASK_SOURCE_CONFLICT','勤哲任务销售来源与生产源引用冲突','U8生产编号 / OrderDId',{taskSalesDetailId:taskSource.iSOsID,productionOrderDId:p.OrderDId},'同时保留任务、接口及U8引用证据，不把两个不同来源合并为一致');}
      if(key==='mes-intermediate'){compare(p.Define29,r['质量编号'],'U8与勤哲接口的质量编号','Define29 / 质量编号',basis);if(!missing(r['任务与u8生产编号']))compare(s?.cDefine25??p.Define25,r['任务与u8生产编号'],'U8与勤哲任务的U8生产编号','cDefine25 / 任务与u8生产编号',basis);}
      else {const value=r['U8生产编号']??r['u8生产编号'];if(!missing(value))compare(s?.cDefine25??p.Define25,value,'U8与勤哲的U8生产编号','cDefine25 / U8生产编号',basis);if(key==='mes-process')compare(p.Define29,r['质量编号'],'U8与勤哲工艺清单的质量编号','Define29 / 质量编号',basis);}
    }
    result.mesId=mes.length?mes.map(({key,r})=>`${DATASETS[key].object}:${r[DATASETS[key].key]??'缺失'}:${r.ExcelServerRN??''}`).join('、'):null;
    result.qualityMes=mes.length?shown(mes.map(({key,r})=>key==='mes-travelers'?r['类别质量编号']:r['质量编号'])):null;
    if(p&&!kp.length){result.status='unmatched';result.associationBasis+='；未找到333账套KFU生产明细引用，待核查';}
    if(p&&!mes.length){result.status='unmatched';result.associationBasis+='；尚未取得足够证据关联勤哲记录，不据此直接判漏传';}
    if(!p)result.status='unmatched';
    if(result.status!=='unmatched'&&result.issues.length)result.status='difference';
    return result;
  }
  production.forEach((p,i)=>{const candidates=String(p.OrderType)==='1'?saleById.get(integer(p.OrderDId))||[]:[];rows.push(makeRow(candidates.length===1?candidates[0]:null,p,i));});
  sales.forEach((s,i)=>{if(!coveredSales.has(s))rows.push(makeRow(s,null,i));});
  const coverage=Object.entries(DATASETS).map(([key,meta])=>({dataset:key,source:meta.source,object:meta.object,read:datasets[key].length,associated:key==='u8-sales'?sales.length:key==='u8-production'?production.length:key==='kfu-sales'?usedKfuSales.size:key==='kfu-production'?usedKfuProduction.size:key==='mes-tasks'?taskSale.size:mesScope.get(key)?.size??0,scopeNote:key.startsWith('mes-')?'本地编号与U8编号分列；无账套的候选原值保留，未确认范围或引用的记录不冒充已审核订单关联':'全读取范围内保留原始快照；未纳入已审核源链的下游记录不推定已审核'}));
  const summary={sales:sales.length,production:production.length,interface:datasets['kfu-sales'].length+datasets['kfu-production'].length,mes:Object.keys(DATASETS).filter(k=>k.startsWith('mes-')).reduce((n,k)=>n+datasets[k].length,0),linked:rows.filter(r=>r.productionDetailId&&r.salesDetailId&&r.interfaceId&&r.mesId).length,findings:rows.reduce((n,r)=>n+r.issues.length,0),findingRecords:rows.filter(r=>r.issues.length).length,unmatched:rows.filter(r=>r.status==='unmatched').length,ledgerRows:rows.length};
  const sourceDispositions=Object.fromEntries(Object.entries(DATASETS).map(([key,meta])=>[key,datasets[key].map(r=>usedEvidence[key].has(r)?'used_in_check':key==='mes-tasks'&&taskSale.has(r)?'scope_reference':'association_pending')]));
  return {rows,summary,coverage,sourceDispositions};
}
