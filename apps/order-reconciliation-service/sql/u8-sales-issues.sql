SELECT r.AutoID AS SalesIssueLineId,r.ID AS IssueHeaderReference,h.ID AS IssueHeaderId,h.cCode AS SalesIssueCode,
h.dDate AS IssueDate,h.dVeriDate AS AuditDate,h.dnverifytime AS AuditSystemTime,h.bRdFlag,h.cVouchType,h.cBusType,h.cSource,
CASE WHEN h.ID IS NULL THEN 1 ELSE 0 END AS HeaderMissing,
CASE WHEN NULLIF(h.cHandler,N'') IS NOT NULL THEN 1 ELSE 0 END AS HasAuditHandler,
r.isodid AS SalesDetailId,r.csocode AS SalesOrderCode,r.irowno,r.cInvCode,r.iQuantity,r.cBatch,r.iDLsID,
COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.rdrecords32 r LEFT JOIN dbo.rdrecord32 h ON h.ID=r.ID ORDER BY r.AutoID
