SELECT o.name AS object_name,c.column_id,c.name AS column_name,t.name AS data_type
FROM sys.objects o JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE o.name IN(N'vouchers',N'vouchers_base',N'vouchertemplates',N'VoucherNumber',N'VoucherPrefabricate',N'SO_SODetails') OR o.name LIKE N'%VariationLog%'
ORDER BY o.name,c.column_id
