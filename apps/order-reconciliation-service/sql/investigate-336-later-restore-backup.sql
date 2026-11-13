SELECT N'backupset' AS source_object,COUNT_BIG(*) AS row_count,MIN(backup_start_date) AS first_time,MAX(backup_start_date) AS last_time
FROM msdb.dbo.backupset WHERE database_name=N'UFDATA_336_2025'
UNION ALL
SELECT N'restorehistory',COUNT_BIG(*),MIN(restore_date),MAX(restore_date)
FROM msdb.dbo.restorehistory WHERE destination_database_name=N'UFDATA_336_2025'
