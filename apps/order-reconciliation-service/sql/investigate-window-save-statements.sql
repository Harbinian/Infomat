SELECT LogId,RcId,OpTime,FuncName,DATALENGTH(SqlStmt) AS statement_bytes,
 CASE WHEN LOWER(SqlStmt) LIKE N'%password%' OR LOWER(SqlStmt) LIKE N'%pwd%' OR LOWER(SqlStmt) LIKE N'%secret%' OR LOWER(SqlStmt) LIKE N'%token%' THEN 1 ELSE 0 END AS statement_withheld,
 CASE WHEN LOWER(SqlStmt) LIKE N'%password%' OR LOWER(SqlStmt) LIKE N'%pwd%' OR LOWER(SqlStmt) LIKE N'%secret%' OR LOWER(SqlStmt) LIKE N'%token%' THEN NULL ELSE SqlStmt END AS statement_text
FROM dbo.ES_Log
WHERE LogId IN(N'20260327008401',N'20260327008987')
ORDER BY OpTime,LogId
