SELECT DB_NAME() AS database_name,HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS database_view_definition,
 (SELECT COUNT_BIG(*) FROM sys.sql_modules) AS visible_modules,
 (SELECT COUNT_BIG(*) FROM sys.sql_modules WHERE definition IS NOT NULL) AS readable_modules,
 OBJECT_ID(N'dbo.sp_GetID') AS local_getid_object,
 HAS_PERMS_BY_NAME(N'dbo.sp_GetID',N'OBJECT',N'VIEW DEFINITION') AS local_getid_view_definition
