WITH InspectionSources AS (
 SELECT
  N'single-operation:' + i.[工序工时明细主键] AS InspectionId,i.[工序工时明细主键] AS RawInspectionId,i.[工序工时明细主键] AS OperationId,N'dbo.单工序检验_主表' AS SourceObject,
  i.[零件编号] AS LocalPartNumber,i.[U8零件编号] AS PartNumber,i.[生产编号] AS LocalProductionNumber,
  i.[流水工序号] AS [Sequence],i.[工序号] AS DisplaySequence,i.[并行标志] AS ParallelGroup,
  CAST(NULL AS bigint) AS ProductionDetailId,CAST(NULL AS nvarchar(10)) AS Account,
  i.[检验日期] AS InspectedAt,i.[检验意见] AS [Result],i.[合格数量] AS QualifiedQty,i.[不合格数量] AS UnqualifiedQty,i.[报废数量] AS ScrapQty,i.[已报废数量] AS PreviouslyScrappedQty,
  i.[投产数量] AS InputQty,CAST(NULL AS decimal(38,10)) AS ActualInputQty,CAST(NULL AS nvarchar(30)) AS UnitCode,
  CAST(NULL AS bit) AS Cancelled,CAST(NULL AS nvarchar(200)) AS ReworkOf,CAST(NULL AS nvarchar(200)) AS ReworkPartNumber,CAST(NULL AS decimal(18,4)) AS ReworkSequence,
  i.[当前零件编号除取消外最小流水工序号] AS FirstSequenceAtInspection,i.[当前零件编号除取消外最大流水工序号] AS LastSequenceAtInspection,
  i.[流转卡类型] AS FlowCardType,i.[是否外协] AS OutsourcedFlag,i.ExcelServerRCID,i.ExcelServerRN
 FROM dbo.[单工序检验_主表] i
 UNION ALL
 SELECT
  N'rework-operation:' + r.[工序工时明细主键],r.[工序工时明细主键],r.[工序工时明细主键],N'dbo.返工返修工序检验_主表',
  r.[零件编号],r.[U8零件编号],r.[生产编号],r.[流水工序号],r.[工序号],r.[并行标志],
  CAST(NULL AS bigint),CAST(NULL AS nvarchar(10)),r.[检验日期],r.[检验意见],r.[合格数量],CAST(NULL AS int),r.[报废数量],CAST(NULL AS int),
  r.[投产数量],CAST(NULL AS decimal(38,10)),CAST(NULL AS nvarchar(30)),CAST(NULL AS bit),CAST(NULL AS nvarchar(200)),r.[返工返修流转卡上级零件编号],r.[返工返修流转卡上级流水工序号],
  CAST(NULL AS decimal(18,4)),CAST(NULL AS decimal(18,4)),r.[流转卡类型],r.[是否外协],r.ExcelServerRCID,r.ExcelServerRN
 FROM dbo.[返工返修工序检验_主表] r
)
SELECT InspectionId,RawInspectionId,OperationId,SourceObject,LocalPartNumber,PartNumber,LocalProductionNumber,
 [Sequence],DisplaySequence,ParallelGroup,ProductionDetailId,Account,InspectedAt,[Result],QualifiedQty,UnqualifiedQty,ScrapQty,PreviouslyScrappedQty,
 InputQty,ActualInputQty,UnitCode,Cancelled,ReworkOf,ReworkPartNumber,ReworkSequence,FirstSequenceAtInspection,LastSequenceAtInspection,FlowCardType,OutsourcedFlag,ExcelServerRCID,ExcelServerRN,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM InspectionSources
ORDER BY InspectionId
