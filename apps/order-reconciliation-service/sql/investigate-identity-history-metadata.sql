SELECT s.name AS schema_name,t.name AS table_name,t.object_id,t.create_date,t.modify_date,
 t.temporal_type_desc,t.history_table_id,t.is_tracked_by_cdc,
 CASE WHEN ct.object_id IS NULL THEN 0 ELSE 1 END AS change_tracking_enabled,
 c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length,c.is_nullable
FROM UFSystem.sys.tables t
JOIN UFSystem.sys.schemas s ON s.schema_id=t.schema_id
JOIN UFSystem.sys.columns c ON c.object_id=t.object_id
JOIN UFSystem.sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN UFSystem.sys.change_tracking_tables ct ON ct.object_id=t.object_id
WHERE t.name=N'UA_Identity' OR LOWER(t.name) LIKE N'%log%' OR LOWER(t.name) LIKE N'%audit%' OR LOWER(t.name) LIKE N'%trace%' OR LOWER(t.name) LIKE N'%histor%'
ORDER BY t.name,c.column_id
