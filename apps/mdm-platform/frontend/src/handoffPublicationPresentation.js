import {businessStatus} from './businessPresentation.js';

export function publicationEntryName(publication) {
  if(!publication)return '查看发布内容（状态待核对）';
  const name=publication.manifest?.restores_publication_id?'恢复后发布内容':publication.state==='withdrawn'?'原发布内容':'发布内容';
  return `${name} · ${businessStatus(publication.state)}`;
}
export function handoffDraftEntryName(draft,references=[],publications=[]) {
  const ref=references.find(row=>String(row.handoff_id)===String(draft.handoff_id));
  const publication=ref&&publications.find(row=>row.publication_id===ref.publication_id);
  if(publication?.manifest?.restores_publication_id)return `恢复草案 · 对应发布${businessStatus(publication.state)}`;
  if(publication?.state==='withdrawn')return '原草案 · 对应发布已撤回';
  return `承接草案 · ${businessStatus(draft.state)}`;
}
