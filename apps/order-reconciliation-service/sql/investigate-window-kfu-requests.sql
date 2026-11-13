SELECT Id,BeginDate,EndDate,LogType,Success,User_Id,
 CASE WHEN LOWER(Url) LIKE N'%password%' OR LOWER(Url) LIKE N'%pwd%' OR LOWER(Url) LIKE N'%secret%' OR LOWER(Url) LIKE N'%token%' THEN NULL ELSE LEFT(Url,CHARINDEX(N'?',Url+N'?')-1) END AS request_path,
 CASE WHEN LOWER(ExceptionInfo) LIKE N'%password%' OR LOWER(ExceptionInfo) LIKE N'%pwd%' OR LOWER(ExceptionInfo) LIKE N'%secret%' OR LOWER(ExceptionInfo) LIKE N'%token%' THEN 1 ELSE 0 END AS error_withheld,
 CASE WHEN LOWER(ExceptionInfo) LIKE N'%password%' OR LOWER(ExceptionInfo) LIKE N'%pwd%' OR LOWER(ExceptionInfo) LIKE N'%secret%' OR LOWER(ExceptionInfo) LIKE N'%token%' THEN NULL ELSE ExceptionInfo END AS exception_text,
 DATALENGTH(RequestParameter) AS request_bytes,DATALENGTH(ResponseParameter) AS response_bytes
FROM dbo.Sys_Log
WHERE BeginDate>=CONVERT(datetime,'2026-03-26T12:36:08',126) AND BeginDate<CONVERT(datetime,'2026-03-27T18:15:10.753',126)
ORDER BY BeginDate,Id
