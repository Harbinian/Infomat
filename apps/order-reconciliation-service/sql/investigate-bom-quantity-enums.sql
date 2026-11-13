SELECT N'field' AS record_kind,CardNum AS object_key,FieldName AS field_code,carditemname AS caption,CONVERT(nvarchar(100),EnumType) AS enum_type,EnumTypeString AS enum_description
FROM dbo.voucheritems WHERE FieldName IN(N'FVFlag',N'DFVFlag',N'bVirtual')
UNION ALL
SELECT N'enum',CONVERT(nvarchar(100),EnumType),EnumCode,EnumName,CONVERT(nvarchar(100),EnumType),NULL
FROM dbo.AA_Enum WHERE EnumType IN(SELECT EnumType FROM dbo.voucheritems WHERE FieldName IN(N'FVFlag',N'DFVFlag',N'bVirtual'))
