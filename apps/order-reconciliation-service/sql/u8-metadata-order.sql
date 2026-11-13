SELECT DB_NAME() AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc AS object_type,c.column_id,c.name AS column_name,t.name AS data_type,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE o.name IN ('SO_SOMain','SO_SODetails','mom_order','mom_orderdetail') AND o.type IN ('U','V')
ORDER BY o.name,c.column_id
