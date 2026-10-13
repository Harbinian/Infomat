// Historical event contract. The caller retains all transaction and lock ownership.
const {parse,failure} = require('./dataMapDefinitionValues');
const SOURCE_TYPE = 'v7_authoring_reply';
function issuePayload({recordId,caseId,requestKey,reference,revisionNo,contentHash,actorPersonId,fixedSources}) {
  return {source_type:SOURCE_TYPE,record_id:recordId,case_id:caseId,request_key:requestKey,...reference,
    revision_no:revisionNo,content_hash:contentHash,actor_person_id:String(actorPersonId),fixed_sources:fixedSources};
}
function officeNote(payload,content) { return {...payload,content}; }
function officeReply(event,{issueId,todoId}) {
  const note = parse(event.note);
  if (note.source_type !== SOURCE_TYPE || note.issue_id !== issueId || note.todo_id !== String(todoId) || note.actor_person_id !== event.actor_person_id || note.content !== event.content_text) {
    throw failure('DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT',409);
  }
  return {id:event.id,content:event.content_text,actor_name:event.actor_name,created_at:new Date(Number(event.created_epoch)*1000).toISOString()};
}
module.exports = {SOURCE_TYPE,issuePayload,officeNote,officeReply};
