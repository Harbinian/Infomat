SELECT [生产订单表编号],[生产编号],[零件编号],u8id,u8autoid,[任务与u8生产编号],[质量编号],status,[产品代码],[零件代码],[数量],[投产数量],[单位],[创建日期],ExcelServerRCID,ExcelServerRN,ExcelServerCHG,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[生产订单中间表新_明细] ORDER BY ExcelServerRCID,ExcelServerRN,u8autoid
