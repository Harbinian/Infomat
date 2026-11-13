SELECT DB_NAME() AS database_name,o.name AS object_name,c.column_id,c.name AS column_name,t.name AS data_type,c.max_length
FROM sys.objects o JOIN sys.columns c ON c.object_id=o.object_id JOIN sys.types t ON t.user_type_id=c.user_type_id
WHERE o.name IN(N'AA_ColumnDic',N'AA_ColumnDic_base',N'AA_ColumnSet',N'voucheritems',N'voucheritems_base',N'voucheritems_lang',N'voucheritems_info',N'AA_VoucherTemplate_MF',N'bas_part',N'Inventory',N'ComputationUnit',N'mom_moallocate')
ORDER BY o.name,c.column_id
