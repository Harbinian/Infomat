SELECT N'UFSystem' AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc,o.modify_date,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN NULL ELSE m.definition END AS definition
FROM UFSystem.sys.objects o JOIN UFSystem.sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN UFSystem.sys.sql_modules m ON m.object_id=o.object_id
WHERE m.definition COLLATE Latin1_General_100_CI_AS LIKE N'%UA[_]Identity%' OR LOWER(o.name) LIKE N'%getid%' OR LOWER(o.name) LIKE N'%identity%'
ORDER BY o.name
