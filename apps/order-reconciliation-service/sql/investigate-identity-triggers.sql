SELECT s.name AS parent_schema,t.name AS parent_table,tr.name AS trigger_name,tr.is_disabled,tr.is_instead_of_trigger,
 tr.create_date,tr.modify_date,DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN 1 ELSE 0 END AS withheld,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN NULL ELSE m.definition END AS definition
FROM UFSystem.sys.triggers tr JOIN UFSystem.sys.tables t ON t.object_id=tr.parent_id JOIN UFSystem.sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN UFSystem.sys.sql_modules m ON m.object_id=tr.object_id
WHERE t.name=N'UA_Identity' ORDER BY tr.name
