SELECT v.CardNum,v.FieldName,v.carditemname,v.localeid
FROM dbo.voucheritems v
WHERE (v.CardNum IN(N'MO21',N'MO25') AND v.FieldName IN(N'Qty',N'DQty',N'BaseQtyN',N'BaseQtyD',N'FVFlag',N'CompScrap',N'ParentScrap',N'DInvCode',N'InvCode',N'BomId',N'DBomId',N'PartId'))
 OR (v.FieldName IN(N'FVFlag',N'BaseQtyN',N'BaseQtyD') AND v.CardNum LIKE N'BO%')
