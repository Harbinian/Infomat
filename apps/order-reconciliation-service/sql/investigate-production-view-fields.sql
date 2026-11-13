SELECT o.name AS view_name,SUBSTRING(m.definition,CASE WHEN CHARINDEX(N'RelsUser',m.definition)>150 THEN CHARINDEX(N'RelsUser',m.definition)-150 ELSE 1 END,400) AS rels_user_expression,
 SUBSTRING(m.definition,CASE WHEN CHARINDEX(N'RelsDate',m.definition)>100 THEN CHARINDEX(N'RelsDate',m.definition)-100 ELSE 1 END,300) AS rels_date_expression
FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE o.name IN(N'v_mom_orderdetail_wf',N'v_mom_orderdetail_MO25')
