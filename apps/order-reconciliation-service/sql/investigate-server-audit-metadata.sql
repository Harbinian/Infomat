SELECT a.audit_id,a.name,a.create_date,a.modify_date,a.type_desc,a.is_state_enabled,
 s.server_specification_id,s.name AS specification_name,s.is_state_enabled AS specification_enabled,
 d.audit_action_name,d.audited_result
FROM sys.server_audits a
LEFT JOIN sys.server_audit_specifications s ON s.audit_guid=a.audit_guid
LEFT JOIN sys.server_audit_specification_details d ON d.server_specification_id=s.server_specification_id
ORDER BY a.name,s.name,d.audit_action_name
