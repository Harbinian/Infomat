import assert from 'node:assert/strict';

import { formatDate, getPmoDeliveryWeekRange } from '../gantt-react/src/utils/dateUtils.js';

function makeLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function assertPmoWeekRange(observedDate, expectedStart, expectedEnd) {
  const { start, end } = getPmoDeliveryWeekRange(makeLocalDate(observedDate));

  assert.equal(formatDate(start), expectedStart, `${observedDate} should start at ${expectedStart}`);
  assert.equal(formatDate(end), expectedEnd, `${observedDate} should end at ${expectedEnd}`);
  assert.equal(start.getHours(), 0, 'PMO delivery week should start at 00:00');
  assert.equal(start.getMinutes(), 0, 'PMO delivery week should start on the hour');
  assert.equal(end.getHours(), 23, 'PMO delivery week should end at 23:59:59.999');
  assert.equal(end.getMinutes(), 59, 'PMO delivery week should include the full end day');
}

assertPmoWeekRange('2026-07-02', '2026-07-02', '2026-07-08');
assertPmoWeekRange('2026-07-05', '2026-07-02', '2026-07-08');
assertPmoWeekRange('2026-07-08', '2026-07-02', '2026-07-08');
assertPmoWeekRange('2026-07-09', '2026-07-09', '2026-07-15');
assertPmoWeekRange('2026-07-01', '2026-06-25', '2026-07-01');

console.log('PMO delivery week range smoke passed');
