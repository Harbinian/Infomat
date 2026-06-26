const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const schema = read('server/mysqlSchema.js');

const schemaContracts = [
  ['process_governance_quality_cases', 'owner_person_id BIGINT NULL'],
  ['process_governance_quality_case_events', 'actor_person_id BIGINT NULL'],
  ['process_mapping_todos', 'owner_person_id BIGINT NULL'],
  ['process_mapping_todo_events', 'actor_person_id BIGINT NULL'],
  ['data_map_objects', 'steward_person_id BIGINT NULL'],
  ['data_map_objects', 'created_by_person_id BIGINT NULL'],
  ['data_map_objects', 'updated_by_person_id BIGINT NULL'],
  ['data_map_contexts', 'owner_person_id BIGINT NULL'],
  ['data_map_contexts', 'created_by_person_id BIGINT NULL'],
  ['data_map_contexts', 'updated_by_person_id BIGINT NULL'],
  ['data_map_fields', 'submitted_by_person_id BIGINT NULL'],
  ['data_map_fields', 'reviewed_by_person_id BIGINT NULL'],
  ['data_map_field_identities', 'owner_person_id BIGINT NULL'],
  ['data_map_field_identities', 'confirmed_by_person_id BIGINT NULL'],
  ['data_map_quality_issues', 'created_by_person_id BIGINT NULL'],
  ['data_map_quality_issues', 'resolved_by_person_id BIGINT NULL'],
  ['data_map_change_sets', 'operated_by_person_id BIGINT NULL'],
  ['data_map_version_log', 'operated_by_person_id BIGINT NULL'],
  ['mdm_mapping_records', 'submitted_by_person_id BIGINT NULL'],
  ['mdm_mapping_approval_tasks', 'assignee_person_id BIGINT NULL'],
  ['mdm_mapping_approval_tasks', 'operated_by_person_id BIGINT NULL'],
  ['mdm_mapping_approval_history', 'operator_person_id BIGINT NULL'],
  ['mdm_mapping_rejection_reasons', 'rejected_by_person_id BIGINT NULL'],
  ['mdm_conflict_assignments', 'assignee_person_id BIGINT NULL'],
  ['mdm_conflict_assignments', 'assigned_by_person_id BIGINT NULL'],
  ['mdm_conflict_coordination_history', 'assignee_person_id BIGINT NULL'],
  ['mdm_todos', 'completed_by_person_id BIGINT NULL'],
  ['mdm_todos', 'created_by_person_id BIGINT NULL'],
  ['mdm_todo_events', 'actor_person_id BIGINT NULL'],
  ['terminology_terms', 'created_by_person_id BIGINT NULL'],
  ['terminology_terms', 'approved_by_person_id BIGINT NULL'],
  ['process_governance_term_tasks', 'created_by_person_id BIGINT NULL'],
  ['process_governance_term_tasks', 'decided_by_person_id BIGINT NULL']
];

for (const [table, field] of schemaContracts) {
  assert.ok(schema.includes(field), `${table} schema missing person write field: ${field}`);
}

const repositoryContracts = [
  ['server/processGovernanceMysqlRepository.js', 'owner_person_id=COALESCE'],
  ['server/processGovernanceMysqlRepository.js', 'actor_person_id'],
  ['server/dataMapMysqlRepository.js', 'steward_person_id'],
  ['server/dataMapMysqlRepository.js', 'submitted_by_person_id'],
  ['server/dataMapMysqlRepository.js', 'reviewed_by_person_id'],
  ['server/dataMapMysqlRepository.js', 'operated_by_person_id'],
  ['server/mappingMysqlRepository.js', 'submitted_by_person_id'],
  ['server/mappingMysqlRepository.js', 'assignee_person_id'],
  ['server/mappingMysqlRepository.js', 'operator_person_id'],
  ['server/mappingMysqlRepository.js', 'operated_by_person_id'],
  ['server/conflictMysqlRepository.js', 'assignee_person_id'],
  ['server/conflictMysqlRepository.js', 'assigned_by_person_id'],
  ['server/conflictMysqlRepository.js', 'actor_person_id'],
  ['server/todoMysqlRepository.js', 'created_by_person_id'],
  ['server/todoMysqlRepository.js', 'completed_by_person_id'],
  ['server/todoMysqlRepository.js', 'actor_person_id'],
  ['server/terminologyMysqlRepository.js', 'created_by_person_id'],
  ['server/terminologyMysqlRepository.js', 'approved_by_person_id']
];

for (const [relativePath, token] of repositoryContracts) {
  assert.ok(read(relativePath).includes(token), `${relativePath} missing person write token: ${token}`);
}

console.log('Person business writes MySQL contract test passed');
