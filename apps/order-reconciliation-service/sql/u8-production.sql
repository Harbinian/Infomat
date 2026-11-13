SELECT d.MoDId,d.MoId,h.MoCode,d.SortSeq,d.OrderType,d.OrderDId,d.OrderCode,d.OrderSeq,d.SoCode,d.SoDId,d.InvCode,d.Qty,
 d.Define25,d.Define28,d.Define29,d.Status,d.AuditStatus,d.RelsDate,d.RelsUser,d.CloseDate,d.CloseUser,d.BomId,h.CreateDate,
 d.OrgQty,d.AuxQty,d.AuxUnitCode,d.ChangeRate,d.PartId,d.BomType,d.CustBomId,d.PAllocateId,d.RelsTime,d.MoClass,d.SourceMoDId,d.DemandId,d.ReasonCode,d.Remark,h.ModifyDate,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.mom_orderdetail d JOIN dbo.mom_order h ON h.MoId=d.MoId
WHERE d.Status IN (3,4)
ORDER BY d.MoDId
