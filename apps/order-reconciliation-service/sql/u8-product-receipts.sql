SELECT h.ID AS ReceiptId,h.cCode AS ReceiptCode,h.dDate AS ReceiptDate,h.cBusType,h.cSource,h.cVouchType,h.bRdFlag,h.bredvouch,h.cRdCode,rs.cRdName,h.cWhCode,h.dVeriDate,h.dnverifytime,
CASE WHEN NULLIF(h.cHandler,N'') IS NOT NULL THEN 1 ELSE 0 END AS HasAuditHandler,
r.AutoID AS ReceiptLineId,r.ID AS ReceiptHeaderReference,CASE WHEN h.ID IS NULL THEN 1 ELSE 0 END AS HeaderMissing,r.irowno,r.iMPoIds AS ProductionDetailId,r.cmocode,r.imoseq,r.cInvCode,r.iQuantity,r.cAssUnit,r.iinvexchrate,r.cBatch,r.csocode,r.isodid,r.cDefine25,r.cDefine28,
d.Status AS ProductionStatus,d.InvCode AS ProductionMaterial,d.Qty AS ProductionQty,mo.MoCode AS VerifiedProductionCode,d.SortSeq AS VerifiedProductionLine,d.BomId,
COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.rdrecords10 r LEFT JOIN dbo.rdrecord10 h ON r.ID=h.ID
LEFT JOIN dbo.Rd_Style rs ON rs.cRdCode=h.cRdCode
LEFT JOIN dbo.mom_orderdetail d ON d.MoDId=r.iMPoIds LEFT JOIN dbo.mom_order mo ON mo.MoId=d.MoId
ORDER BY r.AutoID
