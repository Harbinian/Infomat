SELECT N'UFSystem' AS database_name,t.name AS table_name,ep.name AS property_name,
 CASE WHEN LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%password%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%pwd%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%secret%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%token%' THEN NULL ELSE CONVERT(nvarchar(max),ep.value) END AS property_value
FROM UFSystem.sys.tables t JOIN UFSystem.sys.extended_properties ep ON ep.major_id=t.object_id AND ep.minor_id=0
WHERE t.name IN(N'UA_Identity',N'ua_identityBAK20260427')
UNION ALL
SELECT DB_NAME(),t.name,ep.name,
 CASE WHEN LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%password%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%pwd%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%secret%' OR LOWER(CONVERT(nvarchar(max),ep.value)) LIKE N'%token%' THEN NULL ELSE CONVERT(nvarchar(max),ep.value) END
FROM sys.tables t JOIN sys.extended_properties ep ON ep.major_id=t.object_id AND ep.minor_id=0
WHERE t.name=N'UA_Identity_Ex'
