SELECT d.MoDId,d.MoId,h.MoCode,h.CreateDate,d.SortSeq,d.OrderType,d.OrderDId,d.OrderCode,d.OrderSeq,d.InvCode,d.Qty,d.OrgQty,d.AuxQty,d.AuxUnitCode,d.ChangeRate,d.PartId,d.BomId,d.BomType,d.CustBomId,d.PAllocateId,d.RelsDate,d.RelsTime,d.Status,d.MoClass,d.SourceMoDId,d.DemandId,d.Define25,d.Define28,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.mom_orderdetail d JOIN dbo.mom_order h ON h.MoId=d.MoId
WHERE d.Status IN (3,4) ORDER BY d.MoDId
