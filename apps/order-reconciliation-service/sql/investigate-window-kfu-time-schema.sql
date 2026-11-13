SELECT s.name AS schema_name,t.name AS table_name,c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name IN(N'momorderdetail',N'SODetails') OR LOWER(t.name) LIKE N'%log%' OR LOWER(t.name) LIKE N'%audit%'
ORDER BY t.name,c.column_id
