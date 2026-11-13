SELECT o.name AS object_name,c.name AS column_name,t.name AS data_type
FROM sys.objects o JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE o.type=N'U' AND (o.name LIKE N'%变更%' OR o.name LIKE N'%更改%' OR c.name LIKE N'%BOM%' OR c.name LIKE N'%用量%')
ORDER BY o.name,c.column_id
