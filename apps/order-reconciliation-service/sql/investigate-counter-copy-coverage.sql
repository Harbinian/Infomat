SELECT N'ua_identityBAK20260427' AS source_object,COUNT_BIG(*) AS total_rows,
 SUM(CASE WHEN cAcc_Id=N'333' THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS account333_rows,
 SUM(CASE WHEN cAcc_Id=N'333' AND cVouchType IN(N'mom_order',N'mom_orderdetail') THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS target_rows
FROM UFSystem.dbo.ua_identityBAK20260427
UNION ALL
SELECT N'UA_Identity_Ex',COUNT_BIG(*),SUM(CASE WHEN cAcc_Id=N'333' THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END),
 SUM(CASE WHEN cAcc_Id=N'333' AND cVouchType IN(N'mom_order',N'mom_orderdetail') THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM dbo.UA_Identity_Ex
