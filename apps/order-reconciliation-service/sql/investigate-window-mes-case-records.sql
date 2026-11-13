SELECT e.RcId,e.RtId,t.RtName,e.FillDate,e.LstFillDate,e.State,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.[生产任务单_主表] r WHERE r.ExcelServerRCID=e.RcId AND r.[账套号]=N'333') THEN 1 ELSE 0 END AS is_account333_task,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.[生产订单中间表新_明细] r WHERE r.ExcelServerRCID=e.RcId) THEN 1 ELSE 0 END AS is_production_intermediate,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.[产品制造大纲流转卡_主表] r WHERE r.ExcelServerRCID=e.RcId) THEN 1 ELSE 0 END AS is_traveler,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.[工艺清单汇总_主表] r WHERE r.ExcelServerRCID=e.RcId) THEN 1 ELSE 0 END AS is_process_list
FROM dbo.ES_RepCase e LEFT JOIN dbo.ES_Tmp t ON t.RtId=e.RtId
WHERE e.FillDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND e.FillDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126)
 AND (EXISTS(SELECT 1 FROM dbo.[生产任务单_主表] r WHERE r.ExcelServerRCID=e.RcId AND r.[账套号]=N'333')
 OR EXISTS(SELECT 1 FROM dbo.[生产订单中间表新_明细] r WHERE r.ExcelServerRCID=e.RcId)
 OR EXISTS(SELECT 1 FROM dbo.[产品制造大纲流转卡_主表] r WHERE r.ExcelServerRCID=e.RcId)
 OR EXISTS(SELECT 1 FROM dbo.[工艺清单汇总_主表] r WHERE r.ExcelServerRCID=e.RcId))
ORDER BY e.FillDate,e.RcId
