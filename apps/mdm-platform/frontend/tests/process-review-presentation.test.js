import test from 'node:test';
import assert from 'node:assert/strict';
import { modificationOpinion, reviewCaseLabel, reviewProgress, decisionContext } from '../src/processReviewPresentation.js';

test('same-named manual scope decisions remain distinguishable by department and saved responsibility',()=>{
  const detail={items:[{id:'1',behavior_name:'核对本部门责任及接口范围',origin_department_name:'甲部',target_department_name:'乙部',item_snapshot:{participant:{responsibilities:'核对来料'}}},{id:'2',behavior_name:'核对本部门责任及接口范围',origin_department_name:'甲部',target_department_name:'丙部',item_snapshot:{participant:{responsibilities:'保留归档资料'}}}]};
  const before=structuredClone(detail),left=decisionContext(detail,'1'),right=decisionContext(detail,'2');
  assert.equal(left.title,right.title);assert.equal(left.target,'乙部');assert.equal(right.target,'丙部');
  assert.equal(left.responsibility,'核对来料');assert.equal(right.responsibility,'保留归档资料');
  assert.deepEqual(detail,before);
});

function submitted() {
  return {
    case: { id: 1, status: 'needs_revision', current_revision_no: 2, current_revision_id: 12, current_content_hash: 'current-hash' },
    revision: { id: 12, revision_no: 2, content_hash: 'current-hash', created_at: '2026-10-21T03:52:02.000Z' },
    items: [{ id: 22, case_id: 1, revision_id: 12, revision_no: 2, carry_state: 'carried_forward', carried_from_item_id: 11,
      origin_status: 'needs_changes', origin_basis: '原意见：请补充完成标准。', origin_decided_at: '2026-10-21T03:49:52.000Z', counterparty_status: 'pending' }],
    events: [{ id: 1, case_id: 1, revision_id: 11, item_id: 11, event_type: 'department_review_decision_recorded', decision: 'needs_changes', payload: { party: 'origin' } }]
  };
}

test('resubmitted revision shows waiting for recheck without changing prior opinions, history or machine state', () => {
  const detail = submitted(), before = structuredClone(detail);
  assert.equal(reviewProgress(detail).label, '已提交，待负责人重新核对');
  assert.equal(reviewProgress(detail).awaitingRecheck, true);
  assert.equal(modificationOpinion(detail, detail.items[0], 'origin'), 'inherited');
  assert.equal(reviewCaseLabel(detail.case, detail, value => value), '已提交，待负责人重新核对');
  assert.deepEqual(detail, before);
});

test('a new decision on a carried item stays a current modification request, including same-second timestamps', () => {
  const detail = submitted();
  detail.items[0].origin_decided_at = detail.revision.created_at;
  detail.events.push({ id: 5, case_id: 1, revision_id: 12, item_id: 22, event_type: 'department_review_decision_recorded', decision: 'needs_changes', payload: { party: 'origin' } });
  assert.equal(modificationOpinion(detail, detail.items[0], 'origin'), 'current');
  assert.equal(reviewProgress(detail).label, '当前修订需要修改');
  assert.equal(reviewProgress(detail).awaitingRecheck, false);
});

test('bounded history, equal or missing timestamps do not manufacture recheck evidence', () => {
  for (const time of [null, '', 'invalid', '2026-10-21T03:52:02.000Z']) {
    const detail = submitted(); detail.events = []; detail.items[0].origin_decided_at = time;
    assert.equal(modificationOpinion(detail, detail.items[0], 'origin'), 'unknown');
    assert.equal(reviewProgress(detail).awaitingRecheck, false);
  }
  const detail = submitted(); detail.events = []; detail.items[0].origin_decided_at = '2026-10-21T03:52:03.000Z';
  assert.equal(modificationOpinion(detail, detail.items[0], 'origin'), 'current');
});

test('opinions are classified separately for each party and exact revision/item binding', () => {
  const detail = submitted();
  detail.items[0].counterparty_status = 'needs_changes';
  detail.items[0].counterparty_decided_at = '2026-10-21T03:53:00.000Z';
  assert.equal(modificationOpinion(detail, detail.items[0], 'origin'), 'inherited');
  assert.equal(modificationOpinion(detail, detail.items[0], 'counterparty'), 'current');
  assert.equal(reviewProgress(detail).label, '当前修订需要修改');
  for (const update of [{ revision_id: 11 }, { revision_no: 1 }, { case_id: 2 }]) {
    assert.equal(modificationOpinion(detail, { ...detail.items[0], ...update }, 'origin'), 'unknown');
  }
});

test('new and reopened items cannot disguise a fresh modification request as an old carried opinion', () => {
  for (const carry_state of ['new', 'reopened']) {
    const detail = submitted(); Object.assign(detail.items[0], { carry_state, carried_from_item_id: null });
    assert.equal(reviewProgress(detail).label, '当前修订需要修改');
  }
});

test('list entries require the matching case, revision and hash before using detailed submission evidence', () => {
  const detail = submitted(), fallback = value => value;
  for (const update of [{ id: 2 }, { current_revision_no: 3 }, { current_content_hash: 'stale-hash' }]) {
    assert.equal(reviewCaseLabel({ ...detail.case, ...update }, detail, fallback), '存在修改意见，查看当前修订');
  }
  assert.equal(reviewCaseLabel(detail.case, null, fallback), '存在修改意见，查看当前修订');
  assert.equal(reviewCaseLabel({ status: 'closed' }, detail, fallback), 'closed');
});

test('completed, closed, first-revision and incomplete evidence do not gain a resubmission label', () => {
  for (const status of ['review_complete', 'closed', 'disputed', 'pending_owner', 'under_review']) {
    const detail = submitted(); detail.case.status = status; assert.equal(reviewProgress(detail), null);
  }
  const first = submitted(); first.case.current_revision_no = 1; first.revision.revision_no = 1; first.items[0].revision_no = 1;
  assert.equal(reviewProgress(first).awaitingRecheck, false);
  for (const update of [{ revision: null }, { items: [] }, { revision: { ...submitted().revision, content_hash: 'other-hash' } }]) {
    assert.equal(reviewProgress({ ...submitted(), ...update }).awaitingRecheck, false);
  }
});
