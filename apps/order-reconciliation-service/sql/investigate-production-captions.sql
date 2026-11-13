SELECT N'voucheritems' AS dictionary_name,CONVERT(nvarchar(100),CardNum) AS form_key,
 CONVERT(nvarchar(100),VT_ID) AS template_id,TableName AS source_table,FieldName AS source_field,
 carditemname AS caption,CONVERT(nvarchar(40),localeid) AS locale_id,CONVERT(nvarchar(40),ShowIt) AS shown
FROM dbo.voucheritems
WHERE LOWER(FieldName) LIKE N'%relsuser%' OR LOWER(FieldName) LIKE N'%relsdate%' OR LOWER(FieldName) LIKE N'%relstime%'
UNION ALL
SELECT N'AA_ColumnDic',CONVERT(nvarchar(100),cKey),NULL,NULL,cFld,cCaption,CONVERT(nvarchar(40),LocaleID),CONVERT(nvarchar(40),bDisp)
FROM dbo.AA_ColumnDic
WHERE LOWER(cFld) LIKE N'%relsuser%' OR LOWER(cFld) LIKE N'%relsdate%' OR LOWER(cQryField) LIKE N'%relsuser%'
UNION ALL
SELECT N'AA_ColumnDic_base',CONVERT(nvarchar(100),cKey),NULL,NULL,cFld,cCaption,CONVERT(nvarchar(40),LocaleID),CONVERT(nvarchar(40),bDisp)
FROM dbo.AA_ColumnDic_base
WHERE LOWER(cFld) LIKE N'%relsuser%' OR LOWER(cFld) LIKE N'%relsdate%' OR LOWER(cQryField) LIKE N'%relsuser%'
ORDER BY dictionary_name,form_key,template_id,source_field,locale_id
