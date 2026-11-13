SELECT LogId,LogType,OpTime,UserId,FuncName,RtId,RcId,
 CASE WHEN LOWER(OpDesc) LIKE N'%password%' OR LOWER(OpDesc) LIKE N'%pwd%' OR LOWER(OpDesc) LIKE N'%secret%' OR LOWER(OpDesc) LIKE N'%token%' THEN 1 ELSE 0 END AS description_withheld,
 CASE WHEN LOWER(OpDesc) LIKE N'%password%' OR LOWER(OpDesc) LIKE N'%pwd%' OR LOWER(OpDesc) LIKE N'%secret%' OR LOWER(OpDesc) LIKE N'%token%' THEN NULL ELSE OpDesc END AS operation_description
FROM dbo.ES_Log
WHERE OpTime>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND OpTime<CONVERT(datetime,'2026-03-27T18:15:10.753',126)
 AND RtId IN(N'10.1',N'17.1',N'2.1',N'61.1')
ORDER BY OpTime,LogId
