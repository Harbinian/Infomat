SELECT h.cCode AS IssueCode,h.ID AS IssueId,h.dDate AS IssueDate,h.dVeriDate,h.cRdCode,
 CASE WHEN NULLIF(h.cHandler,N'') IS NOT NULL THEN 1 ELSE 0 END AS HasAuditHandler,
 r.AutoID AS IssueLineId,r.ID AS IssueHeaderReference,CASE WHEN h.ID IS NULL THEN 1 ELSE 0 END AS HeaderMissing,r.iMPoIds AS AllocationId,r.cInvCode,r.iQuantity,r.cmocode,r.imoseq,r.csocode,r.isodid,r.cbMemo,r.bsupersede,r.isupersedempoids,r.cSourceMOCode,r.iSourceMODetailsid,r.bcanreplace,
 a.MoDId,a.InvCode AS AllocationMaterial,a.Qty AS RequiredQty,a.IssQty AS AllocationIssuedQty,a.WIPType,a.ByproductFlag,
 d.InvCode AS ProductCode,mo.MoCode AS VerifiedProductionCode,d.SortSeq,d.OrderType,d.OrderDId,d.OrderCode,d.BomId,
 COUNT_BIG(*) OVER() AS _expectedCount
 FROM dbo.rdrecords11 r LEFT JOIN dbo.rdrecord11 h ON r.ID=h.ID
 LEFT JOIN dbo.mom_moallocate a ON a.AllocateId=r.iMPoIds
 LEFT JOIN dbo.mom_orderdetail d ON d.MoDId=a.MoDId LEFT JOIN dbo.mom_order mo ON mo.MoId=d.MoId
 ORDER BY r.AutoID
