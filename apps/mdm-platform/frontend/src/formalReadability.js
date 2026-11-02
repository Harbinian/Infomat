import {businessLocation,businessName,businessText,userMessage} from './businessPresentation.js';
import {processChecksPresentation,processIssuePresentation} from './processActionGuidance.js';

const locationAdvice='请在“检查问题原文查阅”选择本项，再点击“查阅所选问题原文”。本区只读；需要修改时，请按该区修订说明返回原案例办理。';
const legacyFieldMessage=/^(.*)的字段\d+(.+)$/u;
const missingLocation='原检查中有填写项尚待核对，但当前材料无法准确定位该项。请核对本修订的原表单后重新检查。';

// Prerequisites are strings, so reuse only exactly matching checks from the same
// saved revision. Never infer an item from its ordinal or a similar form name.
export function formalPrerequisites(detail) {
  const document=detail?.revision?.document;
  const checks=[...(detail?.content_checks?.issues||[]),...(detail?.blocking_issues||[])];
  return (detail?.handling_summary?.prerequisites||[]).map(value=>{
    const message=typeof value==='string'?value:value?.message;
    if(!legacyFieldMessage.test(message||''))return userMessage(value,'当前还有办理条件待核对，请查看本案例的核对结果。');
    const matching=checks.filter(issue=>issue.message===message);
    const projected=matching.length?matching.map(issue=>processIssuePresentation(issue,document)):[processIssuePresentation({message},document)];
    return [...new Set(projected.map(issue=>legacyFieldMessage.test(issue?.message||'')?missingLocation:userMessage(issue.message,missingLocation)))].join('；');
  });
}

export function formalReadOnlyChecks(checks,document) {
  const presentation=processChecksPresentation(checks,document);
  return presentation?{...presentation,issues:presentation.issues?.map(issue=>({...issue,message:legacyFieldMessage.test(issue.message||'')?missingLocation:issue.message,suggestions:issue.suggestions?.map(value=>
    typeof value==='string'&&/点击本项返回对应位置|页面高亮/u.test(value)?locationAdvice:value)}))}:presentation;
}

// This resolver reads only an explicit saved path or an exact behavior reference.
// It supplies business details locally; opening a location never creates a draft.
export function formalIssueLocation(issue,document) {
  if(!issue||!document)return null;
  const path=String(issue.path||issue.focusPath||'').replaceAll('/','.').replaceAll('[','.').replaceAll(']','').replace(/^\./,'');
  const field=/^forms\.(\d+)\.areas\.(\d+)\.items\.(\d+)(?:\.|$)/.exec(path);
  if(field){
    const form=document.forms?.[Number(field[1])],area=form?.areas?.[Number(field[2])],item=area?.items?.[Number(field[3])];
    if(!item)return null;
    return {label:`《${businessText(form.form_name||'表单名称未记录')}》／${businessText(area.area_title||'区域名称未记录')}：${businessText(item.item_name||'填写项名称未记录')}`,value:item};
  }
  const row=/^(behaviors|data_objects|forms|terms)\.(\d+)(?:\.|$)/.exec(path);
  if(row){
    const value=document[row[1]]?.[Number(row[2])];
    return value?{label:row[1]==='forms'?businessText(value.form_name||'原表单名称未记录'):businessName(value,'原文名称未记录'),value}:null;
  }
  if(issue.behavior_ref){
    const matches=(document.behaviors||[]).filter(value=>value.behavior_ref===issue.behavior_ref);
    if(matches.length===1)return {label:businessName(matches[0],'原环节名称未记录'),value:matches[0]};
  }
  if(path==='process'||path.startsWith('process.'))return document.process?{label:'流程基本说明',value:document.process}:null;
  return null;
}

export const formalIssueLabel=issue=>userMessage(issue?.message,'需核对的问题（请查阅原案例）');
export const formalIssueBusinessPath=issue=>businessLocation(issue?.path||issue?.focusPath);
