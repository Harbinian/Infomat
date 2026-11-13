SELECT N'ua_identityBAK20260427' AS source_object,cAcc_Id,cVouchType,iFatherId,iChildId
FROM UFSystem.dbo.ua_identityBAK20260427
WHERE cAcc_Id=N'333' AND cVouchType IN (N'mom_order',N'mom_orderdetail',N'mom_moallocate')
UNION ALL
SELECT N'current_UA_Identity',cAcc_Id,cVouchType,iFatherId,iChildId
FROM UFSystem.dbo.UA_Identity
WHERE cAcc_Id=N'333' AND cVouchType IN (N'mom_order',N'mom_orderdetail',N'mom_moallocate')
