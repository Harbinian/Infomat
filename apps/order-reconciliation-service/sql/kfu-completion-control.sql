WITH control AS (
SELECT N'parameter' AS Kind,CONVERT(nvarchar(100),Code) AS ItemKey,CONVERT(nvarchar(200),Value) AS ItemValue,
CONVERT(nvarchar(200),NULL) AS TaskName,CONVERT(nvarchar(100),NULL) AS CronExpression,CONVERT(nvarchar(20),NULL) AS TaskStatus,
CONVERT(datetime,NULL) AS LastRunTime,CONVERT(nvarchar(100),NULL) AS LogId,CONVERT(datetime,NULL) AS StartedAt,CONVERT(datetime,NULL) AS FinishedAt,
CONVERT(nvarchar(20),NULL) AS TransportResult,CONVERT(int,NULL) AS ReceiptBlocked,CONVERT(int,NULL) AS GeneratedReceiptMessage,CONVERT(int,NULL) AS CompletedMessage
FROM dbo._YB_SystemParams WHERE Code IN ('AutoUseDate','CCPRKFlag')
UNION ALL
SELECT N'task',CONVERT(nvarchar(100),o.Id),NULL,o.TaskName,o.CronExpression,CONVERT(nvarchar(20),o.Status),o.LastRunTime,CONVERT(nvarchar(100),l.LogId),l.StratDate,l.EndDate,CONVERT(nvarchar(20),l.Result),
CASE WHEN l.ResponseContent IS NULL THEN NULL WHEN l.ResponseContent LIKE N'%有正在进行的产成品入库业务%' THEN 1 ELSE 0 END,
CASE WHEN l.ResponseContent IS NULL THEN NULL WHEN l.ResponseContent LIKE N'%生成产成品入库单%' THEN 1 ELSE 0 END,
CASE WHEN l.ResponseContent IS NULL THEN NULL WHEN l.ResponseContent LIKE N'%执行完成%' THEN 1 ELSE 0 END
FROM dbo.Sys_QuartzOptions o OUTER APPLY (
SELECT TOP (1) t.LogId,t.StratDate,t.EndDate,t.Result,t.ResponseContent FROM dbo.Sys_QuartzLog t
WHERE t.Id=o.Id AND t.StratDate=(SELECT MAX(z.StratDate) FROM dbo.Sys_QuartzLog z WHERE z.Id=o.Id)
ORDER BY t.LogId DESC) l
WHERE o.TaskName=N'自动传递领料与完工' OR o.ApiUrl LIKE '%/momorderdetail/TDOrder%'
)
SELECT control.*,GETDATE() AS ObservedServerTime,COUNT_BIG(*) OVER() AS _expectedCount FROM control ORDER BY Kind,ItemKey
