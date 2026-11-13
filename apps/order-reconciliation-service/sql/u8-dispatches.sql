SELECT r.AutoID AS DispatchLineId,r.DLID AS DispatchHeaderReference,h.DLID AS DispatchHeaderId,h.cDLCode AS DispatchCode,
h.dDate AS DispatchDate,h.dverifydate AS AuditDate,h.dverifysystime AS AuditSystemTime,h.cVouchType,h.cBusType,h.bReturnFlag,
CASE WHEN h.DLID IS NULL THEN 1 ELSE 0 END AS HeaderMissing,
CASE WHEN NULLIF(h.cVerifier,N'') IS NOT NULL THEN 1 ELSE 0 END AS HasAuditVerifier,
r.iSOsID AS SalesDetailId,r.cSoCode AS SalesOrderCode,r.irowno,r.cInvCode,r.iQuantity,r.cBatch,r.iDLsID,
COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.DispatchLists r LEFT JOIN dbo.DispatchList h ON h.DLID=r.DLID ORDER BY r.AutoID
