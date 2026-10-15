WITH QualitySource AS (
 -- 只从销售源头取数，避免生产拆单或多次出入库放大明细及编号数量。
 SELECT sd.iSOsID AS SalesDetailID,sd.cInvCode AS OriginalProductDrawing,
  sd.cDefine29 AS OriginalQualityNumber,sd.cDefine25 AS OriginalSalesProductionNumber,
  sd.cSOCode AS SalesOrderCode,sd.iRowNo AS SalesLineSequence,sd.iQuantity AS Quantity,
  NULLIF(LTRIM(RTRIM(sd.cInvCode)),N'') AS ProductDrawing,
  NULLIF(LTRIM(RTRIM(sd.cDefine29)),N'') AS QualityNumber,
  NULLIF(LTRIM(RTRIM(sd.cDefine25)),N'') AS SalesProductionNumber
 FROM dbo.SO_SODetails AS sd
)
