import {userMessage} from "./businessPresentation.js";
import React,{useEffect,useState} from 'react';
import {StatusPanel} from './components.jsx';
import {handoffWorkspaceHref} from './handoffNavigation.js';
import {handoffDraftEntryName,publicationEntryName} from './handoffPublicationPresentation.js';
import {tracePublications} from './handoffGovernancePresentation.js';
import {businessDateTime} from './businessGuidance.js';

// The native package review and the map publication are separate facts.
export function HandoffPackageProgress({api,packageId,refreshKey,onNavigate}) {
  const [state,setState]=useState({busy:true});
  useEffect(()=>{
    const controller=new AbortController();setState({busy:true});
    api.request('/api/data-map-handoffs/work-packages/'+encodeURIComponent(packageId)+'/trace',{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setState({data});})
      .catch(error=>{if(!controller.signal.aborted)setState({error});});
    return()=>controller.abort();
  },[api,packageId,refreshKey]);
  const back='/app/data-governance?package='+encodeURIComponent(packageId),data=state.data;
  const href=selection=>handoffWorkspaceHref(selection,back);
  const publications=tracePublications(data),references=publications.map(row=>({...row,handoff_id:data?.revisions?.find(revision=>revision.revision_id===row.handoff_revision_id)?.handoff_id}));
  return <section className="card" aria-label="本工作包的数据地图承接"><h2>本工作包的数据地图承接</h2>
    <p>工作包完成审核、承接草案获批与数据地图生效分别记录。请选择需要办理的事项，返回此工作包后重新读取；进入页面不会自动承接或发布。</p>
    <a href={href({kind:'package',id:String(packageId)})} onClick={onNavigate}>进入本包承接与追溯</a>
    {state.busy?<StatusPanel kind="loading" title="正在核对本包承接记录…"/>:state.error?<StatusPanel kind="error" title="本包承接状态暂不可用">{userMessage(state.error)} 读取失败不表示尚无承接或已办理完成。</StatusPanel>:<>
      <p>已审核材料 {data.bindings?.length||0} 条；承接草案 {data.drafts?.length||0} 份；发布事实 {data.publications?.length||0} 份。发布事实仍须另核对现行来源及引用资格。</p>
      {!data.bindings?.length&&<p>本包尚无可供承接的审核绑定；已完成旧包须本次接入核验，未完成工作包继续原审核流程。</p>}
      <ul>{data.drafts?.map(row=><li key={row.handoff_id}><a href={href({kind:'handoff',id:row.handoff_id})} onClick={onNavigate}>查看{handoffDraftEntryName(row,references,publications)} · {businessDateTime(row.created_at)}</a></li>)}</ul>
      <ul>{publications.map(row=>{
        return <li key={row.publication_id}><a href={href({kind:'publication',id:row.publication_id})} onClick={onNavigate}>查看{publicationEntryName(row)} · {businessDateTime(row.published_at)}</a></li>;
      })}</ul>
    </>}
  </section>;
}
