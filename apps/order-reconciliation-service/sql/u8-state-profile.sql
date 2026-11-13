SELECT 'production' AS entity,CONVERT(nvarchar(40),Status) AS state,CONVERT(nvarchar(40),AuditStatus) AS audit_state,CONVERT(nvarchar(40),OrgStatus) AS original_state,
 CASE WHEN RelsDate IS NULL THEN 'null' ELSE 'present' END AS approval_evidence,
 CASE WHEN CloseDate IS NULL THEN 'null' ELSE 'present' END AS close_evidence,
 CONVERT(nvarchar(40),OrderType) AS order_type,COUNT_BIG(*) AS row_count
FROM dbo.mom_orderdetail
GROUP BY Status,AuditStatus,OrgStatus,CASE WHEN RelsDate IS NULL THEN 'null' ELSE 'present' END,CASE WHEN CloseDate IS NULL THEN 'null' ELSE 'present' END,OrderType
UNION ALL
SELECT 'sales',CONVERT(nvarchar(40),iStatus),NULL,NULL,
 CASE WHEN NULLIF(LTRIM(RTRIM(cVerifier)),N'') IS NULL THEN 'verifier_missing' WHEN dverifydate IS NULL THEN 'date_missing' ELSE 'present' END,
 CASE WHEN cCloser IS NULL THEN 'null' ELSE 'present' END,NULL,COUNT_BIG(*)
FROM dbo.SO_SOMain
GROUP BY iStatus,CASE WHEN NULLIF(LTRIM(RTRIM(cVerifier)),N'') IS NULL THEN 'verifier_missing' WHEN dverifydate IS NULL THEN 'date_missing' ELSE 'present' END,CASE WHEN cCloser IS NULL THEN 'null' ELSE 'present' END
