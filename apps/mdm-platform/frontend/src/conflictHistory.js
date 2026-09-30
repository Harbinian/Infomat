// Read-only projection of the existing conflict detail; never infer missing events.
export function conflictHistory(detail) {
  const person = (name, id) => name || (id != null ? `人员编号 ${id}` : '人员未记录');
  const result = value => ({ A: '支持 A 方', B: '支持 B 方', compromise: '折中方案' }[value] || value || '未记录');
  const events = [{ time: detail.created_at, action: '冲突记录建立', actor: '人员未记录', note: '建立时间来自当前冲突记录。' }];
  for (const row of detail.assignmentHistory || []) events.push({
    time: row.created_at, action: '分派记录', actor: person(row.assigned_by_name, row.assigned_by_person_id ?? row.assigned_by),
    note: `责任人：${person(row.assignee_name, row.assignee_person_id ?? row.assignee_user_id)}`
  });
  for (const row of detail.coordinationHistory || []) events.push({
    time: row.created_at, action: '提交协调结果', actor: person(row.assignee_name, row.assignee_person_id ?? row.assignee_user_id),
    note: `${result(row.result)}；依据：${row.note || '未记录'}`
  });
  if (detail.resolved_at || detail.resolution || detail.resolved_by != null) events.push({
    time: detail.resolved_at, action: '处理决定记录', actor: person(null, detail.resolved_by), note: detail.resolution || '决定内容未记录'
  });
  // API timestamps are displayed unchanged. Equal timestamps keep source order;
  // missing or unparseable timestamps have no chronological position.
  const order = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity;
  return events.sort((a, b) => {
    const left = order(a.time), right = order(b.time);
    return left === right ? 0 : left < right ? -1 : 1;
  });
}
