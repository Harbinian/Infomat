import {businessText} from './businessPresentation.js';
const same = (left, right) => left != null && right != null && String(left) === String(right);

export function decisionContext(detail, itemId) {
  const item = detail?.items?.find(row => same(row.id,itemId));
  return {title:businessText(item?.behavior_name||'所选核对事项名称未记录，请返回核对原事项'),
    origin:businessText(item?.origin_department_name||'归口部门名称未记录'),
    target:businessText(item?.target_department_name||'参与部门名称未记录'),
    responsibility:businessText(item?.item_snapshot?.participant?.responsibilities||item?.actor_role||'此项未单独记录责任说明，请查看所选事项的事实依据')};
}

function currentItem(detail, item) {
  const row = detail?.case, revision = detail?.revision;
  return row && revision && same(row.current_revision_id, revision.id)
    && same(row.current_revision_no, revision.revision_no)
    && typeof row.current_content_hash === 'string' && row.current_content_hash.length > 0
    && row.current_content_hash === revision.content_hash
    && same(item.case_id, row.id) && same(item.revision_id, revision.id)
    && same(item.revision_no, revision.revision_no);
}

// Presentation only: an inherited negative opinion is still a blocking opinion.
// Carry state alone cannot distinguish an old opinion from a new decision on it.
export function modificationOpinion(detail, item, party) {
  if (item?.[party + '_status'] !== 'needs_changes') return null;
  if (!currentItem(detail, item)) return 'unknown';
  const event = (detail.events || []).filter(value =>
    value.event_type === 'department_review_decision_recorded'
    && same(value.case_id, detail.case.id) && same(value.revision_id, detail.revision.id)
    && same(value.item_id, item.id) && value.payload?.party === party
  ).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (event) return event.decision === 'needs_changes' ? 'current' : 'unknown';
  if (['new', 'reopened'].includes(item.carry_state)) return 'current';
  if (item.carry_state !== 'carried_forward' || !item.carried_from_item_id) return 'unknown';
  const decided = Date.parse(item[party + '_decided_at']), submitted = Date.parse(detail.revision.created_at);
  // Events are bounded and MySQL timestamps have second precision. Equal or
  // absent times provide no reliable ordering, so keep their meaning open.
  if (!Number.isFinite(decided) || !Number.isFinite(submitted) || decided === submitted) return 'unknown';
  return decided < submitted ? 'inherited' : 'current';
}

export function reviewProgress(detail) {
  if (detail?.case?.status !== 'needs_revision') return null;
  const opinions = (detail.items || []).flatMap(item => ['origin', 'counterparty']
    .map(party => modificationOpinion(detail, item, party)).filter(Boolean));
  if (opinions.includes('current')) return { awaitingRecheck: false, label: '当前修订需要修改' };
  if (opinions.length && opinions.every(value => value === 'inherited') && Number(detail.case.current_revision_no) > 1) {
    return { awaitingRecheck: true, label: '已提交，待负责人重新核对' };
  }
  return { awaitingRecheck: false, label: '存在修改意见，需核对当前修订' };
}

export function reviewCaseLabel(row, detail, fallback) {
  const matches = same(row?.id, detail?.case?.id)
    && same(row?.current_revision_no, detail?.case?.current_revision_no)
    && row?.current_content_hash === detail?.case?.current_content_hash;
  return (matches && reviewProgress(detail)?.label)
    || (row?.status === 'needs_revision' ? '存在修改意见，查看当前修订' : fallback(row?.status));
}
