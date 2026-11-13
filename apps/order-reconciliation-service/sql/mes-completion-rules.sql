SELECT r.RtId,t.RtName,r.RuleId,r.RuleName,r.RuleType,r.Op,r.AppOrder,r.UpdTime,r.Ver,
CASE WHEN LOWER(CONVERT(nvarchar(max),r.RuleSpec)) LIKE N'%password%' OR LOWER(CONVERT(nvarchar(max),r.RuleSpec)) LIKE N'%pwd%' OR LOWER(CONVERT(nvarchar(max),r.RuleSpec)) LIKE N'%secret%' OR LOWER(CONVERT(nvarchar(max),r.RuleSpec)) LIKE N'%token%' OR CONVERT(nvarchar(max),r.RuleSpec) LIKE N'%密码%' THEN NULL ELSE CONVERT(nvarchar(max),r.RuleSpec) END AS RuleSpec,
COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ES_Rules r LEFT JOIN dbo.ES_Tmp t ON t.RtId=r.RtId
WHERE CONVERT(nvarchar(max),r.RuleSpec) LIKE N'%是否领料%' OR CONVERT(nvarchar(max),r.RuleSpec) LIKE N'%是否入库%'
ORDER BY r.RtId,r.RuleId
