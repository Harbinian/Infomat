SELECT N'UFSystem' AS database_name,s.name AS schema_name,t.name AS table_name,c.name AS column_name,ty.name AS data_type,
 CONVERT(nvarchar(1000),ep.value) AS column_description
FROM UFSystem.sys.tables t JOIN UFSystem.sys.schemas s ON s.schema_id=t.schema_id
JOIN UFSystem.sys.columns c ON c.object_id=t.object_id JOIN UFSystem.sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN UFSystem.sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
WHERE t.name=N'UA_User' AND c.name IN (N'cUser_Id',N'cUser_Name',N'cUserID',N'cUserName',N'bValid',N'dEndDate')
UNION ALL
SELECT DB_NAME(),s.name,t.name,c.name,ty.name,CONVERT(nvarchar(1000),ep.value)
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name=N'MS_Description'
WHERE (t.name=N'mom_orderdetail' AND c.name IN (N'RelsUser',N'RelsDate',N'CloseUser',N'CloseDate'))
 OR (t.name=N'SO_SOMain' AND c.name IN (N'cVerifier',N'dverifydate',N'cCloser',N'dclosedate',N'dDate'))
ORDER BY database_name,table_name,column_name
