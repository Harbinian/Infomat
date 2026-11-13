SELECT BillType,BillName,COUNT_BIG(*) AS record_count,MIN(Time) AS first_time,MAX(Time) AS last_time
FROM dbo.variationlog
WHERE BillType LIKE N'%BO%' OR BillName LIKE N'%物料清单%' OR BillName LIKE N'%BOM%' OR BillName LIKE N'%生产订单%'
GROUP BY BillType,BillName
