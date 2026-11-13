SELECT N'生产任务单_主表' AS source_object,e.RcId,r.ExcelServerRN AS source_row,e.FillDate,
 r.[生产编号] AS production_number,r.[U8生产编号] AS u8_number,
 N'U8生产编号' AS u8_number_field,CONVERT(nvarchar(200),NULL) AS part_code,
 CONVERT(nvarchar(200),NULL) AS u8_part_code,r.[订单号] AS order_reference,N'订单号' AS order_reference_field,
 CONVERT(nvarchar(100),r.[数量]) AS quantity,CONVERT(nvarchar(20),r.[账套号]) AS source_account,N'explicit333' AS account_basis
FROM dbo.[生产任务单_主表] r JOIN dbo.ES_RepCase e ON e.RcId=r.ExcelServerRCID
WHERE e.FillDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND e.FillDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) AND (r.[账套号]=N'333')
UNION ALL
SELECT N'产品制造大纲流转卡_主表' AS source_object,e.RcId,r.ExcelServerRN AS source_row,e.FillDate,
 r.[生产编号],r.[u8生产编号],N'u8生产编号',r.[零件编号],r.[U8零件编号],
 CONVERT(nvarchar(200),NULL),CONVERT(nvarchar(100),NULL),CONVERT(nvarchar(100),r.[投产数量]),CONVERT(nvarchar(20),NULL),N'unconfirmed_downstream'
FROM dbo.[产品制造大纲流转卡_主表] r JOIN dbo.ES_RepCase e ON e.RcId=r.ExcelServerRCID
WHERE e.FillDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND e.FillDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) AND (1=1)
UNION ALL
SELECT N'工艺清单汇总_主表' AS source_object,e.RcId,r.ExcelServerRN AS source_row,e.FillDate,
 r.[生产编号],r.[U8生产编号],N'U8生产编号',r.[零件编号],r.[U8零件编号],
 r.[工艺清单表编号],N'工艺清单表编号',CONVERT(nvarchar(100),r.[投产数量]),CONVERT(nvarchar(20),NULL),N'unconfirmed_downstream'
FROM dbo.[工艺清单汇总_主表] r JOIN dbo.ES_RepCase e ON e.RcId=r.ExcelServerRCID
WHERE e.FillDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND e.FillDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) AND (1=1)
UNION ALL
SELECT N'生产订单中间表新_明细' AS source_object,e.RcId,r.ExcelServerRN AS source_row,e.FillDate,
 r.[生产编号],r.[任务与u8生产编号],N'任务与u8生产编号',r.[零件编号],CONVERT(nvarchar(200),NULL),
 r.[生产订单表编号],N'生产订单表编号',CONVERT(nvarchar(100),r.[投产数量]),CONVERT(nvarchar(20),NULL),N'unconfirmed_downstream'
FROM dbo.[生产订单中间表新_明细] r JOIN dbo.ES_RepCase e ON e.RcId=r.ExcelServerRCID
WHERE e.FillDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND e.FillDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) AND (1=1)
ORDER BY FillDate,RcId,source_object,source_row
