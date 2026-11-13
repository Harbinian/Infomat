SELECT [制造大纲编号],[制造大纲版次],[制造大纲表编号],[生产编号],[u8生产编号],[零件编号],[U8零件编号],[类别质量编号],[零组件图号],[投产数量],[审核],[审核日期],[批准],[批准日期],ExcelServerRCID,ExcelServerRN,ExcelServerCHG,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[产品制造大纲流转卡_主表]
ORDER BY [制造大纲编号],[类别质量编号]
