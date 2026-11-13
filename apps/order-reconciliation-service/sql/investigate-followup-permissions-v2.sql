SELECT SYSUTCDATETIME() AS source_utc,
 HAS_DBACCESS(N'UFDATA_336_2025') AS source336_access,
 HAS_PERMS_BY_NAME(N'UFSystem',N'DATABASE',N'VIEW DEFINITION') AS ufsystem_view_definition,
 HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW ANY DEFINITION') AS server_view_any_definition,
 HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW SERVER STATE') AS server_view_state,
 HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW SERVER SECURITY STATE') AS server_view_security_state,
 HAS_PERMS_BY_NAME(NULL,NULL,N'VIEW SERVER SECURITY AUDIT') AS server_view_security_audit,
 (SELECT is_query_store_on FROM sys.databases WHERE name=N'UFSystem') AS ufsystem_query_store_on,
 (SELECT is_query_store_on FROM sys.databases WHERE name=N'UFDATA_333_2025') AS u8_query_store_on
