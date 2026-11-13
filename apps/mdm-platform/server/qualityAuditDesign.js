const { inspectFormalDepartmentDecision,inspectPreviewDepartmentDecisions } = require('./processDepartmentDecisions');
const { supports } = require('./processNativeFormats');
const { contentHash } = require('./processPreviewReview');
const { parse } = require('./dataMapDefinitionValues');
const { fail,id } = require('./qualityAuditPolicy');
const one=async(db,sql,args)=>(await db.execute(sql,args))[0][0]||null;
const stamp=value=>value==null?null:new Date(Number(value)*1000).toISOString();
// Follow the formal transition's source-first lock order. A newer preview also
// invalidates the old audit basis before it has been promoted to a formal draft.
async function inspectDesign(db,designId,{lock=false,bound=null}={}){
  const share=lock?' FOR SHARE':'';
  const locator=await one(db,'SELECT CAST(preview_case_id AS CHAR) preview_case_id FROM process_v7_promotions WHERE draft_id=? ORDER BY id DESC LIMIT 1',[id(designId)]);
  if(!locator)return {valid:false,code:'QUALITY_AUDIT_DESIGN_UNAPPROVED'};
  const current=await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(current_revision_id AS CHAR) current_revision_id FROM process_v7_preview_cases WHERE id=?'+share,[locator.preview_case_id]);
  const promotion=await one(db,'SELECT *,CAST(document_id AS CHAR) document_id,CAST(preview_revision_id AS CHAR) preview_revision_id FROM process_v7_promotions WHERE draft_id=? ORDER BY id DESC LIMIT 1'+share,[designId]);
  const document=await one(db,'SELECT *,CAST(id AS CHAR) id FROM process_design_documents WHERE id=?'+share,[promotion.document_id]);
  const draft=await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(document_id AS CHAR) document_id,CAST(department_id AS CHAR) department_id,UNIX_TIMESTAMP(content_updated_at) saved_epoch FROM process_design_drafts WHERE id=?'+share,[designId]);
  if(!current||!document||!draft||document.status!=='active')return {valid:false,code:'QUALITY_AUDIT_DESIGN_UNAPPROVED'};
  const changed=String(current.current_revision_id)!==String(promotion.preview_revision_id)||Number(current.current_revision_no)!==Number(promotion.preview_revision_no)||current.current_content_hash!==promotion.content_hash||draft.content_hash!==promotion.content_hash||String(draft.document_id)!==String(document.id);
  if(changed||bound&&(String(bound.draft_id)!==String(draft.id)||Number(bound.revision_no)!==Number(draft.revision_no)||bound.content_hash!==draft.content_hash))return {valid:false,code:'QUALITY_AUDIT_DESIGN_CHANGED'};
  if(!supports(draft.schema_version)||!['approved','published'].includes(draft.status))return {valid:false,code:'QUALITY_AUDIT_DESIGN_UNAPPROVED'};
  let body;try{body=parse(draft.process_content_json);}catch{return {valid:false,code:'QUALITY_AUDIT_DESIGN_CHANGED'};}
  if(!body||contentHash(body)!==draft.content_hash)return {valid:false,code:'QUALITY_AUDIT_DESIGN_CHANGED'};
  const task=await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(draft_id AS CHAR) draft_id,CAST(decided_by AS CHAR) decided_by,UNIX_TIMESTAMP(decided_at) decided_epoch FROM process_design_review_tasks WHERE draft_id=? ORDER BY id DESC LIMIT 1'+share,[designId]);
  const decision=await inspectFormalDepartmentDecision(db,draft,task,{lock});
  if(!decision.valid)return {valid:false,code:task?.status==='approved'?'QUALITY_AUDIT_DESIGN_CONFIRMATION_STALE':'QUALITY_AUDIT_DESIGN_UNAPPROVED'};
  if(!(await inspectPreviewDepartmentDecisions(db,current,{lock})).valid)return {valid:false,code:'QUALITY_AUDIT_DESIGN_CONFIRMATION_STALE'};
  const event=await one(db,`SELECT payload_json FROM process_design_events WHERE draft_id=? AND event_type='review_approve' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.review_task_id'))=? ORDER BY id DESC LIMIT 1${share}`,[designId,String(task.id)]);
  const department=await one(db,'SELECT CAST(id AS CHAR) id,name FROM departments WHERE id=?'+share,[draft.department_id]);
  const snapshot=parse(event.payload_json)?.actor_snapshot;
  const design={draft_id:draft.id,document_id:draft.document_id,process_name:draft.process_name,document_no:draft.document_no,department_name:department?.name||null,revision_no:Number(draft.revision_no),content_hash:draft.content_hash,review_task_id:task.id,approved_at:stamp(task.decided_epoch),approved_by_name:snapshot?.person_name||null,content_saved_at:stamp(draft.saved_epoch)};
  if(bound&&String(bound.review_task_id)!==String(task.id))return {valid:false,code:'QUALITY_AUDIT_DESIGN_CHANGED'};
  return {valid:true,design};
}
function assertDesign(result){if(!result.valid)throw fail(result.code);return result.design;}
module.exports={inspectDesign,assertDesign};
