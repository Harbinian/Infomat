LEFT JOIN dbo.mom_orderdetail AS md ON md.MoDId=CASE WHEN m.VoucherType='11' THEN m.ProductionDetailID ELSE TRY_CONVERT(int,m.SourceReferenceID) END
LEFT JOIN dbo.mom_order AS mo ON mo.MoId=md.MoId
LEFT JOIN dbo.SO_SODetails AS sd ON sd.iSOsID=m.SalesDetailID
LEFT JOIN dbo.mom_moallocate AS ma ON m.VoucherType='11' AND ma.AllocateId=m.SourceReferenceID
LEFT JOIN dbo.bom_opcomponent AS bc ON bc.OpComponentId=ma.OpComponentId AND bc.BomId=md.BomId AND bc.ComponentId=ma.ComponentId
OUTER APPLY (SELECT CASE
 WHEN md.MoDId IS NULL THEN 'production_detail_not_found'
 WHEN mo.MoId IS NULL THEN 'production_header_not_found'
 WHEN NULLIF(LTRIM(RTRIM(m.ProductionOrderCode)),N'') IS NULL THEN 'production_order_missing'
 WHEN LTRIM(RTRIM(m.ProductionOrderCode))<>LTRIM(RTRIM(mo.MoCode)) THEN 'production_order_disagreement'
 WHEN m.VoucherType='10' AND m.InventoryCode<>md.InvCode THEN 'production_inventory_disagreement'
 WHEN m.VoucherType='11' AND (ma.AllocateId IS NULL OR ma.MoDId<>md.MoDId OR ma.InvCode<>m.InventoryCode) THEN 'allocation_disagreement'
 ELSE 'matched' END AS NumberReferenceStatus) AS nr
OUTER APPLY (SELECT CASE
 WHEN m.SalesDetailID IS NULL THEN 'sales_reference_missing'
 WHEN sd.iSOsID IS NULL THEN 'sales_detail_not_found'
 WHEN NULLIF(LTRIM(RTRIM(m.SalesOrderCode)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(sd.cSOCode)),N'') IS NULL THEN 'sales_order_missing'
 WHEN LTRIM(RTRIM(m.SalesOrderCode))<>LTRIM(RTRIM(sd.cSOCode)) THEN 'sales_order_disagreement'
 WHEN nr.NumberReferenceStatus='matched' AND (md.OrderDId IS NULL OR md.OrderDId<>sd.iSOsID) THEN 'production_sales_disagreement'
 ELSE 'matched' END AS SalesNumberReferenceStatus) AS sr
OUTER APPLY (SELECT
 -- 质量编号取销售源头；生产复制值独立返回，缺失时不互相补填。
 CASE WHEN sr.SalesNumberReferenceStatus='matched' THEN sd.cDefine29 END AS QualityNumber,
 CASE WHEN nr.NumberReferenceStatus='matched' THEN md.Define29 END AS ProductionQualityNumber,
 CASE WHEN sr.SalesNumberReferenceStatus='matched' THEN sd.cDefine25 END AS CurrentSalesProductionNumber,
 CASE WHEN nr.NumberReferenceStatus='matched' THEN md.Define28 END AS U8PartNumber,
 CASE WHEN nr.NumberReferenceStatus='matched' AND md.SortSeq IS NOT NULL AND NULLIF(LTRIM(RTRIM(mo.MoCode)),N'') IS NOT NULL
 THEN LTRIM(RTRIM(mo.MoCode))+CONVERT(nvarchar(20),md.SortSeq) END AS CalculatedU8PartNumber) AS n
OUTER APPLY (SELECT CASE WHEN sr.SalesNumberReferenceStatus<>'matched' OR nr.NumberReferenceStatus<>'matched' THEN 'reference_unconfirmed'
            WHEN NULLIF(LTRIM(RTRIM(n.QualityNumber)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(n.ProductionQualityNumber)),N'') IS NULL THEN 'missing'
            WHEN LTRIM(RTRIM(n.QualityNumber))=LTRIM(RTRIM(n.ProductionQualityNumber)) THEN 'same' ELSE 'different' END AS QualityNumberCheck) AS qc
