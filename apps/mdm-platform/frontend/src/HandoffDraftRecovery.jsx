import React,{useEffect,useRef,useState} from 'react';
import {StatusPanel} from './components.jsx';
import {userMessage} from './businessPresentation.js';
import {handoffOwner} from './dataMapHandoffRequest.js';
import {sameHandoffPersonAccountDepartment,verifyHandoffDraftRecovery} from './handoffDraftRecovery.js';

export function HandoffDraftRecovery({api,user,draft,setDraft}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),pending=useRef(null),current=useRef(null);
  const owner=handoffOwner(user);current.current={owner,draft};
  useEffect(()=>{setBusy(false);setError(null);return()=>pending.current?.abort();},[owner,draft]);
  async function recover(){
    if(pending.current||!sameHandoffPersonAccountDepartment(draft,owner))return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError(null);
    try {
      const restored=await verifyHandoffDraftRecovery(api,draft,owner,{signal:controller.signal});
      if(!controller.signal.aborted&&current.current.owner===owner&&current.current.draft===draft)setDraft(previous=>previous===draft?restored:previous);
    }catch(e){if(!controller.signal.aborted)setError(e);}
    finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  return <StatusPanel title="原身份的承接输入已保留"><p>当前账号、部门或授权已变化，原输入和原请求继续保留，系统不会自动重发。</p>{sameHandoffPersonAccountDepartment(draft,owner)?<><p>你仍使用原人员、账号和部门。请先核对当前对该事项的访问资格，再恢复查看输入；提交结果未明确时仍须查询原回执。</p><button type="button" className="secondary" disabled={busy} onClick={recover}>{busy?'正在核对当前资格…':'核对当前资格并恢复原输入'}</button></>:<p>请使用原人员、账号和部门返回核对，当前身份不能查看或覆盖原输入。</p>}{error&&<p role="alert">当前无法恢复输入：{userMessage(error)}。原输入仍保留。</p>}</StatusPanel>;
}
