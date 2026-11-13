SELECT
    SYSUTCDATETIME() AS read_at_utc,
    rh.restore_history_id,
    rh.destination_database_name,
    rh.restore_date,
    rh.restore_type,
    rh.[replace] AS replace_existing_database,
    rh.recovery,
    rh.user_name AS restore_login,
    rh.backup_set_id,
    bs.database_name AS backup_database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.[type] AS backup_type,
    bs.server_name AS backup_source_server,
    bs.first_lsn,
    bs.last_lsn,
    bs.database_backup_lsn
FROM [msdb].[dbo].[restorehistory] AS rh
LEFT JOIN [msdb].[dbo].[backupset] AS bs
    ON bs.backup_set_id = rh.backup_set_id
WHERE rh.destination_database_name IN (N'UFDATA_333_2025', N'KFU8QZ', N'UFSystem')
ORDER BY rh.restore_date, rh.restore_history_id;
