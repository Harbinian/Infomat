SELECT LogId,RcId,OpTime,FuncName,DATALENGTH(SqlStmt) AS statement_bytes,
 CASE WHEN LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%password%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%pwd%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%secret%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%token%' THEN 1 ELSE 0 END AS statement_withheld,
 CASE WHEN LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%password%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%pwd%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%secret%' OR LOWER(CONVERT(nvarchar(max),SqlStmt)) LIKE N'%token%' THEN NULL ELSE CONVERT(nvarchar(max),SqlStmt) END AS statement_text
FROM dbo.ES_Log
WHERE LogId IN(N'20260327008401',N'20260327008987')
ORDER BY OpTime,LogId
