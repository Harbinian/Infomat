SELECT [业务类型],COUNT_BIG(*) AS log_rows,COUNT(DISTINCT [生产编号]) AS production_number_count,
 MIN([执行时间]) AS first_time,MAX([执行时间]) AS last_time,
 SUM(CASE WHEN [执行时间]>=CONVERT(datetime,'2026-03-27T14:25:23.440',126) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS between_restores_rows,
 CASE WHEN LOWER([提示信息]) LIKE N'%password%' OR LOWER([提示信息]) LIKE N'%pwd%' OR LOWER([提示信息]) LIKE N'%secret%' OR LOWER([提示信息]) LIKE N'%token%' THEN NULL ELSE [提示信息] END AS message_text
FROM dbo.[_YB_TaskLogs]
WHERE [执行时间]>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND [执行时间]<CONVERT(datetime,'2026-03-27T18:15:10.753',126)
GROUP BY [业务类型],[提示信息]
ORDER BY [业务类型],MIN([执行时间])
