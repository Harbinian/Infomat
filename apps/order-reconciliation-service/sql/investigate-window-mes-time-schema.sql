SELECT s.name AS schema_name,t.name AS table_name,c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name IN(N'生产任务单_主表',N'生产订单中间表新_明细',N'产品制造大纲流转卡_主表',N'工艺清单汇总_主表')
 OR (t.name LIKE N'ES[_]%' AND (ty.name IN(N'datetime',N'datetime2',N'smalldatetime',N'date') OR c.name LIKE N'%RCID%' OR c.name LIKE N'%RecSet%'))
ORDER BY t.name,c.column_id
