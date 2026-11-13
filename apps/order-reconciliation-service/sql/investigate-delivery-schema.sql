SELECT s.name AS SchemaName,t.name AS TableName,c.column_id AS Ordinal,c.name AS ColumnName,ty.name AS SqlType,c.max_length,c.is_nullable,
COUNT_BIG(*) OVER() AS _expectedCount
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE s.name=N'dbo' AND t.name IN(N'DispatchList',N'DispatchLists',N'rdrecord32',N'rdrecords32',N'SO_SOMain',N'SO_SODetails')
ORDER BY t.name,c.column_id
