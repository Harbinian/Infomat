SELECT x.*,COUNT_BIG(*) OVER() AS _expectedCount FROM (
SELECT N'trigger' AS Kind,OBJECT_NAME(t.parent_id) AS ParentObject,t.name AS ObjectName,CONVERT(nvarchar(30),t.is_disabled) AS State,CONVERT(nvarchar(400),NULL) AS Detail,CONVERT(nvarchar(30),NULL) AS DefinitionLength
FROM sys.triggers t WHERE t.parent_id IN(OBJECT_ID(N'dbo.mom_moallocate'),OBJECT_ID(N'dbo.mom_orderdetail'),OBJECT_ID(N'dbo.mom_order'))
UNION ALL
SELECT N'default',OBJECT_NAME(c.object_id),c.name,CONVERT(nvarchar(30),c.is_nullable),CONVERT(nvarchar(400),dc.definition),NULL
FROM sys.columns c LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id WHERE c.object_id=OBJECT_ID(N'dbo.mom_moallocate') AND c.name IN(N'Qty',N'OrgQty',N'IssQty',N'UpperMoQty',N'BaseQtyN',N'BaseQtyD')
UNION ALL
SELECT N'module',NULL,o.name,o.type_desc,CASE WHEN sm.definition LIKE N'%Qty = 0%' OR sm.definition LIKE N'%Qty=0%' THEN N'contains-zero-quantity-expression' ELSE N'quantity-reference' END,CONVERT(nvarchar(30),LEN(sm.definition))
FROM sys.sql_modules sm JOIN sys.objects o ON o.object_id=sm.object_id WHERE sm.definition LIKE N'%mom_moallocate%' AND sm.definition LIKE N'%Qty%' AND o.type IN(N'TR',N'P')
) x
