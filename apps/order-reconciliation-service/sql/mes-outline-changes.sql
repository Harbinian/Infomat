SELECT h.[制造大纲编号],h.[制造大纲版次],d.[版次],d.[更改时间],d.[适用批架次],d.[描述],d.[明细主键],d.ExcelServerRCID,d.ExcelServerRN,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.[产品制造大纲版次记录页_明细] d LEFT JOIN dbo.[产品制造大纲版次记录页_主表] h ON h.ExcelServerRCID=d.ExcelServerRCID
WHERE d.[描述] LIKE N'%BOM%' OR d.[描述] LIKE N'%数量%' OR d.[描述] LIKE N'%用量%' OR d.[描述] LIKE N'%子件%' OR d.[描述] LIKE N'%组件%'
