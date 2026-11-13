SELECT backup_set_id,database_name,backup_start_date,backup_finish_date,[type] AS backup_type,is_copy_only,server_name,first_lsn,last_lsn,database_backup_lsn
FROM msdb.dbo.backupset
WHERE database_name IN(N'UFDATA_333_2025',N'UFDATA_336_2025',N'UFSystem')
 AND backup_start_date>=CONVERT(datetime,'20260327',112) AND backup_start_date<CONVERT(datetime,'20260328',112)
ORDER BY backup_start_date,backup_set_id
