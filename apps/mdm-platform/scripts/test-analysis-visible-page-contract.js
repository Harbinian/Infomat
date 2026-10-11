// R10 visible pagination: the scan is bounded, a cursor resumes exactly where the previous page
// stopped, and no answer ever depends on how many records the caller cannot see.
// Pure unit test over a synthetic executor; no database, HTTP listener or env file.
const test = require('node:test');
const assert = require('node:assert/strict');
const analysisApi = require('../server/analysisApi');

const { visiblePage, SCAN_BUDGET } = analysisApi;

// A synthetic table where every third identifier is visible to this caller.
function executor({ visible, total, countCalls }) {
  return {
    async execute(sql, params) {
      countCalls.push(params[0]);
      const after = BigInt(params[0]);
      const limit = Number(sql.match(/LIMIT (\d+)/)[1]);
      const ids = [];
      for (let id = after + 1n; id <= BigInt(total) && ids.length < limit; id += 1n) ids.push(String(id));
      return [ids.map(id => ({ id }))];
    }
  };
}

const resolveWith = visible => async ref => {
  if (!visible.has(String(ref))) throw Object.assign(new Error('不可见'), { statusCode: 403 });
  return { id: String(ref) };
};

test('a page returns only visible records, in order, with no hidden total', async () => {
  const visible = new Set(['3', '6', '9', '12']);
  const calls = [];
  const result = await visiblePage(executor({ visible, total: 12, countCalls: calls }),
    'data_map_definition_versions', 'version_id', { limit: 2 }, resolveWith(visible));
  assert.deepEqual(result.items.map(item => item.id), ['3', '6']);
  assert.equal(result.next_offset, 2);
  // The cursor names the last record the caller actually received, so resuming after it returns
  // the next visible record -- never skipping one that was resolved to answer "is there more".
  assert.equal(result.next_cursor, '6');
  assert.equal(result.visibility, 'existing_source_scope');
  assert.ok(!('total' in result) && !('skipped' in result), 'no hidden count is exposed');
});

test('a cursor resumes inside a run of records the caller cannot see, without losing any', async () => {
  const visible = new Set(['500', '501', '900']);
  const calls = [];
  const db = executor({ visible, total: 1000, countCalls: calls });
  const first = await visiblePage(db, 't', 'version_id', { limit: 2 }, resolveWith(visible));
  assert.deepEqual(first.items.map(item => item.id), ['500', '501']);
  const second = await visiblePage(db, 't', 'version_id', { limit: 2, cursor: first.next_cursor }, resolveWith(visible));
  assert.deepEqual(second.items.map(item => item.id), ['900']);
  assert.equal(second.next_cursor, null, 'the end of the visible set is reported, not a page count');
  const all = [...first.items, ...second.items].map(item => item.id);
  assert.deepEqual(all, ['500', '501', '900'], 'every visible record appears exactly once');
});

test('a page that cannot be assembled within the scan budget fails instead of returning less', async () => {
  const visible = new Set();
  const calls = [];
  await assert.rejects(
    () => visiblePage(executor({ visible, total: 60000, countCalls: calls }),
      't', 'version_id', { limit: 50 }, resolveWith(visible)),
    error => error.statusCode === 503 && /SCAN_BUDGET_EXCEEDED/.test(String(error.message || ''))
  );
  assert.ok(SCAN_BUDGET.maxRows > 0 && SCAN_BUDGET.maxMs > 0, 'the budget is a real, finite number');
});

test('the cost of a page does not grow with how much the caller cannot see', async () => {
  const sparse = [];
  const dense = [];
  const sparseVisible = new Set(['3']);
  await visiblePage(executor({ visible: sparseVisible, total: 100, countCalls: sparse }),
    't', 'version_id', { limit: 1 }, resolveWith(sparseVisible));
  const denseVisible = new Set(Array.from({ length: 100 }, (_, i) => String(i + 1)));
  await visiblePage(executor({ visible: denseVisible, total: 100, countCalls: dense }),
    't', 'version_id', { limit: 1 }, resolveWith(denseVisible));
  assert.ok(sparse.length <= dense.length + 1, `hidden density must not add queries: ${sparse.length} vs ${dense.length}`);
});

test('a cursor is a position, never a permission: visibility is still decided per record', async () => {
  const visible = new Set(['10']);
  const calls = [];
  const result = await visiblePage(executor({ visible, total: 40, countCalls: calls }),
    't', 'version_id', { limit: 5, cursor: '9' }, resolveWith(visible));
  assert.deepEqual(result.items.map(item => item.id), ['10'], 'the foreign records after the cursor stay hidden');
});

test('an invalid cursor or page parameter is refused', () => {
  for (const query of [{ cursor: '-1' }, { cursor: 'abc' }, { cursor: '1;drop' }, { offset: '-1' }, { limit: '0' }, { limit: '101' }, { unexpected: '1' }]) {
    assert.throws(() => analysisApi.page(query), /DEFINITION_ANALYSIS_QUERY_INVALID/, JSON.stringify(query));
  }
  assert.deepEqual(analysisApi.page({ cursor: '9007199254740993', limit: '10' }), { offset: 0, limit: 10, cursor: '9007199254740993' });
});
