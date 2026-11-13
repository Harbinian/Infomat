SELECT d.iSOsID,d.cSOCode,d.iRowNo,d.cInvCode,d.iQuantity,h.iStatus,h.cVerifier
FROM dbo.SO_SODetails d JOIN dbo.SO_SOMain h ON h.ID=d.ID
WHERE d.iSOsID IN(1000020334,1000024255,1000024256)
