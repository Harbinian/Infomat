import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BusinessDetails,AllowedValuesEditor,BusinessRecordPicker,BusinessDocumentLink,BusinessCatalogProvider,BusinessReference} from '../src/BusinessDetails.jsx';
import {InputProtection,StatusPanel} from '../src/components.jsx';
import {ProcessChecks} from '../src/ProcessChecks.jsx';
import {RoleManagement} from '../src/RoleManagement.jsx';
import {RoleGuide} from '../src/RoleGuide.jsx';
import {TerminologyGovernance} from '../src/TerminologyGovernance.jsx';
import {ObjectManagement} from '../src/ObjectManagement.jsx';
import {TemplateImport} from '../src/TemplateImport.jsx';
import {ExcelEvidence} from '../src/ExcelEvidence.jsx';
import {FieldIdentity} from '../src/FieldIdentity.jsx';
import HandoffPublicationPanel from '../src/HandoffPublicationPanel.jsx';
import {HandoffDraftFields} from '../src/HandoffDraftEditor.jsx';
import {createApiClient} from '../src/api.js';
import '../src/styles.css';
import '../src/presentation/tech-ui.css';
const api=createApiClient();
const secret='12345678-abcd-4321-9876-123456789abc',hash='a'.repeat(64);
const query=new URLSearchParams(location.search),screen=query.get('screen');
window.copyEvidence={};
function FormValues(){const [value,setValue]=useState('[0,false,"未完成"]');return <form onSubmit={event=>{event.preventDefault();window.copyEvidence.saved=JSON.parse(value);}}><AllowedValuesEditor label="允许填写的值" value={value} onChange={setValue}/><button>保存允许值</button></form>;}
function Picker(){const [value,setValue]=useState('');return <BusinessRecordPicker api={api} kind={query.get('kind')||'definitionVersion'} label="选择对象或字段" value={value} onChange={next=>{setValue(next);window.copyEvidence.selected=next;}}/>;}
function Reference(){const [value,setValue]=useState('');return <BusinessCatalogProvider value={{objects:[{value:'9007199254740999',kind:'object',name:'资产卡片'}],fields:[{value:'9007199254740998',kind:'field',name:'资产原值'}]}}><BusinessReference label="选择要修改的字段" targetKind="field" value={value} onChange={next=>{setValue(next);window.copyEvidence.selected=next;}}/></BusinessCatalogProvider>;}
function Withdrawal(){const [draft,setDraft]=useState(null),[revision,setRevision]=useState(1);const resource={publication_id:secret,event_revision:revision,state:'published',package_id:'9007199254740999',allowed_actions:['withdrawal_checks','withdrawal_approval','withdraw_publication'],manifest:{scope_mode:'current',items:[{item_ref:'object:1',target_kind:'object',target_id:'9007199254740999',target_version_ref:secret,operation:'create',produces_version:true,payload:{definition:{name:'资产卡片',business_meaning:'记录每项固定资产的业务事实'},schema_version:'synthetic-schema-v1',content_hash:hash}}]},events:[]};
  const edit=(key,value)=>setDraft(d=>({...d,values:{...d.values,[key]:value}}));
  const execute=async action=>{window.copyEvidence.requests=[...(window.copyEvidence.requests||[]),structuredClone(action)];const report={reason:action.body.reason,event_revision:1,scope_mode:'current',binding_digest:hash,produced_items:[{}],reused_items:[],heads:[{subject_kind:'object',subject_id:'9007199254740999',will_clear:true}],impact_manifest:[]};setDraft(d=>({...d,lastResult:action.url.endsWith('withdrawal-checks')?{publication_id:secret,business_outcome:'withdrawal_checked',report}:action.url.endsWith('withdrawal-approvals')?{publication_id:secret,business_outcome:'withdrawal_approved',binding_digest:hash,withdrawal_approval_id:secret}:{publication_id:secret,business_outcome:'withdrawn'}}));};
  return <><button onClick={()=>setRevision(2)}>模拟来源变化</button><HandoffPublicationPanel api={api.request} selection={{kind:'publication',id:secret}} select={()=>{}} resource={resource} trace={{revisions:[],restoration_links:[]}} capabilities={{}} draft={draft} begin={(kind,values)=>setDraft({kind,values})} edit={edit} execute={execute}/></>;
}
function Objects(){const [draft,setDraft]=useState(null);return <ObjectManagement api={api} draft={draft} setDraft={setDraft} user={{personId:42}}/>;}
function Import(){const [draft,setDraft]=useState({file:new File(['synthetic'],'合成填报.xlsx'),ownerPersonId:42,selections:{},parsed:{summary:{object_count:1,field_count:0,example_rows:0,reserved_rows:0},source:{raw_sha256:hash},status:'valid',issues:[],objects:[{values:{name:'采购订单',source_location:'采购制度第六条'},record_type:'object',source_row:3,local_id:'object:1',sheet_name:'对象清单',cells:[]}],fields:[]}});return <TemplateImport api={api} draft={draft} setDraft={setDraft}/>;}
function Terms(){const [draft,setDraft]=useState(null);return <TerminologyGovernance api={api} user={{personId:42,permissions:[]}} draft={draft} setDraft={setDraft}/>;}
function Excel(){const [draft,setDraft]=useState(null);return <ExcelEvidence api={api} draft={draft} setDraft={setDraft} batchId="synthetic-excel-batch" canWrite={false}/>;}
function Identity(){const [draft,setDraft]=useState(null);return <FieldIdentity api={api} user={{personId:42,departmentId:91,permissions:[]}} context={{id:'synthetic-context',dept_id:91}} fields={[{id:'9007199254740998',field_name_cn:'资产原值'}]} draft={draft} setDraft={setDraft} onQueryChange={()=>{}}/>;}
function Draft(){const [value,setValue]=useState({scope_mode:'current',basis:'核对原始资料',items:[{item_ref:'object:1',target_kind:'object',operation:'create',definition:{name:'资产卡片',business_meaning:'固定资产记录',unique_identifiers:[{kind:'single',field_item_refs:[],basis:'按资产编码识别'}]},source_detail_refs:[],authority:[{attribute_ref:'business_meaning',sor_system_ref:'资产系统',manager_department_id:'91',basis:'制度说明',evidence_refs:['制度第三条']}]}]});return <BusinessCatalogProvider value={{departments:[{id:'91',name:'财务部'}],details:[],objects:[],versions:[],fieldVersions:[]}}><HandoffDraftFields value={value} onChange={next=>{setValue(next);window.copyEvidence.draft=next;}}/></BusinessCatalogProvider>;}
function App(){return <InputProtection><main style={{maxWidth:1400,margin:'20px auto',padding:20}}><h1>合成界面验证</h1>{screen==='identity'?<Identity/>:screen==='excel'?<Excel/>:screen==='reference'?<Reference/>:screen==='terms'?<Terms/>:screen==='guide'?<RoleGuide api={api} user={{roleCodes:['SYNTHETIC_ADMIN'],permissions:[]}} onQueryChange={()=>{}}/>:screen==='roles'?<RoleManagement api={api}/>:screen==='objects'?<Objects/>:screen==='import'?<Import/>:screen==='values'?<FormValues/>:screen==='picker'?<Picker/>:screen==='withdrawal'?<Withdrawal/>:screen==='draft'?<Draft/>:<><BusinessDetails value={{id:secret,revision_no:37,schema_version:'synthetic-schema-v1',content_hash:hash,permission_code:'GOVERNANCE_PUBLISH',employee_no:'E00042',document_no:'GLTX-JY-27-A',definition:{name:'固定资产卡片',business_meaning:'记录固定资产的原值与责任部门',required:false},unknownPayload:{code:secret},message:'记录保留，等待核对'}}/><BusinessDocumentLink api={api} path={'/api/synthetic/detail'}>查阅关联内容</BusinessDocumentLink><ProcessChecks checks={{status:'ready',counts:{technical:1},issues:[{group:'technical',category:'内容缺项',message:'请填写此环节的完成标准。',path:'behaviors[3].completion_standard',code:'SYNTHETIC_MISSING',suggestions:['核对制度第五条。']}]}}/><StatusPanel kind="error" title="本次结果待核对">提交结果尚未确认，填写的内容仍保留。</StatusPanel></>}</main></InputProtection>;}
createRoot(document.getElementById('root')).render(<App/>);
