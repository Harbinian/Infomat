SELECT DB_NAME() AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc AS object_type
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
WHERE o.type IN ('U','V') AND o.is_ms_shipped=0
 AND (o.name LIKE N'%voucher%' OR o.name LIKE N'%enum%' OR o.name LIKE N'%field%' OR o.name LIKE N'%column%' OR o.name LIKE N'%template%' OR o.name LIKE N'%metadata%')
ORDER BY o.name
