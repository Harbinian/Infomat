SELECT
    DB_NAME() AS [@database],
    CONVERT(nvarchar(33), SYSUTCDATETIME(), 126) + N'Z' AS [@captured_at_utc],
    CONVERT(nvarchar(128), SERVERPROPERTY(N'ServerName')) AS [server_name],
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION') AS [database_view_definition],
    (
        SELECT
            expected.object_name AS [requested_name],
            s.name AS [schema_name], o.name AS [object_name], o.type_desc,
            o.object_id, o.create_date, o.modify_date,
            CASE WHEN o.object_id IS NULL THEN N'NOT_VISIBLE_OR_NOT_FOUND'
                 WHEN o.type = N'SN' THEN N'SYNONYM_FOLLOW_BASE_OBJECT'
                 WHEN m.definition IS NOT NULL THEN N'DEFINITION_AVAILABLE'
                 WHEN OBJECTPROPERTYEX(o.object_id, N'IsEncrypted') = 1 THEN N'ENCRYPTED'
                 ELSE N'DEFINITION_UNAVAILABLE' END AS [definition_status],
            HAS_PERMS_BY_NAME(QUOTENAME(s.name) + N'.' + QUOTENAME(o.name),
                              N'OBJECT', N'VIEW DEFINITION') AS [can_view_definition],
            CONVERT(int, OBJECTPROPERTYEX(o.object_id, N'IsEncrypted')) AS [is_encrypted],
            sy.base_object_name AS [synonym_target],
            DATALENGTH(m.definition) AS [definition_bytes_utf16],
            (
                SELECT p.parameter_id AS [ordinal], p.name,
                       ty.name AS [type_name], p.max_length AS [max_length_bytes],
                       p.precision, p.scale, p.is_output,
                       p.has_default_value AS [catalog_has_default_value]
                FROM sys.all_parameters AS p
                LEFT JOIN sys.types AS ty ON ty.user_type_id = p.user_type_id
                WHERE p.object_id = o.object_id
                ORDER BY p.parameter_id
                FOR XML PATH('parameter'), ROOT('parameters'), TYPE
            ),
            m.definition AS [definition]
        FROM (VALUES (N'sp_GetIDWithoutRemote')) AS expected(object_name)
        LEFT JOIN sys.all_objects AS o ON LOWER(o.name) = LOWER(expected.object_name)
        LEFT JOIN sys.schemas AS s ON s.schema_id = o.schema_id
        LEFT JOIN sys.all_sql_modules AS m ON m.object_id = o.object_id
        LEFT JOIN sys.synonyms AS sy ON sy.object_id = o.object_id
        ORDER BY s.name, o.object_id
        FOR XML PATH('object'), ROOT('objects'), TYPE
    )
FOR XML PATH('definition_export'), TYPE;
