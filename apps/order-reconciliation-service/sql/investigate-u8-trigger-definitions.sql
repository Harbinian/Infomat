SELECT DB_NAME() AS database_name,SCHEMA_NAME(o.schema_id) AS schema_name,o.name AS object_name,o.type_desc,o.create_date,o.modify_date,
 OBJECT_SCHEMA_NAME(t.parent_id) AS parent_schema,OBJECT_NAME(t.parent_id) AS parent_object,t.is_disabled,
 HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id))+N'.'+QUOTENAME(o.name),N'OBJECT',N'VIEW DEFINITION') AS can_view_definition,
 DATALENGTH(m.definition) AS definition_bytes,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN 1 ELSE 0 END AS definition_withheld,
 CASE WHEN LOWER(m.definition) LIKE N'%password%' OR LOWER(m.definition) LIKE N'%pwd%' OR LOWER(m.definition) LIKE N'%secret%' OR LOWER(m.definition) LIKE N'%token%' THEN NULL ELSE m.definition END AS definition
FROM sys.triggers t JOIN sys.objects o ON o.object_id=t.object_id LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE t.parent_id IN (OBJECT_ID(N'dbo.mom_order'),OBJECT_ID(N'dbo.mom_orderdetail'),OBJECT_ID(N'dbo.mom_order_ExtraDefine'))
ORDER BY parent_object,o.name
