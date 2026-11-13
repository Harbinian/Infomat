// Derived presentation only: frozen form values are never historical change events.
import {createHash} from 'node:crypto';
const sources={u8:'用友',kfu:'转换平台',mes:'勤哲'};
const schemas={
 'u8:dbo.SO_SODetails':{label:'销售订单',anchor:'dDate',dates:[['dDate','销售单据日期'],['dverifydate','销售审核日期'],['dclosedate','销售主单关闭日期'],['dbclosedate','销售明细关闭日期']],people:[['cVerifier','销售订单审核','dverifydate','name'],['cCloser','销售主单关闭','dclosedate','name'],['cSCloser','销售明细关闭','dbclosedate','name']],fields:['cSOCode','ID','iSOsID','cDefine25','cDefine29'],note:'单据日期、审核及主单关闭人员和日期来自销售主单；其余所列内容来自销售明细。'},
 'u8:dbo.mom_orderdetail':{label:'生产订单',anchor:'CreateDate',dates:[['CreateDate','生产主单创建日期'],['RelsDate','生产订单审核日期'],['CloseDate','生产明细关闭日期']],people:[['RelsUser','生产订单审核人','RelsDate','account'],['CloseUser','生产明细关闭','CloseDate','account']],fields:['MoCode','MoId','MoDId','OrderDId','Define25','Define28','Define29'],note:'生产订单号及创建日期来自生产主单；所列人员和操作日期来自生产明细。'},
 'kfu:dbo.SODetails':{label:'销售订单转换记录',anchor:'创建时间',dates:[['创建时间','销售转换记录创建时间']],people:[],fields:['ID','U8ID','U8AUTOID','订单号','生产编号'],note:'创建时间为转换记录中的原填内容，不能单独证明实际转换时间。'},
 'kfu:dbo.momorderdetail':{label:'生产订单转换记录',anchor:'创建日期',dates:[['创建日期','生产转换记录创建日期']],people:[],fields:['ID','U8ID','U8AUTOID','BOM编号','生产编号','零件编号','质量编号'],note:'此日期可能沿用用友生产主单日期，不能作为实际转换时间或覆盖时间。'},
 'mes:dbo.生产任务单_主表':{label:'生产任务单',anchor:'下发日期',dates:[['下发日期','任务下发日期']],people:[],fields:['生产编号','U8生产编号','订单号','任务编号']},
 'mes:dbo.生产订单中间表新_明细':{label:'生产订单接收记录',dates:[],people:[],fields:['生产订单表编号','生产编号','零件编号','u8id','u8autoid','质量编号'],note:'本批未采集此表单的日期或操作人，不从编号样式推断。'},
 'mes:dbo.产品制造大纲流转卡_主表':{label:'流转卡',dates:[['审核日期','流转卡审核日期'],['批准日期','流转卡批准日期']],people:[['审核','流转卡审核','审核日期','name'],['批准','流转卡批准','批准日期','name']],fields:['制造大纲编号','生产编号','u8生产编号','零件编号','U8零件编号','类别质量编号'],note:'没有创建日期时，以最早有效审核／批准日期排列；不将其解释为创建日期。'},
 'mes:dbo.工艺清单汇总_主表':{label:'工艺清单汇总',dates:[],people:[],fields:['工艺清单表编号','生产编号','U8生产编号','零件编号','U8零件编号','质量编号'],note:'本批未采集此表单的日期或操作人，不从编号样式推断。'}
};
const objects={sales:'u8:dbo.SO_SODetails',production:'u8:dbo.mom_orderdetail',kfuSales:'kfu:dbo.SODetails',kfuProduction:'kfu:dbo.momorderdetail',intermediate:'mes:dbo.生产订单中间表新_明细',process:'mes:dbo.工艺清单汇总_主表',task:'mes:dbo.生产任务单_主表'};
const pairs={
 '销售与生产的生产编号原值不同':['sales','production'],'销售与生产的质量编号原值不同':['sales','production'],
 'U8销售与KFU销售的生产编号原值不同':['sales','kfuSales'],'U8与KFU生产的生产编号原值不同':['production','kfuProduction'],
 'U8与KFU的质量编号原值不同':['production','kfuProduction'],'U8与KFU的零件编号原值不同':['production','kfuProduction'],
 'U8与勤哲接口的质量编号原值不同':['production','intermediate'],'U8与勤哲工艺清单的质量编号原值不同':['production','process'],
 'U8与勤哲任务的U8生产编号原值不同':['production','intermediate']
};
function relatedObjects(issue){
 if(pairs[issue.label])return pairs[issue.label].map(key=>objects[key]);
 if(issue.code==='QUALITY_MISSING'||issue.code==='SALES_NUMBER_REUSED')return [objects.sales];
 if(['PRODUCTION_NUMBER_MISSING','PRODUCTION_NUMBER_LENGTH'].includes(issue.code))return issue.label.startsWith('销售')?[objects.sales]:issue.label.startsWith('生产')?[objects.production]:[];
 if(issue.code==='KFU_PARENT_REFERENCE_CONFLICT')return issue.label==='KFU生产父单引用不一致'?[objects.production,objects.kfuProduction]:issue.label==='KFU销售父单引用不一致'?[objects.sales,objects.kfuSales]:[];
 if(['SALES_REFERENCE_CONFLICT','SALES_REFERENCE_UNRESOLVED'].includes(issue.code))return [objects.sales,objects.production];
 if(issue.code==='MES_TASK_SOURCE_CONFLICT')return [objects.task,objects.production];
 return [];
}
function matchesValues(issue,key,values){
 const pair=pairs[issue.label];
 if(issue.code==='RAW_DIFFERENCE'&&pair){const side=pair.map(name=>objects[name]).indexOf(key),field=issue.field?.split('/')[side]?.trim();return field in values&&Object.is(values[field]??null,issue.values?.[side===0?'left':'right']??null);}
 if(issue.code==='KFU_PARENT_REFERENCE_CONFLICT')return Object.is(values[key.startsWith('kfu:')?'U8ID':key===objects.sales?'ID':'MoId']??null,issue.values?.[key.startsWith('kfu:')?'kfu':'u8']??null);
 return true;
}
const missing=value=>value===undefined||value===null||value==='';
function calendar(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?$/.test(value))return null;
 const [year,month,day]=value.slice(0,10).split('-').map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 if(year<1||month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])return null;
 if(value.length>10&&(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59))return null;
 return value.slice(0,10);
}
function fieldLocation(key,field,values,evidence){
 if(key===objects.sales&&['dDate','dverifydate','dclosedate','cVerifier','cCloser'].includes(field))return {object:'dbo.SO_SOMain',sourceId:values.ID??null};
 if(key===objects.production&&field==='CreateDate')return {object:'dbo.mom_order',sourceId:values.MoId??null};
 return {object:evidence.object,sourceId:evidence.sourceId};
}
export function validateDirectory(directory){
 if(directory?.version!==1||directory.source!=='UFSystem.dbo.UA_User'||!Number.isFinite(Date.parse(directory.capturedAt))||!Array.isArray(directory.users)||!Array.isArray(directory.queryHashes)||directory.queryHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))throw new Error('INVALID_USER_EVIDENCE');
 for(const user of directory.users)if(typeof user.account!=='string'||typeof user.name!=='string'||!user.account||!user.name)throw new Error('INVALID_USER_EVIDENCE');
 return directory;
}
export function buildDetailEvidence(record,batchId,directory=null){
 if(directory)validateDirectory(directory);
 const forms=[],people=[],seen=new Set(),related=record.issues.map(relatedObjects),assigned=new Set();
 for(const evidence of record.evidence||[]){
  const identity=JSON.stringify([evidence.source,evidence.object,evidence.sourceId,evidence.values]);if(seen.has(identity))continue;seen.add(identity);
  const key=`${evidence.source}:${evidence.object}`,schema=schemas[key]||{label:evidence.object,dates:[],people:[],fields:[]},values=evidence.values||{};
  const formId=createHash('sha256').update(identity).digest('hex');
  const dates=schema.dates.filter(([field])=>field in values).map(([field,stage])=>({field,stage,...fieldLocation(key,field,values,evidence),value:values[field],day:calendar(values[field]),precision:calendar(values[field])?(values[field].length===10||/^T00:00:00(?:\.0+)?$/.test(values[field].slice(10))?'day-unspecified-time':'recorded-clock'):'unknown'}));
  const anchor=schema.anchor?dates.find(date=>date.field===schema.anchor):[...dates].filter(date=>date.day).sort((a,b)=>a.day.localeCompare(b.day))[0];
  const issueIndexes=related.flatMap((keys,index)=>keys.includes(key)&&matchesValues(record.issues[index],key,values)?[index]:[]);for(const index of issueIndexes)assigned.add(index);
  const form={id:formId,source:evidence.source,sourceLabel:sources[evidence.source]||evidence.source,label:schema.label,object:evidence.object,sourceId:evidence.sourceId,readAt:evidence.readAt,day:anchor?.day??null,anchorField:anchor?.field??schema.anchor??null,anchorValue:anchor?.value??null,dates,fields:schema.fields.filter(field=>field in values).map(field=>({field,value:values[field]})),issueIndexes,note:schema.note||''};
  forms.push(form);
  for(const [field,stage,dateField,kind] of schema.people){
   if(!(field in values))continue;
   const value=values[field],matches=!missing(value)&&kind==='account'&&directory?directory.users.filter(user=>user.account===value):[];
   people.push({formId,source:evidence.source,...fieldLocation(key,field,values,evidence),evidenceObject:evidence.object,evidenceSourceId:evidence.sourceId,field,stage,rawValue:value,dateField,dateValue:values[dateField]??null,name:kind==='name'&&!missing(value)?value:matches.length===1?matches[0].name:null,mappingStatus:missing(value)?'missing':kind==='name'?'source-name':matches.length===1?'current-directory':matches.length>1?'ambiguous':'unresolved',lookupSource:matches.length===1?directory.source:null,lookupAt:matches.length===1?directory.capturedAt:null});
  }
 }
 forms.sort((a,b)=>(a.day??'9999-99-99').localeCompare(b.day??'9999-99-99')||a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
 return {batchId,recordId:record.id,basis:'frozen-forms-with-current-user-lookup',userLookup:directory?{status:'available',source:directory.source,capturedAt:directory.capturedAt,queryHashes:directory.queryHashes}:{status:'unavailable'},forms,people,unassignedIssueIndexes:record.issues.flatMap((_,index)=>assigned.has(index)?[]:[index])};
}
