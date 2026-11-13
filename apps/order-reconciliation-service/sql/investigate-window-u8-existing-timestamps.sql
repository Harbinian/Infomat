SELECT N'mom_order' AS object_name,COUNT_BIG(*) AS total_rows,MIN(CreateTime) AS first_system_time,MAX(CreateTime) AS last_system_time,
 SUM(CASE WHEN CreateTime IS NOT NULL AND DATEPART(year,CreateTime)<2000 THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS pre2000_time_rows,
 SUM(CASE WHEN CreateTime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND CreateTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS rewind_window_create_time_rows,
 SUM(CASE WHEN CreateTime>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) AND CreateTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS between_restores_create_time_rows
FROM dbo.mom_order
UNION ALL
SELECT N'SO_SOMain',COUNT_BIG(*),MIN(dcreatesystime),MAX(dcreatesystime),
 SUM(CASE WHEN dcreatesystime IS NOT NULL AND DATEPART(year,dcreatesystime)<2000 THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END),
 SUM(CASE WHEN dcreatesystime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND dcreatesystime<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END),
 SUM(CASE WHEN dcreatesystime>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) AND dcreatesystime<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM dbo.SO_SOMain
