const assert = require('assert');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'server', 'mysqlSchema.js');
const schema = fs.readFileSync(schemaPath, 'utf8');

const targetPersonFields = [
  'owner_person_id BIGINT NULL',
  'actor_person_id BIGINT NULL',
  'assignee_person_id BIGINT',
  'assigned_by_person_id BIGINT',
  'submitted_by_person_id BIGINT NULL',
  'reviewed_by_person_id BIGINT NULL',
  'created_by_person_id BIGINT',
  'updated_by_person_id BIGINT',
  'operator_person_id BIGINT NULL',
  'closed_by_person_id BIGINT NULL',
  'steward_person_id BIGINT NULL',
  'generated_by_person_id BIGINT NULL',
  'decided_by_person_id BIGINT NULL'
];

for (const field of targetPersonFields) {
  assert.ok(schema.includes(field), `target schema missing person field: ${field}`);
}

assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS user_roles'), 'legacy user_roles may remain only as compatibility in round one');
assert.ok(schema.includes('manager_user_id BIGINT NULL'), 'legacy department manager_user_id remains as compatibility in round one');
assert.ok(schema.includes('data_owner_user_id BIGINT NULL'), 'legacy department data_owner_user_id remains as compatibility in round one');

console.log('No-new-user identity field guard passed');
