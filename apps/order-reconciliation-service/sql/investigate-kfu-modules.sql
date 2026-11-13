SELECT DB_NAME() AS database_name,SCHEMA_NAME(o.schema_id) AS schema_name,o.name AS object_name,o.type_desc,o.create_date,o.modify_date,
 OBJECT_SCHEMA_NAME(t.parent_id) AS parent_schema,OBJECT_NAME(t.parent_id) AS parent_object,t.is_disabled,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN 1 ELSE 0 END AS definition_withheld,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN NULL ELSE m.definition END AS definition
FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id LEFT JOIN sys.triggers t ON t.object_id=o.object_id
WHERE LOWER(m.definition) LIKE N'%momorderdetail%' OR o.name=N'sp_GetID'
 OR t.parent_id IN (SELECT object_id FROM sys.objects WHERE name IN (N'mom_order',N'mom_orderdetail',N'mom_order_ExtraDefine',N'momorderdetail'))
ORDER BY o.type_desc,o.name
