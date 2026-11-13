SELECT DB_NAME() AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc AS object_type,
 c.column_id,c.name AS column_name,t.name AS data_type,c.max_length,c.precision,c.scale,c.is_nullable,
 CONVERT(nvarchar(1000),ep.value) AS column_description
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
WHERE o.type IN ('U','V') AND o.is_ms_shipped=0
 AND (o.name LIKE N'%BOM%' OR o.name LIKE N'%物料清单%' OR o.name LIKE N'%制造大纲%'
 OR o.name LIKE N'%生产订单%' OR o.name LIKE N'%产品结构%' OR o.name LIKE N'%组件%' OR o.name LIKE N'%子件%')
ORDER BY o.name,c.column_id
