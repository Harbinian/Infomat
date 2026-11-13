SELECT e.*,COUNT_BIG(*) OVER() AS _expectedCount FROM (
 SELECT N'enum' AS record_kind,CONVERT(nvarchar(100),EnumType) AS object_key,EnumCode AS field_code,EnumName AS caption,CONVERT(nvarchar(100),EnumType) AS enum_type
 FROM dbo.AA_Enum WHERE EnumType IN(N'BO.FVFlag',N'EnumFVFlag',N'MO.MoClass',N'BO.WIPType',N'MO.MoComponentSupplyType') AND LocaleId=N'zh-CN'
 UNION ALL
 SELECT N'field',CardNum,FieldName,carditemname,CONVERT(nvarchar(100),EnumType)
 FROM dbo.voucheritems WHERE localeid=N'zh-CN' AND CardNum IN(N'MO21',N'MO25',N'MO2101',N'MO2102')
 AND FieldName IN(N'WIPType',N'DWIPType',N'ReplenishQty',N'DReplenishQty',N'IssQty',N'DIssQty',N'Qty',N'DQty',N'UpperMoQty')
) e
