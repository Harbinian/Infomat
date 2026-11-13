SELECT DB_NAME() AS database_name,s.name AS schema_name,o.name AS object_name,o.type_desc AS object_type,
 c.column_id,c.name AS column_name,t.name AS data_type,c.max_length,c.precision,c.scale,c.is_nullable,
 CONVERT(nvarchar(1000),ep.value) AS column_description
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
WHERE o.type IN ('U','V') AND o.is_ms_shipped=0
 AND (o.name LIKE N'bom[_]%' OR o.name LIKE N'ecn[_]%' OR o.name LIKE N'mom[_]order%'
 OR o.name IN(N'VoucherItems',N'VoucherItems_base',N'AA_Enum',N'AA_EnumItem')
 OR c.name IN(N'RelsUser',N'RelsDate',N'RelsTime'))
ORDER BY o.name,c.column_id
