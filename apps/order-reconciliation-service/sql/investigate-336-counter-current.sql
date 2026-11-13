SELECT cAcc_Id,cVouchType,iFatherId,iChildId FROM UFSystem.dbo.UA_Identity
WHERE cAcc_Id=N'336' AND cVouchType IN(N'mom_order',N'mom_orderdetail',N'mom_moallocate')
ORDER BY cVouchType
