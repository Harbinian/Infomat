SELECT CardNumber,Name,BTTblName,BTQName,BWTblName,BWQName,VchListQName,ccardname,localeid
FROM dbo.vouchers WHERE CardNumber IN(N'MO21',N'MO25')
