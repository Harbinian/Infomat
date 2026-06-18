const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, 'check-escalations.js');
const source = fs.readFileSync(scriptPath, 'utf8');

assert.ok(!source.includes("require('../server/db')"), 'check-escalations must not load SQLite db');
assert.ok(!/\bfield_conflicts\b/.test(source), 'check-escalations must not query legacy field_conflicts table');
assert.ok(!/\bterm_conflicts\b/.test(source), 'check-escalations must not query legacy term_conflicts table');
assert.ok(!/\btodos\b/.test(source), 'check-escalations must not write legacy todos table');

const { checkEscalations } = require('./check-escalations');

async function main() {
  const calls = [];
  const repo = {
    async listConflicts(filters) {
      calls.push(['listConflicts', filters]);
      if (filters.type === 'field') {
        return [
          { id: 10, conflict_type: 'field', status: 'coordinating', deadline: '2026-06-17' },
          { id: 11, conflict_type: 'field', status: 'coordinating', deadline: '2026-06-19' }
        ];
      }
      return [
        { id: 20, conflict_type: 'term', status: 'coordinating', deadline: '2026-06-16' }
      ];
    },
    async escalateConflict(id, type, payload) {
      calls.push(['escalateConflict', Number(id), type, payload]);
      return { ok: true };
    }
  };

  const result = await checkEscalations({
    today: '2026-06-18',
    repositoryFactory: async () => repo,
    actor: { actor_user_id: null, actor_dept_id: null }
  });

  assert.strictEqual(result.escalated, 2);
  assert.ok(calls.some(call => call[0] === 'listConflicts' && call[1].type === 'field'));
  assert.ok(calls.some(call => call[0] === 'listConflicts' && call[1].type === 'term'));
  assert.ok(calls.some(call => call[0] === 'escalateConflict' && call[1] === 10 && call[2] === 'field'));
  assert.ok(calls.some(call => call[0] === 'escalateConflict' && call[1] === 20 && call[2] === 'term'));

  console.log('Check escalations MySQL test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
