import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../query.mjs';
import './access.test.mjs';
import './quality-query.test.mjs';

test('rejects arbitrary SQL inputs and duplicate parameters', () => {
  for (const query of ['sql=SELECT+1', 'type=10&type=11', 'page=-1', 'pageSize=101', 'status=other']) assert.throws(() => parseQuery(new URLSearchParams(query)));
});
test('quality check is an explicit validated filter', () => {
  for(const value of ['same','different','missing','reference_unconfirmed']) assert.equal(parseQuery(new URLSearchParams({qualityCheck:value})).qualityCheck,value);
  assert.throws(()=>parseQuery(new URLSearchParams({qualityCheck:'anything'})));
});
test('validates complete dates and inclusive range order', () => {
  for (const date of ['2026-02-30', '2026-99-01', '1752-12-31']) assert.throws(() => parseQuery(new URLSearchParams({dateFrom: date})), /日期无效/);
  assert.throws(() => parseQuery(new URLSearchParams('dateFrom=2026-10-15&dateTo=2026-10-14')), /不能晚于/);
  assert.equal(parseQuery(new URLSearchParams('dateFrom=2024-02-29')).dateFrom, '2024-02-29');
});
test('keeps text as data without interpreting quote or wildcard syntax', () => {
  const value = "x' OR 1=1 -- %_[";
  assert.equal(parseQuery(new URLSearchParams({voucher: value})).voucher, value);
  assert.equal(parseQuery(new URLSearchParams()).pageSize, 20);
  const numbers = parseQuery(new URLSearchParams({qualityNumber: ' 11AP ', partNumber: value}));
  assert.equal(numbers.qualityNumber, '11AP'); assert.equal(numbers.partNumber, value);
  assert.throws(() => parseQuery(new URLSearchParams('partNumber=A&partNumber=B')));
});
