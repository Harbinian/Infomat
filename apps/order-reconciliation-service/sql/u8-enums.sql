SELECT EnumType,EnumCode,EnumName,LocaleId FROM dbo.AA_Enum WHERE EnumType IN ('MO.Status','MO.AuditStatus','MO.OrderType') ORDER BY EnumType,EnumCode,LocaleId
