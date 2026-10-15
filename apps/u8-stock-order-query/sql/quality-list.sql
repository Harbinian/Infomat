/*QUALITY_GROUPS*/
SELECT COUNT_BIG(*) AS Total,
 COALESCE(SUM(CASE WHEN CheckStatus='duplicate' THEN 1 ELSE 0 END),0) AS Duplicates,
 COALESCE(SUM(CASE WHEN CheckStatus='unique' THEN 1 ELSE 0 END),0) AS UniqueGroups,
 COALESCE(SUM(CASE WHEN CheckStatus='pending' THEN 1 ELSE 0 END),0) AS Pending,
 CONVERT(varchar(23),DATEADD(HOUR,8,SYSUTCDATETIME()),121) AS CheckedAtUtc8
FROM QualityFiltered;
/*QUALITY_GROUPS*/
SELECT ProductDrawing,QualityNumber,UnitCount,CONVERT(varchar(30),SourceDetailCount) AS SourceDetailCount,
 SalesOrderCount,MissingProductionNumberCount,CheckStatus
FROM QualityFiltered
ORDER BY CASE WHEN ProductDrawing IS NULL THEN 0 ELSE 1 END,ProductDrawing,
 CASE WHEN QualityNumber IS NULL THEN 0 ELSE 1 END,QualityNumber
OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
