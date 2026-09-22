// Technical reading coverage only; no inferred business conclusions.
const {digest}=require('./dataMapDefinitionValues');
const VERSION='pdf-extraction-v1',PARSER='pdf_evidence';
const catalog=[['pdf.coverage','PDF读取覆盖'],['pdf.position','页码与文本定位'],['pdf.business','业务事实核验']].map(([rule_id,title])=>({rule_id,title,enabled:true,rule_version:VERSION,prerequisite:'固定PDF读取快照',not_applicable:rule_id==='pdf.business'?'不核验业务事实，始终标未覆盖':'仅文本层，不执行OCR或表格重建'}));
const CHECKS=catalog.map(c=>c.rule_id).sort();
function enabledManifest(m){return !m.ai_metadata&&m.rule_version===VERSION&&Object.keys(m.parser_versions).length===1&&m.parser_versions[PARSER]===VERSION&&m.inputs.every(i=>i.snapshot.source_kind==='pdf_material')&&m.steps.every(s=>s.parser_key===PARSER&&s.input_keys.length===1&&s.check_ids.every(c=>CHECKS.includes(c)));}
function analyze(task){
 const evidence=[],findings=[],checked=task.step.check_ids.filter(c=>c!=='pdf.business');
 for(const input of task.inputs){const doc=input.document;
  const add=(rule,locator,semantic,message)=>{if(!checked.includes(rule))return;const evidence_key='e'+digest([input.input_key,rule,semantic]).slice(0,48);
   evidence.push({evidence_key,input_key:input.input_key,locator_kind:'json_pointer',locator,note:message});
   findings.push({rule_id:rule,finding_type:'not_covered',message,subject_input_keys:[input.input_key],semantic_locator:semantic,evidence_keys:[evidence_key]});};
  add('pdf.coverage','/coverage','document:extraction-coverage',`共 ${doc.coverage.page_count} 页，${doc.coverage.text_page_count} 页提取到文字。${doc.coverage.not_covered.join('；')}。${doc.links.length?'显式关联仅表示固定引用，不表示业务认定。':'未登记对象、字段或V7来源的显式关联。'}`);
  const first=doc.anchors.findIndex(a=>a.text.trim());
  add('pdf.position',first<0?'/coverage':`/anchors/${first}`,'document:text-position',first<0?'未提取到文本层，提取不足；没有执行OCR，不据此断言原件没有内容。':'此处定位首个文字片段；全部物理页及文本位置可在证据浏览中核对。重复标题分别保留，不按名称合并；不重建表格或推断跨页关系。');
 }
 const missing=task.step.check_ids.filter(c=>!checked.includes(c));
 return {status:!checked.length?'failed':missing.length?'partial':'succeeded',checked_ids:checked,error_code:!checked.length||missing.length?'INPUT_INCOMPLETE':null,evidence:checked.length?evidence:[],findings:checked.length?findings:[]};
}
module.exports={VERSION,PARSER,CHECKS,catalog,enabledManifest,analyze};
