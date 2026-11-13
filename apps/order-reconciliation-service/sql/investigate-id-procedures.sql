SELECT N'current' AS database_scope,SCHEMA_NAME(o.schema_id) AS schema_name,o.name AS object_name,o.type_desc,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE '%password%' OR LOWER(m.definition) LIKE '%pwd%' OR LOWER(m.definition) LIKE '%secret%' OR LOWER(m.definition) LIKE '%token%' THEN NULL ELSE m.definition END AS definition
FROM sys.objects o LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id WHERE LOWER(o.name)=N'sp_getid'
UNION ALL
SELECT N'master',s.name,o.name,o.type_desc,DATALENGTH(m.definition),
 CASE WHEN LOWER(m.definition) LIKE '%password%' OR LOWER(m.definition) LIKE '%pwd%' OR LOWER(m.definition) LIKE '%secret%' OR LOWER(m.definition) LIKE '%token%' THEN NULL ELSE m.definition END
FROM master.sys.objects o JOIN master.sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN master.sys.sql_modules m ON m.object_id=o.object_id WHERE LOWER(o.name)=N'sp_getid'
