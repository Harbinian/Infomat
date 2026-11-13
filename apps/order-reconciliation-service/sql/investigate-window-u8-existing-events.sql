SELECT h.MoCode,d.MoDId,d.MoId,h.CreateDate,h.CreateTime,h.ModifyTime,d.RelsTime,d.CloseTime,d.Define25,d.Define28,d.Status
FROM dbo.mom_orderdetail d JOIN dbo.mom_order h ON h.MoId=d.MoId
WHERE (d.RelsTime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND d.RelsTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126))
 OR (d.CloseTime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND d.CloseTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126))
 OR (h.ModifyTime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND h.ModifyTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126))
ORDER BY h.MoCode,d.MoDId
