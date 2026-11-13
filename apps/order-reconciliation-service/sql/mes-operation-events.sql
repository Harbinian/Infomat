SELECT
 o.[工序工时明细主键] AS OperationId,N'dbo.生产工序信息_主表' AS SourceObject,
 o.[零件编号] AS LocalPartNumber,o.[U8零件编号] AS PartNumber,o.[生产编号] AS LocalProductionNumber,o.[U8生产编号] AS ProductionNumber,
 o.[流水工序号] AS [Sequence],o.[工序号] AS DisplaySequence,o.[工序状态] AS [Status],o.[并行标志] AS ParallelGroup,
 CAST(NULL AS bigint) AS ProductionDetailId,CAST(NULL AS nvarchar(10)) AS Account,
 CAST(NULL AS datetime) AS StartedAt,o.[工序启动日期] AS ActivatedAt,o.[开工日期] AS CardStartedAt,o.[工序分配日期] AS AssignedAt,
 o.[投产数量] AS InputQty,CAST(NULL AS decimal(38,10)) AS ActualInputQty,CAST(NULL AS nvarchar(30)) AS UnitCode,
 o.[检验日期] AS InspectionAt,o.[检验意见] AS InspectionResult,o.[合格数量] AS QualifiedQty,o.[不合格数量] AS UnqualifiedQty,o.[报废数量] AS ScrapQty,o.[已报废数量] AS PreviouslyScrappedQty,
 CASE WHEN o.[工序状态]=N'取消' THEN 1 ELSE 0 END AS Cancelled,o.[工序取消日期] AS CancelledAt,
 CASE WHEN o.[工序状态]=N'报废' THEN 1 ELSE 0 END AS ScrapState,
 o.[返工返修零件编号] AS ReworkPartNumber,o.[返工返修流水工序号] AS ReworkSequence,CAST(NULL AS nvarchar(200)) AS ReworkOf,
 o.[流转卡类型] AS FlowCardType,o.[是否外协] AS OutsourcedFlag,o.ExcelServerRCID,o.ExcelServerRN,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[生产工序信息_主表] o
ORDER BY o.[零件编号],o.[流水工序号]
