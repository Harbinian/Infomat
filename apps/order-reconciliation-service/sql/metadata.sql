SELECT DB_NAME() AS database_name, s.name AS schema_name, o.name AS object_name,
 o.type_desc AS object_type, c.column_id, c.name AS column_name,
 t.name AS data_type, c.max_length, c.precision, c.scale, c.is_nullable,
 c.is_identity, CASE WHEN pk.column_id IS NULL THEN 0 ELSE 1 END AS is_primary_key
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id=o.schema_id
JOIN sys.columns c ON c.object_id=o.object_id
JOIN sys.types t ON t.user_type_id=c.user_type_id
LEFT JOIN (SELECT ic.object_id,ic.column_id FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id WHERE i.is_primary_key=1) pk ON pk.object_id=c.object_id AND pk.column_id=c.column_id
WHERE o.type IN ('U','V') AND o.is_ms_shipped=0
ORDER BY s.name,o.name,c.column_id
