SELECT N'current' AS scope,s.name AS schema_name,o.name AS object_name,o.type_desc,
 HAS_PERMS_BY_NAME(QUOTENAME(s.name)+N'.'+QUOTENAME(o.name),N'OBJECT',N'VIEW DEFINITION') AS can_view_definition,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE '%password%' OR LOWER(m.definition) LIKE '%pwd%' OR LOWER(m.definition) LIKE '%secret%' OR LOWER(m.definition) LIKE '%token%' THEN NULL ELSE m.definition END AS definition
FROM sys.all_objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
LEFT JOIN sys.all_sql_modules m ON m.object_id=o.object_id WHERE LOWER(o.name) LIKE N'%getid%'
UNION ALL
SELECT N'master',s.name,o.name,o.type_desc,
 HAS_PERMS_BY_NAME(N'master.'+QUOTENAME(s.name)+N'.'+QUOTENAME(o.name),N'OBJECT',N'VIEW DEFINITION'),DATALENGTH(m.definition),
 CASE WHEN LOWER(m.definition) LIKE '%password%' OR LOWER(m.definition) LIKE '%pwd%' OR LOWER(m.definition) LIKE '%secret%' OR LOWER(m.definition) LIKE '%token%' THEN NULL ELSE m.definition END
FROM master.sys.all_objects o JOIN master.sys.schemas s ON s.schema_id=o.schema_id
LEFT JOIN master.sys.all_sql_modules m ON m.object_id=o.object_id WHERE LOWER(o.name) LIKE N'%getid%'
UNION ALL
SELECT N'UFSystem',s.name,o.name,o.type_desc,
 HAS_PERMS_BY_NAME(N'UFSystem.'+QUOTENAME(s.name)+N'.'+QUOTENAME(o.name),N'OBJECT',N'VIEW DEFINITION'),DATALENGTH(m.definition),
 CASE WHEN LOWER(m.definition) LIKE '%password%' OR LOWER(m.definition) LIKE '%pwd%' OR LOWER(m.definition) LIKE '%secret%' OR LOWER(m.definition) LIKE '%token%' THEN NULL ELSE m.definition END
FROM UFSystem.sys.all_objects o JOIN UFSystem.sys.schemas s ON s.schema_id=o.schema_id
LEFT JOIN UFSystem.sys.all_sql_modules m ON m.object_id=o.object_id WHERE LOWER(o.name) LIKE N'%getid%'
