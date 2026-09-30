const MIGRATION_KEY = '2026-09-28-todo-term-source-v1';

async function inspectTodoTermSource(db) {
  const [[table]] = await db.execute("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_todos'");
  if (!table || table.ENGINE !== 'InnoDB') throw new Error('TODO_TERM_SCHEMA_BASE_REQUIRED');
  const [[column]] = await db.execute("SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_todos' AND COLUMN_NAME='related_term_id'");
  const [[record]] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
  const matching = column && /^bigint(?:\(20\))?$/i.test(column.COLUMN_TYPE) && column.IS_NULLABLE === 'YES' && column.COLUMN_DEFAULT === null && !column.EXTRA;
  if ((column && !matching) || (!column && record)) return { state: 'drift', recorded: Boolean(record) };
  const [[counts]] = await db.execute(`SELECT COUNT(*) AS rows_count${column ? ',COUNT(related_term_id) AS linked_count' : ''} FROM mdm_todos`);
  return { state: !column ? 'absent' : record ? 'applied' : 'unrecorded', recorded: Boolean(record), rows: Number(counts.rows_count), linked: Number(counts.linked_count || 0) };
}

// Explicit maintenance only. MySQL DDL commits independently. A matching column
// after an interrupted apply is resumed by recording it, without changing data.
async function manageTodoTermSource(db, action) {
  if (!['inspect', 'apply', 'rollback'].includes(action)) throw new Error('TODO_TERM_MIGRATION_ACTION_INVALID');
  if (action === 'inspect') return inspectTodoTermSource(db);
  const [[lock]] = await db.execute("SELECT GET_LOCK(CONCAT('todo-term-migration:',LEFT(SHA2(DATABASE(),256),40)),5) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error('TODO_TERM_MIGRATION_BUSY');
  try {
    const before = await inspectTodoTermSource(db);
    if (before.state === 'drift') throw new Error('TODO_TERM_SCHEMA_DRIFT');
    if (action === 'apply') {
      if (before.state === 'applied') return before;
      if (before.state === 'unrecorded' && before.linked) throw new Error('TODO_TERM_SCHEMA_UNRECORDED_LINKS');
      if (before.state === 'absent') await db.execute('ALTER TABLE mdm_todos ADD COLUMN related_term_id BIGINT NULL AFTER related_field_id');
      await db.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [MIGRATION_KEY]);
      return inspectTodoTermSource(db);
    }
    if (before.state === 'absent') return before;
    if (!before.recorded) throw new Error('TODO_TERM_ROLLBACK_UNRECORDED');
    // Rollback is for a quiesced instance before new links are written. A used
    // migration is preserved for code rollback / backup-based restoration.
    const [[usage]] = await db.execute("SELECT COUNT(*) AS n FROM mdm_version_log WHERE entity_type='todo' AND operation='create' AND field_name LIKE 'term_request:%'");
    if (before.linked || Number(usage.n)) throw new Error('TODO_TERM_ROLLBACK_HAS_HISTORY');
    await db.execute('ALTER TABLE mdm_todos DROP COLUMN related_term_id');
    await db.execute('DELETE FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]);
    return inspectTodoTermSource(db);
  } finally { await db.execute("SELECT RELEASE_LOCK(CONCAT('todo-term-migration:',LEFT(SHA2(DATABASE(),256),40)))").catch(() => {}); }
}

module.exports = { MIGRATION_KEY, inspectTodoTermSource, manageTodoTermSource };
