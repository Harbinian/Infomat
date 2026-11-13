SELECT [生产编号],[U8生产编号],[订单号],[账套号],[任务编号],[产品图号],[产品名称],[数量],[完成状态],[下发日期],ExcelServerRCID,ExcelServerRN,ExcelServerCHG,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[生产任务单_主表] WHERE [账套号]=N'333' OR [账套号] IS NULL OR [账套号]=N''
ORDER BY [生产编号]
