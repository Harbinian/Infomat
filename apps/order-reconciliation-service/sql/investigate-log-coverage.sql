SELECT N'UA_AALog_base' AS object_name,COUNT_BIG(*) AS row_count,MIN(dInTime) AS first_time,MAX(dInTime) AS last_time,
 SUM(CASE WHEN dInTime>=CONVERT(datetime,'20260327',112) AND dInTime<CONVERT(datetime,'20260402',112) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END) AS window_rows
FROM UFSystem.dbo.UA_AALog_base WHERE cAcc_Id=N'333' OR cLog_Txt LIKE N'%333%' OR cLog_Txt COLLATE Latin1_General_100_CI_AS LIKE N'%UA[_]Identity%'
UNION ALL
SELECT N'UA_Log',COUNT_BIG(*),MIN(dInTime),MAX(dInTime),SUM(CASE WHEN dInTime>=CONVERT(datetime,'20260327',112) AND dInTime<CONVERT(datetime,'20260402',112) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM UFSystem.dbo.UA_Log WHERE cAcc_Id=N'333'
UNION ALL
SELECT N'GC_OperationLogs',COUNT_BIG(*),MIN(logtime),MAX(logtime),SUM(CASE WHEN logtime>=CONVERT(datetime,'20260327',112) AND logtime<CONVERT(datetime,'20260402',112) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM UFSystem.dbo.GC_OperationLogs
UNION ALL
SELECT N'MM_ActionLog',COUNT_BIG(*),MIN(ACTIONDATE),MAX(ACTIONDATE),SUM(CASE WHEN ACTIONDATE>=CONVERT(datetime,'20260327',112) AND ACTIONDATE<CONVERT(datetime,'20260402',112) THEN CONVERT(bigint,1) ELSE CONVERT(bigint,0) END)
FROM UFSystem.dbo.MM_ActionLog
