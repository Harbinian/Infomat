// Explicit, append-only usage corrections restrict existing evidence only.
// No text inference, authority grant, source rewrite or historical deletion.
function applyConfirmationUsage(changes,events){
  for(const event of events){
    const p=typeof event.payload_json==='string'?JSON.parse(event.payload_json):event.payload_json;
    const change=changes.find(row=>row.change_id===p?.change_id);
    const confirmation=change?.confirmations.find(row=>row.confirmation_id===p?.confirmation_id);
    if(p?.schema_version!=='process-case-confirmation-usage-v1'||p.purpose!=='functional_test'||p.counts_as_department_confirmation!==false||
      p.authority?.source!=='user_explicit_instruction'||!p.authority.quote?.trim()||!event.basis_text?.trim()||
      !change||!confirmation||String(p.case_id)!==String(change.case_id)||String(event.case_id)!==String(change.case_id)||
      String(event.revision_id)!==String(change.revision_id)||Number(p.source_revision_no)!==Number(change.revision_no)||
      p.source_content_hash!==change.content_hash||String(p.department_id)!==String(confirmation.department_id)||
      String(p.confirmed_by_person_id)!==String(confirmation.confirmed_by_person_id)){
      throw Object.assign(new Error('确认用途更正记录与原记录绑定不一致，不能放行正式办理'),{code:'PROCESS_CASE_HISTORY_INVALID',statusCode:409});
    }
    confirmation.usage={purpose:'functional_test',counts_as_department_confirmation:false,event_id:String(event.id),basis:event.basis_text};
  }
  return changes;
}
module.exports={applyConfirmationUsage};
