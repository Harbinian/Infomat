SELECT rh.restore_history_id,rh.destination_database_name,rh.restore_date,rh.restore_type,rh.[replace] AS replace_existing_database,
 rh.recovery,rh.user_name AS restore_login,rh.backup_set_id,
 bs.database_name AS backup_database_name,bs.backup_start_date,bs.backup_finish_date,bs.[type] AS backup_type,bs.first_lsn,bs.last_lsn,bs.database_backup_lsn
FROM msdb.dbo.restorehistory rh LEFT JOIN msdb.dbo.backupset bs ON bs.backup_set_id=rh.backup_set_id
WHERE rh.destination_database_name IN (N'UFDATA_333_2025',N'UFDATA_336_2025')
 AND rh.restore_date>=CONVERT(datetime,'20260327',112) AND rh.restore_date<CONVERT(datetime,'20260328',112)
ORDER BY rh.restore_date,rh.restore_history_id
