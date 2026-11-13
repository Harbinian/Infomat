SELECT d.MoDId,d.MoId,h.MoCode,d.SortSeq,d.Status,d.InvCode,d.PAllocateId,d.SourceMoDId,d.OrderType,d.OrderDId,d.OrderCode,
d.Qty,d.QualifiedInQty,d.BomId,d.CloseDate,d.MoClass,h.CreateDate,COUNT_BIG(*) OVER() AS _expectedCount
 FROM dbo.mom_orderdetail d LEFT JOIN dbo.mom_order h ON h.MoId=d.MoId ORDER BY d.MoDId
