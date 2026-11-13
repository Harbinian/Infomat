SELECT N'production_interface' AS record_kind,ID,U8ID,U8AUTOID,[BOM编号] AS order_code,[生产编号] AS production_number,[创建日期] AS source_date,[status]
FROM dbo.momorderdetail
WHERE [账套号]=N'333' AND [创建日期]>=CONVERT(datetime,'20260326',112) AND [创建日期]<CONVERT(datetime,'20260328',112)
UNION ALL
SELECT N'sales_interface',ID,U8ID,U8AUTOID,[订单号],[生产编号],[创建时间],[status]
FROM dbo.SODetails
WHERE [账套号]=N'333' AND [创建时间]>=CONVERT(datetime,'20260326',112) AND [创建时间]<CONVERT(datetime,'20260328',112)
