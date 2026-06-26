const assert = require('assert');

const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');

const sql = mdmMysqlSchemaSql();

function mustContain(fragment, message) {
  assert.ok(sql.includes(fragment), message || `schema should contain: ${fragment}`);
}

mustContain('CREATE TABLE IF NOT EXISTS person', 'person must be the target people identity table');
mustContain('person_id BIGINT AUTO_INCREMENT PRIMARY KEY', 'person table should use person_id as primary key');
mustContain('employee_no VARCHAR(128) NOT NULL', 'person should keep employee_no as external business key');
mustContain('current_department_id BIGINT NULL', 'person should point at current department');
mustContain('employment_status VARCHAR(32) NOT NULL', 'person should track employment status');

mustContain('CREATE TABLE IF NOT EXISTS user_accounts', 'login credentials should live in user_accounts');
mustContain('account_id BIGINT AUTO_INCREMENT PRIMARY KEY', 'user_accounts should use account_id');
mustContain('person_id BIGINT NOT NULL', 'user_accounts should attach to person');
mustContain('UNIQUE KEY uq_user_accounts_person (person_id)', 'one account should map to one person');
mustContain('UNIQUE KEY uq_user_accounts_login (login_name)', 'login_name should be unique');

mustContain('CREATE TABLE IF NOT EXISTS person_roles', 'RBAC assignments should target person_roles');
mustContain('person_role_id BIGINT AUTO_INCREMENT PRIMARY KEY', 'person_roles should have its own primary key');
mustContain('assigned_by_person_id BIGINT NULL', 'role assignment audit should use person id');
mustContain('UNIQUE KEY uq_person_roles_person_role (person_id, role_id)', 'person role assignment should be unique');

mustContain('final_responsible_person_id BIGINT NULL', 'department final responsibility should use person id');
mustContain('data_owner_person_id BIGINT NULL', 'department data owner should use person id');

mustContain('is_dangerous TINYINT NOT NULL DEFAULT 0', 'permissions should mark dangerous actions');
mustContain("default_scope VARCHAR(64) NOT NULL DEFAULT 'self_task'", 'permissions should declare default scope');
mustContain('protected_core TINYINT NOT NULL DEFAULT 0', 'permissions should protect built-in core points');

mustContain('CREATE TABLE IF NOT EXISTS process_governance_guidance', 'management guidance should be a first-class object');
mustContain('created_by_person_id BIGINT NOT NULL', 'guidance creator should be person based');
mustContain('final_responsible_person_id BIGINT NULL', 'guidance should route to department final responsible person');
mustContain('current_handler_person_id BIGINT NULL', 'guidance should track the current handler');
mustContain("CHECK (status IN ('submitted','pending_response','in_progress','responded','pending_final_confirm','closed','clarification_requested','objected'))", 'guidance statuses should match workflow contract');

mustContain('CREATE TABLE IF NOT EXISTS department_responsibility_delegations', 'delegation should be a business authorization table');
mustContain('delegate_person_id BIGINT NOT NULL', 'delegation should point to a delegate person');
mustContain('can_final_confirm TINYINT NOT NULL DEFAULT 0', 'delegation should explicitly control final confirmation');

console.log('Person identity schema contract test passed');
