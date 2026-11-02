const {parse,digest}=require('./dataMapHandoffPolicy');
const {buildSourceIndex,buildGovernanceCandidates}=require('./processDataGovernance');

// Names come from the package's exact, hash-verified source. They are a read
// projection and never enter immutable review bodies or their existing hashes.
function fixedSourcePresentation(source,expectedHash){
  let document,valid=false;
  try{document=parse(source?.process_content_json);valid=Boolean(document&&source?.content_hash===expectedHash&&digest(document)===expectedHash);}catch{}
  return {process_name:valid?document.process?.process_name||null:null,document_title:valid?source.document_title||null:null,
    edition:valid?source.edition||null:null,presentation_available:valid};
}
function detailSourcePresentation(source,expectedHash,details){
  if(!fixedSourcePresentation(source,expectedHash).presentation_available)return [];
  const document=parse(source.process_content_json),index=buildSourceIndex(document),candidates=new Map(buildGovernanceCandidates(document).map(row=>[row.detail_ref,row]));
  return details.map(row=>{
    const snapshot=parse(row.snapshot_json),candidate=candidates.get(snapshot?.detail_ref);
    const valid=Boolean(candidate&&candidate.source_digest===snapshot.source_digest&&candidate.detail_type===snapshot.detail_type);
    return {detail_version_id:row.detail_version_id,detail_ref:snapshot?.detail_ref,source:valid?index.get(snapshot.detail_ref)||null:null};
  });
}
module.exports={fixedSourcePresentation,detailSourcePresentation};
