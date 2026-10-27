import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationEntryName,handoffDraftEntryName} from '../src/handoffPublicationPresentation.js';
test('original and restoration entries use exact authorized publication state and relationships without deriving status from draft state',()=>{
  const refs=[{publication_id:'old',handoff_id:'original'},{publication_id:'new',handoff_id:'restoration'}],publications=[{publication_id:'old',state:'withdrawn',manifest:{}},{publication_id:'new',state:'published',manifest:{restores_publication_id:'old'}}],before=structuredClone(publications);
  assert.equal(publicationEntryName(publications[0]),'原发布内容 · 已撤回');assert.equal(publicationEntryName(publications[1]),'恢复后发布内容 · 已发布');
  assert.equal(handoffDraftEntryName({handoff_id:'original',state:'published'},refs,publications),'原草案 · 对应发布已撤回');assert.equal(handoffDraftEntryName({handoff_id:'restoration',state:'published'},refs,publications),'恢复草案 · 对应发布已发布');
  assert.equal(publicationEntryName(undefined),'查看发布内容（状态待核对）');assert.equal(publicationEntryName({state:'unknown_internal_state'}),'发布内容 · 状态待核对');assert.equal(handoffDraftEntryName({handoff_id:'other',state:'draft'},refs,publications),'承接草案 · 草稿');assert.deepEqual(publications,before);
});
