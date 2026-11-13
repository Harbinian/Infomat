SELECT c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name=N'ES_DataTable' ORDER BY c.column_id
