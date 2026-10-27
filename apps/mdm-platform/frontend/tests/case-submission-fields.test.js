import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseSubmissionCollections } from '../src/caseSubmissionFieldsModel.js';
test('pending legacy material can render without inventing participant or source facts', () => {
  for (const input of [null, {}, { participants: null }, { sources: null, participants: null, purpose: '原目的', legacy_basis: '原依据' }]) {
    const before = structuredClone(input);
    assert.deepEqual(caseSubmissionCollections(input), { sources: [], participants: [] });
    assert.deepEqual(input, before);
  }
});
test('valid declared collections retain original rows, references and unknown metadata', () => {
  const input = { sources: [{ reference: 'original', title: '原材料', extra: '保留' }], participants: [{ department_id: '91', behavior_refs: ['action_original'] }] };
  const view = caseSubmissionCollections(input);
  assert.equal(view.sources, input.sources);
  assert.equal(view.participants, input.participants);
  assert.equal(view.sources[0].extra, '保留');
  assert.deepEqual(view.participants[0].behavior_refs, ['action_original']);
});
