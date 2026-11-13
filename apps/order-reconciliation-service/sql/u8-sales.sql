SELECT d.iSOsID,d.AutoID,d.ID,d.cSOCode,d.cInvCode,d.cDefine25,d.cDefine28,d.cDefine29,d.iQuantity,d.iRowNo,d.cSCloser,d.dbclosedate,
 d.iNum,d.cUnitID,d.iInvExchRate,d.iCusBomID,d.bOrderBOM,d.busecusbom,d.iPPartID,d.iPPartSeqID,d.iPPartQty,d.cParentCode,d.cChildCode,d.fchildqty,d.fchildrate,d.iCurPartid,
 h.dDate,h.iStatus,h.cVerifier,h.dverifydate,h.cCloser,h.dclosedate,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.SO_SODetails d JOIN dbo.SO_SOMain h ON h.ID=d.ID
WHERE h.iStatus=1 AND NULLIF(LTRIM(RTRIM(h.cVerifier)),N'') IS NOT NULL
ORDER BY d.iSOsID
