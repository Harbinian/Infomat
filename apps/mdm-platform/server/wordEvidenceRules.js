// Reading coverage only; no business conclusions and no document instructions executed.
const { digest } = require('./dataMapDefinitionValues');
const VERSION='word-extraction-v1', PARSER='word_evidence';
const catalog=[['word.coverage','DOCX读取覆盖'],['word.structure','正文结构定位'],['word.business','业务事实核验']].map(([rule_id,title])=>({rule_id,title,enabled:true,rule_version:VERSION,prerequisite:'固定DOCX读取快照',not_applicable:rule_id==='word.business'?'不核验业务事实，始终标未覆盖':'未渲染，不提供页码或视觉版式结论'}));
const CHECKS=catalog.map(c=>c.rule_id).sort();
function enabledManifest(m){return !m.ai_metadata&&m.rule_version===VERSION&&Object.keys(m.parser_versions).length===1&&m.parser_versions[PARSER]===VERSION&&m.inputs.every(i=>i.snapshot.source_kind==='word_material')&&m.steps.every(s=>s.parser_key===PARSER&&s.input_keys.length===1&&s.check_ids.every(c=>CHECKS.includes(c)));}
function analyze(task){
 const evidence=[],findings=[],checked=task.step.check_ids.filter(c=>c!=='word.business');
 for(const input of task.inputs){const doc=input.document;
  const add=(rule,locator,semantic,message)=>{if(!checked.includes(rule))return;const evidence_key='e'+digest([input.input_key,rule,semantic]).slice(0,48);
   evidence.push({evidence_key,input_key:input.input_key,locator_kind:'json_pointer',locator,note:message});
   findings.push({rule_id:rule,finding_type:'not_covered',message,subject_input_keys:[input.input_key],semantic_locator:semantic,evidence_keys:[evidence_key]});};
  add('word.coverage','/coverage','document:extraction-coverage',`读取 ${doc.coverage.paragraph_count} 段正文、${doc.coverage.table_count} 个表格。${doc.coverage.not_covered.join('；')}。${doc.links.length?'显式关联仅表示固定引用，不表示业务认定。':'未登记对象、字段或V7来源的显式关联。'}`);
  const first=doc.anchors.findIndex(a=>a.kind==='paragraph');
  add('word.structure',first<0?'/coverage':`/anchors/${first}`,'document:structural-reading',first<0?'未提取到正文段落，不据此断言原文件没有内容。':'此处定位首个正文段落；全部结构可在证据浏览中核对。重复标题分别保留，不按名称自动合并。未经渲染，不提供页码；正文文字及缓存未经业务核验。');
 }
 const missing=task.step.check_ids.filter(c=>!checked.includes(c));
 return {status:!checked.length?'failed':missing.length?'partial':'succeeded',checked_ids:checked,error_code:!checked.length||missing.length?'INPUT_INCOMPLETE':null,evidence:checked.length?evidence:[],findings:checked.length?findings:[]};
}
module.exports={VERSION,PARSER,CHECKS,catalog,enabledManifest,analyze};
