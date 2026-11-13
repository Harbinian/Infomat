SELECT cAcc_Id,cVouchType,iFatherId,iChildId FROM UFSystem.dbo.UA_Identity
WHERE cAcc_Id=N'333' AND cVouchType LIKE N'%mom_order%'
ORDER BY cVouchType
