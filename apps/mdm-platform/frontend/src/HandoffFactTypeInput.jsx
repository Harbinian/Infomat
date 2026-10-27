import React,{useState} from 'react';
import {editableCustomFactType,factTypeChoices,knownFactTypes} from './handoffFactPresentation.js';

export default function HandoffFactTypeInput({value='',onChange,disabled=false,required=true,label='本次事实类型'}) {
  const [customValue,setCustomValue]=useState(null);
  const otherChoice=value==='__custom_business_fact_type__'?'__custom_business_fact_type_2__':'__custom_business_fact_type__';
  const enteredCustom=editableCustomFactType(value),showCustom=enteredCustom||(customValue!==null&&customValue===value);
  const choices=factTypeChoices(value).filter(row=>!showCustom||knownFactTypes.some(known=>known.value===row.value));
  function choose(next){
    if(next===otherChoice){const nextValue=enteredCustom?value:'';setCustomValue(nextValue);if(!enteredCustom)onChange('');}
    else{setCustomValue(null);onChange(next);}
  }
  return <div className="handoff-input"><label>{label}<select aria-label={label} value={showCustom?otherChoice:value||''} disabled={disabled} required={required} onChange={event=>choose(event.target.value)}>
    <option value="">请选择需要核实的事实类型</option>
    {choices.map(row=><option key={row.value} value={row.value}>{row.label}</option>)}
    <option value={otherChoice}>其他事实类型（填写业务用语）</option>
  </select></label>
    {showCustom&&<label>其他事实类型说明<input aria-label="其他事实类型说明" value={value} disabled={disabled} required={required} onChange={event=>{setCustomValue(event.target.value);onChange(event.target.value);}}/></label>}
    <p>可选择业务含义、来源依据，也可填写其他需要核实的业务事实类别。已有其他类型保持原值，除非明确选择或改填。</p>
  </div>;
}
