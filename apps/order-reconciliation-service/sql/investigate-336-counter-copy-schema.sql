SELECT s.name AS schema_name,t.name AS table_name,t.create_date,t.modify_date,c.column_id,c.name AS column_name,ty.name AS type_name,c.max_length
FROM [UFDATA_336_2025].sys.tables t JOIN [UFDATA_336_2025].sys.schemas s ON s.schema_id=t.schema_id
JOIN [UFDATA_336_2025].sys.columns c ON c.object_id=t.object_id JOIN [UFDATA_336_2025].sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.name=N'UA_Identity_Ex' ORDER BY c.column_id
