// Synthetic fixed source for office tests. Does not simulate approval/publication.
const assert=require('node:assert/strict');
module.exports=async function(pool,source){
 const [[target]]=await pool.execute('SELECT DATABASE() AS name');assert.match(target.name,/^stage\d{2}_isolated(?:_[a-f0-9]{32})?$/);
 const document=structuredClone(source),key='SYNTHETIC_OFFICE_FIXED_SOURCE';document.process.process_ref=key;document.process.process_name='合成办公室办理来源流程';const body=JSON.stringify(document),digest=require('../../server/processV7PreviewReview').contentHash(document);
 const [master]=await pool.execute('INSERT INTO process_design_documents(document_no,document_title,owning_department_id,process_ref) VALUES (?,?,91,?)',[key,'合成办公室办理来源制度',key]);
 const [draft]=await pool.execute("INSERT INTO process_design_drafts(document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES (?,?,?,'A',?,'synthetic','synthetic','synthetic',91)",[String(master.insertId),key,'合成办公室办理来源制度',document.process.process_name]);
 await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status) VALUES (1,?,?,?,?,'A',?,91,?,?,?,1,'published')",[String(draft.insertId),String(master.insertId),key,'合成办公室办理来源制度',key+':A',document.schema_version,body,digest]);
 await pool.execute('UPDATE process_design_documents SET current_version_id=1 WHERE id=?',[String(master.insertId)]);
};
