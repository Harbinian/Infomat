import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictHistory } from '../src/conflictHistory.js';

test('keeps real chronology and retained decisions after archive without manufacturing escalation', () => {
  const detail = { status:'archived', created_at:'2026-09-01T00:00:00Z', escalated:1, deadline:'2026-09-03T00:00:00Z',
    resolved_at:'2026-09-04T00:00:00Z', resolved_by:7, resolution:'保留决定',
    assignmentHistory:[{ created_at:'2026-09-02T01:00:00Z', assignee_person_id:4, assigned_by_person_id:7 }],
    coordinationHistory:[{ created_at:'2026-09-02T02:00:00Z', assignee_person_id:4, result:'B', note:'<img onerror=alert(1)>' }] };
  const before = JSON.stringify(detail), rows = conflictHistory(detail);
  assert.deepEqual(rows.map(row => row.action), ['冲突记录建立','分派记录','提交协调结果','处理决定记录']);
  assert.equal(rows[3].actor,'人员编号 7');
  assert.ok(rows[2].note.includes('<img onerror=alert(1)>'));
  assert.equal(JSON.stringify(detail),before);
  assert.equal(rows.some(row => row.time === detail.deadline),false);
});

test('missing times remain unknown, equal timestamps remain stable, cleared decisions are not reconstructed', () => {
  const rows = conflictHistory({ created_at:null, status:'pending', resolved_at:null, resolved_by:null, resolution:null,
    assignmentHistory:[{ created_at:'2026-09-01', assignee_name:'甲' },{ created_at:'2026-09-01', assignee_name:'乙' },{ created_at:'原始坏时间' }] });
  assert.equal(rows.length,4);
  assert.ok(rows[0].note.includes('甲')); assert.ok(rows[1].note.includes('乙'));
  assert.equal(rows[2].time,null); assert.equal(rows[3].time,'原始坏时间');
  assert.equal(rows.some(row => row.action === '处理决定记录'),false);
  assert.equal(conflictHistory({ resolution:'旧决定无时间' }).at(-1).time,undefined);
});
