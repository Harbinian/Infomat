// Extraction findings only. Business meaning and mapping authority remain unconfirmed.
const { digest }=require('./dataMapDefinitionValues');
const VERSION='excel-extraction-v1',PARSER='excel_evidence';
const catalog=[['excel.coverage','读取范围与未覆盖内容'],['excel.formulas','公式缓存待核实'],['excel.business','业务事实核验']].map(([rule_id,title])=>({rule_id,title,enabled:true,rule_version:VERSION,prerequisite:'固定Excel读取快照',not_applicable:rule_id==='excel.business'?'本适配器不核验业务事实，始终标未覆盖':'不计算公式或执行材料指令'}));
const CHECKS=catalog.map(c=>c.rule_id).sort();
function enabledManifest(m){return !m.ai_metadata&&m.rule_version===VERSION&&Object.keys(m.parser_versions).length===1&&m.parser_versions[PARSER]===VERSION&&m.inputs.every(i=>i.snapshot.source_kind==='excel_material')&&m.steps.every(s=>s.parser_key===PARSER&&s.input_keys.length===1&&s.check_ids.every(c=>CHECKS.includes(c)));}
function analyze(task){
 const evidence=[],findings=[],checked=task.step.check_ids.filter(c=>c!=='excel.business');
 for(const input of task.inputs){
  const doc=input.document;
  function add(rule,locator,semantic,message,type='not_covered'){
   if(!checked.includes(rule))return;
   const evidence_key='e'+digest([input.input_key,rule,semantic]).slice(0,48);
   evidence.push({evidence_key,input_key:input.input_key,locator_kind:'json_pointer',locator,note:message});
   findings.push({rule_id:rule,finding_type:type,message,subject_input_keys:[input.input_key],semantic_locator:semantic,evidence_keys:[evidence_key]});
  }
  add('excel.coverage','/coverage','workbook:extraction-coverage',`本文件读取 ${doc.sheets.length} 张工作表、${doc.coverage.cell_count} 个有值或合并引用单元格。${doc.coverage.not_covered.join('；')}。${doc.links.length?'关联仅为显式固定引用，未形成业务认定。':'尚未登记对象、字段或V7来源的显式关联。'}`);
  if(!doc.coverage.cell_count)add('excel.coverage','/coverage','workbook:empty','未提取到单元格内容；不据此断言原文件没有其他内容。');
  doc.sheets.forEach((s,index)=>{
   const formulas=Object.values(s.cells).filter(c=>c.raw_type==='formula');
   if(formulas.length){const cell=formulas[0];add('excel.formulas',`/sheets/${index}/cells/${cell.address}`,`sheet=${encodeURIComponent(s.name)}:formula-cache`,`${s.name} 有 ${formulas.length} 个公式单元格；这里只定位首个 ${cell.address}，全部单元格可在证据浏览中核对。公式未执行，缓存可能缺失、无效或过期，不据此判定业务错误。`,'business_question');}
  });
 }
 const missing=task.step.check_ids.filter(c=>!checked.includes(c));
 return {status:!checked.length?'failed':missing.length?'partial':'succeeded',checked_ids:checked,error_code:!checked.length||missing.length?'INPUT_INCOMPLETE':null,evidence:checked.length?evidence:[],findings:checked.length?findings:[]};
}
module.exports={VERSION,PARSER,CHECKS,catalog,enabledManifest,analyze};
