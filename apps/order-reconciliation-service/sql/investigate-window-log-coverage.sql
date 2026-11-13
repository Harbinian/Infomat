SELECT N'Sys_Log' AS object_name,COUNT_BIG(*) AS row_count,MIN(BeginDate) AS first_time,MAX(BeginDate) AS last_time,
 SUM(CASE WHEN BeginDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND BeginDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS rewind_window_rows,
 SUM(CASE WHEN BeginDate>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) AND BeginDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS between_restores_rows
FROM dbo.Sys_Log
UNION ALL
SELECT N'_YB_TaskLogs',COUNT_BIG(*),MIN([执行时间]),MAX([执行时间]),
 SUM(CASE WHEN [执行时间]>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND [执行时间]<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END),
 SUM(CASE WHEN [执行时间]>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) AND [执行时间]<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM dbo.[_YB_TaskLogs]
UNION ALL
SELECT N'Sys_QuartzLog',COUNT_BIG(*),MIN(StratDate),MAX(StratDate),
 SUM(CASE WHEN StratDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND StratDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END),
 SUM(CASE WHEN StratDate>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) AND StratDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM dbo.Sys_QuartzLog
