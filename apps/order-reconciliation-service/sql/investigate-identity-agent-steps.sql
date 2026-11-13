SELECT j.job_id,j.name AS job_name,j.enabled,j.date_created,j.date_modified,
 st.step_id,st.step_name,st.subsystem,st.database_name,
 DATALENGTH(st.command) AS command_bytes,
 CASE WHEN LOWER(st.command) LIKE N'%password%' OR LOWER(st.command) LIKE N'%pwd%' OR LOWER(st.command) LIKE N'%secret%' OR LOWER(st.command) LIKE N'%token%' THEN 1 ELSE 0 END AS withheld,
 CASE WHEN LOWER(st.command) LIKE N'%password%' OR LOWER(st.command) LIKE N'%pwd%' OR LOWER(st.command) LIKE N'%secret%' OR LOWER(st.command) LIKE N'%token%' THEN NULL ELSE st.command END AS command
FROM msdb.dbo.sysjobs j JOIN msdb.dbo.sysjobsteps st ON st.job_id=j.job_id
WHERE st.command COLLATE Latin1_General_100_CI_AS LIKE N'%UA[_]Identity%'
ORDER BY j.name,st.step_id
