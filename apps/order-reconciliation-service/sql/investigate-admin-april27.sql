SELECT cAcc_Id,cUser_Id,cLog_ID,cLogItem_ID,cStation,dInTime,dOutTime,Success,
 CASE WHEN LOWER(cLog_Txt) LIKE N'%password%' OR LOWER(cLog_Txt) LIKE N'%pwd%' OR LOWER(cLog_Txt) LIKE N'%secret%' OR LOWER(cLog_Txt) LIKE N'%token%' THEN NULL ELSE cLog_Txt END AS operation_text
FROM UFSystem.dbo.UA_AALog_base
WHERE dInTime>=CONVERT(datetime,'20260427',112) AND dInTime<CONVERT(datetime,'20260428',112)
 AND (cAcc_Id=N'333' OR cLog_Txt LIKE N'%333%' OR cLog_Txt COLLATE Latin1_General_100_CI_AS LIKE N'%UA[_]Identity%')
ORDER BY dInTime
