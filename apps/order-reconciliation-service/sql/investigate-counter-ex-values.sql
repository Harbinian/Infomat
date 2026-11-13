SELECT cAcc_Id,cVouchType,iFatherId,iChildId
FROM dbo.UA_Identity_Ex
WHERE cAcc_Id=N'333' AND cVouchType IN(N'mom_order',N'mom_orderdetail',N'mom_moallocate')
ORDER BY cVouchType
