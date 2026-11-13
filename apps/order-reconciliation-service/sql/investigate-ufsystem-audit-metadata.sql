SELECT s.database_specification_id,s.name,s.create_date,s.modify_date,s.is_state_enabled,
 d.audit_action_name,d.class_desc,d.major_id,d.minor_id,d.audited_result
FROM UFSystem.sys.database_audit_specifications s
LEFT JOIN UFSystem.sys.database_audit_specification_details d ON d.database_specification_id=s.database_specification_id
ORDER BY s.name,d.audit_action_name
