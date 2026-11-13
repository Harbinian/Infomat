SELECT Id,BillType,BillId,BillNo,Action,Time,Analysis,Condition,BillName,OperationReason,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.variationlog WHERE BillType LIKE N'%BO%' OR BillType LIKE N'MO%' OR BillName LIKE N'%物料清单%' OR BillName LIKE N'%BOM%' OR BillName LIKE N'%生产订单%'
