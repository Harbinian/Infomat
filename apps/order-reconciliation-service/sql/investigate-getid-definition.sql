SELECT N'UFSystem' AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc,o.create_date,o.modify_date,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN 1 ELSE 0 END AS definition_withheld,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN NULL ELSE m.definition END AS definition
FROM UFSystem.sys.objects o JOIN UFSystem.sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN UFSystem.sys.sql_modules m ON m.object_id=o.object_id
WHERE o.name LIKE N'%GetID%'
ORDER BY o.name
