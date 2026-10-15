,QualityGroups AS (
 SELECT ProductDrawing,QualityNumber,COUNT(DISTINCT SalesProductionNumber) AS UnitCount,
  COUNT_BIG(*) AS SourceDetailCount,COUNT(DISTINCT NULLIF(LTRIM(RTRIM(SalesOrderCode)),N'')) AS SalesOrderCount,
  SUM(CASE WHEN SalesProductionNumber IS NULL THEN 1 ELSE 0 END) AS MissingProductionNumberCount
 FROM QualitySource
 GROUP BY ProductDrawing,QualityNumber
),QualityClassified AS (
 SELECT *,CASE WHEN ProductDrawing IS NULL OR QualityNumber IS NULL THEN 'pending'
  WHEN UnitCount>1 THEN 'duplicate'
  WHEN MissingProductionNumberCount>0 THEN 'pending'
  ELSE 'unique' END AS CheckStatus
 FROM QualityGroups
),QualityFiltered AS (
 -- 先按完整源头范围判定，再筛选和分页，避免缩小结果后隐藏重复。
 SELECT * FROM QualityClassified
 WHERE (@Drawing IS NULL OR ProductDrawing LIKE @Drawing ESCAPE N'~')
  AND (@QualityNumber IS NULL OR QualityNumber LIKE @QualityNumber ESCAPE N'~')
  AND (@CheckStatus='all' OR CheckStatus=@CheckStatus)
)
