const noteLabels = { writeRule: '写入或取值时点', changeRule: '上游变更后的处理' };
const statusLabels = { unreviewed: '未收', pending: '已收待确认', completed: '已确认' };
const actions = { create: '新建', read: '查询', update: '更新', retire: '删除或停用' };
const roles = ['R', 'A', 'C', 'I'];

export function batchTaskProgress(review, references) {
  const missing = references.flatMap(reference => {
    const values = review?.lineageNotes?.[reference.id];
    const fields = Object.keys(noteLabels).filter(key => !values?.[key]?.trim());
    return fields.length ? [{ id: reference.id, fields }] : [];
  });
  const status = !review ? 'unreviewed' : review.completed === true && !missing.length ? 'completed' : 'pending';
  return { status, missing };
}

function csvCell(value) {
  const text = String(value ?? '');
  const literal = /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text) ? "'" + text : text;
  return '"' + literal.replaceAll('"', '""') + '"';
}

export function batchReportCsv(batch, tasks, exportedAt) {
  const headers = [
    '批次编号', '批次名称', '导出时间', '字段标识', '系统', '表名', '字段', '收集状态',
    '血缘条数', '已填齐条数', '待补或待确认事项', '父级参考', '已有证据', '样例待确认事项',
    '已记录写入或取值时点', '已记录上游变更后的处理', '记录版本', '最近保存时间',
    ...Object.values(actions).flatMap(action => roles.map(role => action + ' ' + role)),
  ];
  const rows = tasks.map(({ field, references, review }) => {
    const { status, missing } = batchTaskProgress(review, references);
    const gap = missing.map(({ id, fields }) => id + ' ' + fields.map(key => noteLabels[key]).join('、')).join('\n');
    const byReference = value => references.map(item => {
      const text = value(item);
      return text ? item.id + ' ' + text : '';
    }).filter(Boolean).join('\n');
    return [
      batch.id, batch.name, exportedAt, field.id, field.system, field.table, field.name, statusLabels[status],
      references.length, references.length - missing.length, gap || (status === 'pending' ? '待确认本字段' : ''),
      byReference(item => item.source), byReference(item => item.evidence), byReference(item => item.pending),
      byReference(item => review?.lineageNotes?.[item.id]?.writeRule),
      byReference(item => review?.lineageNotes?.[item.id]?.changeRule), review?.version, review?.savedAt,
      ...Object.keys(actions).flatMap(action => roles.map(role => review?.matrix?.[action]?.[role])),
    ];
  });
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
