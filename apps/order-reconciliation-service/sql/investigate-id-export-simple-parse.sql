SELECT
    N'UFDATA_333_2025' AS [database_name],
    CONVERT(nvarchar(33), SYSUTCDATETIME(), 126) + N'Z' AS [captured_at_utc],
    [s].[name] AS [schema_name],
    [o].[name] AS [object_name],
    [o].[type_desc] AS [object_type],
    [o].[object_id] AS [object_id],
    [o].[modify_date] AS [modify_date],
    DATALENGTH([m].[definition]) AS [definition_bytes_utf16],
    [m].[definition] AS [definition]
FROM [UFDATA_333_2025].[sys].[all_objects] AS [o]
LEFT JOIN [UFDATA_333_2025].[sys].[schemas] AS [s]
    ON [s].[schema_id] = [o].[schema_id]
LEFT JOIN [UFDATA_333_2025].[sys].[all_sql_modules] AS [m]
    ON [m].[object_id] = [o].[object_id]
WHERE [o].[name] = N'sp_GetIDWithoutRemote'
ORDER BY [s].[name], [o].[object_id]
FOR XML PATH('object'), ROOT('definition_export'), TYPE;
