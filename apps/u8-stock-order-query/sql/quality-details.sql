/*QUALITY_SOURCE*/
SELECT COUNT_BIG(*) AS Total,CONVERT(varchar(23),DATEADD(HOUR,8,SYSUTCDATETIME()),121) AS CheckedAtUtc8
FROM QualitySource
WHERE (ProductDrawing=@Drawing OR (ProductDrawing IS NULL AND @Drawing IS NULL))
 AND (QualityNumber=@QualityNumber OR (QualityNumber IS NULL AND @QualityNumber IS NULL));
/*QUALITY_SOURCE*/
SELECT CONVERT(nvarchar(30),SalesDetailID) AS SalesDetailID,OriginalProductDrawing AS ProductDrawing,
 OriginalQualityNumber AS QualityNumber,OriginalSalesProductionNumber AS SalesProductionNumber,
 SalesOrderCode,SalesLineSequence,CONVERT(varchar(80),Quantity) AS Quantity
FROM QualitySource
WHERE (ProductDrawing=@Drawing OR (ProductDrawing IS NULL AND @Drawing IS NULL))
 AND (QualityNumber=@QualityNumber OR (QualityNumber IS NULL AND @QualityNumber IS NULL))
ORDER BY SalesDetailID
OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
