import React,{useEffect,useRef,useState} from 'react';
import {BusinessSelect} from './BusinessDetails.jsx';
import {businessStatus,userMessage} from './businessPresentation.js';
import {fixedSourceName} from './handoffGovernancePresentation.js';

// Workbench rows intentionally do not carry full source material. Read only the
// already visible packages when the user asks, so equal titles gain real editions.
export async function readablePackageChoices(api,packages,signal){
  const found=new Array(packages.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,packages.length)},async()=>{
    while(cursor<packages.length&&!signal?.aborted){const index=cursor++,row=packages[index];try{found[index]={status:'fulfilled',value:await api('/api/data-map-handoffs/work-packages/'+encodeURIComponent(row.package_id)+'/trace',{signal})};}catch(reason){found[index]={status:'rejected',reason};}}
  }));
  signal?.throwIfAborted();
  return {items:packages.map((row,index)=>({value:row.package_id,label:found[index].status==='fulfilled'?fixedSourceName(found[index].value.source)+' · '+businessStatus(found[index].value.source?.status)+' · 工作包'+businessStatus(row.status):fixedSourceName(row)+' · 来源说明暂未读取'})),incomplete:found.some(row=>row.status==='rejected')};
}

export default function HandoffPackagePicker({api,packages=[],label,value,onChange,disabled=false}){
  const [state,setState]=useState({}),active=useRef(null),generation=useRef(0);
  const scope=JSON.stringify(packages.map(row=>[row.package_id,row.process_version_id,row.status]));
  useEffect(()=>{generation.current++;active.current?.abort();setState({});return()=>active.current?.abort();},[api,scope]);
  async function read(){
    active.current?.abort();const controller=new AbortController(),token=++generation.current;active.current=controller;setState({busy:true});
    try{const result=await readablePackageChoices(api,packages,controller.signal);if(!controller.signal.aborted&&generation.current===token)setState(result);}
    catch(error){if(!controller.signal.aborted&&generation.current===token)setState({error:userMessage(error,'工作包材料暂时无法读取，原选择保留，请稍后重读。')});}
  }
  return <fieldset aria-label={label+'选择'}><legend>{label}</legend><button type="button" disabled={disabled||state.busy} onClick={read}>读取可选工作包</button>{state.busy&&<p>正在读取有权查阅的工作包名称、流程版次及状态，原选择保留。</p>}{state.error&&<p role="alert">{state.error}</p>}{state.incomplete&&<p role="status">部分来源说明暂未读取，不能据此判断没有材料。请核对后重新读取。</p>}<BusinessSelect label={label} value={value} onChange={onChange} items={state.items||[]} disabled={disabled||state.busy} empty="请选择流程、版次及状态相符的工作包"/></fieldset>;
}
