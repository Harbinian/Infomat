SELECT s.name AS schema_name,t.name AS table_name,t.create_date,t.modify_date,c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length
FROM UFSystem.sys.tables t JOIN UFSystem.sys.schemas s ON s.schema_id=t.schema_id
JOIN UFSystem.sys.columns c ON c.object_id=t.object_id JOIN UFSystem.sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name=N'ua_identityBAK20260427' ORDER BY c.column_id
