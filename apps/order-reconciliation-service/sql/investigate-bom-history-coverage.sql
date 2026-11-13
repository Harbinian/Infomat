SELECT N'variationlog' AS source_object,CONVERT(nvarchar(100),BillType) AS category,BillName AS category_name,COUNT_BIG(*) AS record_count FROM dbo.variationlog GROUP BY BillType,BillName
UNION ALL
SELECT N'AA_Enum',EnumType,EnumCode+N'='+EnumName,COUNT_BIG(*) FROM dbo.AA_Enum WHERE EnumType LIKE N'%MoClass%' OR EnumType LIKE N'%FVFlag%' GROUP BY EnumType,EnumCode,EnumName
