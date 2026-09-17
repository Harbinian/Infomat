// Only reads native V7. Never promotes, publishes or creates a work package.
const crypto=require('node:crypto');
const {failure,id,parse}=require('./dataMapDefinitionValues');
const {contentHash,validateAndProjectV7}=require('./processV7PreviewReview');
const {readFixedPreviewRevision}=require('./processV7PreviewReviewRepository');
const {readFixedPublishedVersion,versionDocument}=require('./processDataGovernanceRepository');
const ALGORITHM='sha256-v7-stable-json-v1',MAX_BYTES=4*1024*1024;
function parseUpload(bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)throw failure('DEFINITION_V7_UPLOAD_LIMIT',413);
  const raw_sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  let document;
  try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{return {document:null,raw_sha256,byte_length:bytes.length,parse_failed:true};}
  const pending=[[document,0]];let count=0;
  while(pending.length){const [value,depth]=pending.pop();if(++count>100000||depth>64)throw failure('DEFINITION_V7_UPLOAD_LIMIT',413);if(value&&typeof value==='object')for(const item of Object.values(value))pending.push([item,depth+1]);}
  return {document,raw_sha256,byte_length:bytes.length};
}
async function validation(db,document,options={}){
  const [departments]=await db.execute("SELECT id,code,name FROM departments WHERE status='active' FOR SHARE");
  const v=validateAndProjectV7(document,departments,options);
  return {errors:v.errors||[],blocking_issues:v.blockingIssues||[],warnings:v.warnings||[]};
}
async function readReference(db,kind,refs,who,scope){
  let row;
  if(kind==='preview_revision'){
    if(process.env.PROCESS_V7_PREVIEW_ENABLED!=='1')throw failure('DEFINITION_V7_PREVIEW_DISABLED',503);
    row=await readFixedPreviewRevision(db,id(refs.case_id),id(refs.revision_id));
  }else if(kind==='published_version'){
    if(process.env.PROCESS_V7_FORMAL_ENABLED!=='1')throw failure('DEFINITION_V7_FORMAL_DISABLED',503);
    row=await readFixedPublishedVersion(db,id(refs.process_version_id),true);
    if(row){row.scope_department_id=String(row.department_id);}
  }else throw failure('DEFINITION_V7_SOURCE_KIND_INVALID');
  if(!row)throw failure('DEFINITION_V7_SOURCE_NOT_FOUND',404);
  scope(who,row.scope_department_id);
  if(kind==='published_version'&&(!['published','superseded'].includes(row.status)||row.schema_version!=='process-governance-v7'))throw failure('DEFINITION_V7_NOT_PUBLISHED',409);
  let document;try{document=kind==='published_version'?versionDocument(row):parse(row.content_json);}catch(e){throw failure(e.code==='PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED'?'DEFINITION_V7_SOURCE_CHANGED':'DEFINITION_V7_SOURCE_INVALID',409);}
  const hash=contentHash(document);
  if(!row.content_hash||hash!==row.content_hash)throw failure('DEFINITION_V7_SOURCE_CHANGED',409);
  return {document,content_digest:hash,scope_department_id:row.scope_department_id,options:row.owning_department_name?{owningDepartmentName:row.owning_department_name}:{}};
}
module.exports={ALGORITHM,MAX_BYTES,parseUpload,validation,readReference,contentHash};
