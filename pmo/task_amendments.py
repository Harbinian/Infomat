"""Build read-only amendment presentation data from the PMO Markdown record.

Input: the amendment source block and current plan rows. Output: a JSON-ready
sidecar; no file writes. Used by build_pmo_task_data.py so task fields stay intact.
"""
import re

AMENDMENT_SOURCE_MD = '信息化项目_WBS增补记录.md'


def describe_change(before, after):
    before = '' if before is None else str(before)
    after = '' if after is None else str(after)
    if not before:
        return 'added', after
    if not after:
        return 'removed', ''
    prefix = before.rstrip('；。') + '；'
    if after.startswith(prefix):
        return 'extended', after[len(prefix):]
    return 'changed', ''


def build_task_amendments(source, rows, field_map):
    if source.get('schemaVersion') != 'pmo-task-amendment-source-v1':
        raise ValueError('Unsupported amendment source schema')
    tasks = {str(t['ID']): t for t in rows}
    field_keys = dict(field_map)
    batches = []
    batch_ids = set()
    latest_values = {}
    for batch in source.get('batches', []):
        batch_id, date = batch.get('id'), batch.get('date', '')
        if not batch_id or batch_id in batch_ids or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            raise ValueError('Amendment batches require a unique ID and ISO date')
        batch_ids.add(batch_id)
        records, seen = [], set()
        for record in batch.get('records', []):
            task_id, wbs = str(record.get('taskId', '')), record.get('wbs')
            task = tasks.get(task_id)
            if task is None or task['WBS'] != wbs or task_id in seen:
                raise ValueError(f'Invalid or duplicate amendment task identity: {task_id}/{wbs}')
            seen.add(task_id)
            if record.get('isSummary') != (task['任务类型'] == '摘要'):
                raise ValueError(f'Amendment summary flag mismatch: {wbs}')
            fields, seen_fields = [], set()
            for field in record.get('fields', []):
                label = field.get('field')
                if label not in field_keys or label in seen_fields or field.get('before') == field.get('after'):
                    raise ValueError(f'Invalid amendment field: {wbs}/{label}')
                seen_fields.add(label)
                kind, addition = describe_change(field.get('before'), field.get('after'))
                fields.append(dict(key=field_keys[label], label=label, before=field.get('before'),
                                   after=field.get('after'), kind=kind, addition=addition))
                latest_values[(task_id, label)] = (date, field.get('after')) if (
                    (task_id, label) not in latest_values or date >= latest_values[(task_id, label)][0]
                ) else latest_values[(task_id, label)]
            if not fields:
                raise ValueError(f'Amendment record has no fields: {wbs}')
            records.append(dict(taskId=task_id, wbs=wbs, isSummary=record['isSummary'], fields=fields))
        batches.append(dict(id=batch_id, date=date, title=batch.get('title', ''), scope=batch.get('scope', ''),
                            records=records, leafCount=sum(not r['isSummary'] for r in records),
                            summaryCount=sum(r['isSummary'] for r in records)))
    for (task_id, label), (_, value) in latest_values.items():
        if tasks[task_id].get(label) != value:
            raise ValueError(f'Latest amendment differs from current plan: {tasks[task_id]["WBS"]}/{label}')
    batches.sort(key=lambda b: (b['date'], b['id']), reverse=True)
    return dict(schemaVersion='pmo-task-amendments-v1', source=AMENDMENT_SOURCE_MD, batches=batches)
