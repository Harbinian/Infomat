SELECT [工艺清单表编号],[生产编号],[U8生产编号],[零件编号],[U8零件编号],[质量编号],[任务编号],[零组件图号],[投产数量],[是否投产],ExcelServerRCID,ExcelServerRN,ExcelServerCHG,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[工艺清单汇总_主表]
ORDER BY [零件编号]
