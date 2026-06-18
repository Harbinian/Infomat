// check-escalations.js - standalone script to escalate overdue conflict records.
// Run: node scripts/check-escalations.js

const { conflictRepository } = require('../server/conflictMysqlRepository');

function defaultToday() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(conflict, today) {
  return conflict && conflict.status === 'coordinating' && conflict.deadline && String(conflict.deadline) < today;
}

async function checkEscalations(options = {}) {
  const today = options.today || defaultToday();
  const repositoryFactory = options.repositoryFactory || conflictRepository;
  const actor = options.actor || { actor_user_id: null, actor_dept_id: null };
  const repo = await repositoryFactory();

  const fieldRows = await repo.listConflicts({ type: 'field', status: 'coordinating' }, { canViewAll: true });
  const termRows = await repo.listConflicts({ type: 'term', status: 'coordinating' }, { canViewAll: true });
  const overdue = [
    ...fieldRows.filter(row => isOverdue(row, today)),
    ...termRows.filter(row => isOverdue(row, today))
  ];

  for (const conflict of overdue) {
    await repo.escalateConflict(conflict.id, conflict.conflict_type || 'field', actor);
  }

  return {
    checked: fieldRows.length + termRows.length,
    escalated: overdue.length,
    today
  };
}

async function main() {
  const result = await checkEscalations();
  if (result.escalated === 0) {
    console.log(`No overdue conflicts. Checked ${result.today}`);
  } else {
    console.log(`Escalated ${result.escalated} overdue conflict(s).`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  checkEscalations,
  isOverdue
};
