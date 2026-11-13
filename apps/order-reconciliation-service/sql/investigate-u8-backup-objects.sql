SELECT s.name AS schema_name,t.name AS table_name,t.create_date,t.modify_date
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
WHERE LOWER(t.name) LIKE N'mom[_]order%' OR LOWER(t.name) LIKE N'%identity%'
ORDER BY t.name
