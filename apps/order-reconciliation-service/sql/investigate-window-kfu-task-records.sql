SELECT Id,[业务类型],[生产编号],[零件编号],[批次],[执行时间],
 CASE WHEN LOWER([提示信息]) LIKE N'%password%' OR LOWER([提示信息]) LIKE N'%pwd%' OR LOWER([提示信息]) LIKE N'%secret%' OR LOWER([提示信息]) LIKE N'%token%' THEN 1 ELSE 0 END AS message_withheld,
 CASE WHEN LOWER([提示信息]) LIKE N'%password%' OR LOWER([提示信息]) LIKE N'%pwd%' OR LOWER([提示信息]) LIKE N'%secret%' OR LOWER([提示信息]) LIKE N'%token%' THEN NULL ELSE [提示信息] END AS message_text
FROM dbo.[_YB_TaskLogs]
WHERE [执行时间]>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND [执行时间]<CONVERT(datetime,'2026-03-27T18:15:10.753',126)
ORDER BY [执行时间],Id
