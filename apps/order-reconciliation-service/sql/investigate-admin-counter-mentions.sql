SELECT cAcc_Id,cUser_Id,cLog_ID,cLogItem_ID,cStation,dInTime,dOutTime,Success,
 CASE WHEN LOWER(cLog_Txt) LIKE N'%password%' OR LOWER(cLog_Txt) LIKE N'%pwd%' OR LOWER(cLog_Txt) LIKE N'%secret%' OR LOWER(cLog_Txt) LIKE N'%token%' THEN 1 ELSE 0 END AS withheld,
 CASE WHEN LOWER(cLog_Txt) LIKE N'%password%' OR LOWER(cLog_Txt) LIKE N'%pwd%' OR LOWER(cLog_Txt) LIKE N'%secret%' OR LOWER(cLog_Txt) LIKE N'%token%' THEN NULL ELSE cLog_Txt END AS operation_text
FROM UFSystem.dbo.UA_AALog_base
WHERE dInTime>=CONVERT(datetime,'20260327',112)
 AND (cLog_Txt COLLATE Latin1_General_100_CI_AS LIKE N'%UA[_]Identity%' OR cLog_Txt COLLATE Latin1_General_100_CI_AS LIKE N'%iFatherId%' OR cLog_Txt COLLATE Latin1_General_100_CI_AS LIKE N'%iChildId%' OR cLog_ID COLLATE Latin1_General_100_CI_AS LIKE N'%Identity%')
ORDER BY dInTime
