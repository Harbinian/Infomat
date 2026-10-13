// R06 security log contract. Pure unit test: no listener, no database, no env file.
// The log has to be an allow list, so the test attacks it with exactly the values that must never
// appear: driver SQL text, parameters, stack traces, credentials and session material.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecurityLog, ALLOWED_FIELDS, safeErrorCode, actorRef } = require('../server/securityLog');

function capture() {
  const lines = [];
  return { lines, log: createSecurityLog({ sink: line => lines.push(line), now: () => 1791600000000 }) };
}

// A driver error as mysql2 actually produces it.
function driverError() {
  const error = new Error('ER_DUP_ENTRY: Duplicate entry 张三 for key person.employee_no');
  error.code = 'ER_DUP_ENTRY';
  error.sql = "INSERT INTO person(employee_no, person_name) VALUES ('EMP001', '张三')";
  error.sqlMessage = "Duplicate entry 'EMP001' for key 'person.employee_no'";
  error.parameters = ['EMP001', '张三'];
  error.stack = 'Error: ER_DUP_ENTRY\n    at Query.execute (/app/server/db.js:214:17)';
  return error;
}

const SECRETS = ['张三', 'EMP001', 'person.employee_no', 'INSERT INTO', '/app/server/db.js', 'Duplicate entry'];

test('allowed fields are exactly the contract, and nothing else can be attached', () => {
  const { lines, log } = capture();
  assert.equal(log.write({
    event: 'request_failed', code: 'ER_DUP_ENTRY', route: '/api/x', method: 'POST',
    status: 500, duration_ms: 12, request_id: 'abc', actor_ref: '42', at: 'ignored',
    password: 'p', sql: 'SELECT 1', stack: 'x', claim_token: 't', Cookie: 'c'
  }), true);
  const record = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(record).sort(), [...ALLOWED_FIELDS].sort());
});

test('a driver error contributes its code and nothing else', () => {
  const { lines, log } = capture();
  const error = driverError();
  log.write({ event: 'request_failed', code: safeErrorCode(error), status: 500 });
  assert.equal(lines.length, 1);
  for (const secret of SECRETS) assert.ok(!lines[0].includes(secret), `log line must not contain ${secret}`);
  assert.equal(JSON.parse(lines[0]).code, 'ER_DUP_ENTRY');
  assert.equal(safeErrorCode(new Error('boom')), null, 'a message is not a code');
  assert.equal(safeErrorCode({ code: 'ER_BAD; DROP TABLE' }), null, 'a code has to look like a code');
});

test('a poisoned entry cannot smuggle a value in through a field name', () => {
  const { lines, log } = capture();
  log.write({ event: 'request_failed', code: 'SELECT password FROM users', status: 500 });
  assert.ok(!lines[0].includes('SELECT password'), 'even the code field is length and shape limited');
});

test('an oversized record is replaced instead of written', () => {
  const { lines } = capture();
  const tiny = createSecurityLog({ sink: line => lines.push(line), now: () => 0, maxBytes: 120 });
  tiny.write({ event: 'request_failed', code: 'X'.repeat(80), route: '/api/' + 'y'.repeat(400) });
  assert.equal(lines.length, 1);
  assert.ok(Buffer.byteLength(lines[0]) <= 120);
  assert.equal(JSON.parse(lines[0]).event, 'log_oversize');
});

test('a failing sink never propagates to the caller', () => {
  const log = createSecurityLog({ sink: () => { throw new Error('log destination down'); }, now: () => 0 });
  assert.equal(log.write({ event: 'request_failed', code: 'X' }), false);
  const throwing = createSecurityLog({ sink: () => { throw new Error('down'); }, now: () => { throw new Error('clock down'); } });
  assert.equal(throwing.write({ event: 'request_failed' }), false);
});

test('a record without an event is not a log line', () => {
  const { lines, log } = capture();
  assert.equal(log.write({ code: 'X' }), false);
  assert.equal(lines.length, 0);
});

test('the actor reference is an identifier, never a name or a session', () => {
  assert.equal(actorRef({ personId: '9007199254740993' }), '9007199254740993');
  assert.equal(actorRef({ identityKind: 'system_admin', accountId: '7' }), 'system-admin:7');
  assert.equal(actorRef({ personName: '张三' }), null, 'a display name is not an identity');
  assert.equal(actorRef(null), null);
});

test('allowed fields cannot serialize nested request or driver values', () => {
  const { log, lines } = capture();
  const poisoned = { password: 'private-value', sql: 'SELECT private' };
  log.write({ event: 'request_failed', route: poisoned, actor_ref: poisoned, status: poisoned, duration_ms: Infinity });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('private'));
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['at', 'event']);
});
