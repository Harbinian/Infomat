SELECT d.iSOsID,d.ID,d.cSOCode,d.iRowNo,d.cInvCode,d.cDefine25,d.iQuantity,d.iNum,d.cUnitID,d.iInvExchRate,d.iCusBomID,d.bOrderBOM,d.busecusbom,d.iPPartID,d.iPPartSeqID,d.iPPartQty,d.cParentCode,d.cChildCode,d.fchildqty,d.fchildrate,d.iCurPartid,
 h.dDate,h.dverifydate,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.SO_SODetails d JOIN dbo.SO_SOMain h ON h.ID=d.ID
WHERE h.iStatus=1 AND NULLIF(LTRIM(RTRIM(h.cVerifier)),N'') IS NOT NULL ORDER BY d.iSOsID
