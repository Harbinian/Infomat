SELECT ExcelServerRCID,ExcelServerRN,[制造大纲编号],[制造大纲版次],[生产编号],[u8生产编号],[零件编号],[U8零件编号],[类别质量编号],[投产数量],[创建日期],[编制日期],[审核日期],[批准日期]
FROM dbo.[产品制造大纲流转卡_主表]
WHERE ExcelServerRCID IN(N'rc20260327007915',N'rc20260327006560')
ORDER BY ExcelServerRCID,ExcelServerRN
