SELECT m.VoucherType,CONVERT(varchar(20),m.DetailID) AS DetailID,CONVERT(varchar(20),m.VoucherID) AS VoucherID,
       m.VoucherCode,CONVERT(varchar(10),m.VoucherDate,23) AS VoucherDate,m.InventoryCode,m.BatchNumber,
       CONVERT(varchar(50),m.Quantity) AS Quantity,m.SourceProductionNumber,m.SourceProductionOrderCode,
       CONVERT(varchar(20),m.SourceReferenceID) AS SourceReferenceID,m.AttributionRole,m.AttributedProductionNumber,
       m.ProductionOrderCode,CONVERT(varchar(20),m.ProductionDetailID) AS ProductionDetailID,
       CONVERT(varchar(20),m.SalesDetailID) AS SalesDetailID,m.SalesOrderCode,m.SalesProductionNumber,
       m.ResolutionStatus,m.ResolutionReason,m.ProductionNumberDiffers,m.ProductionOrderDiffers,
       CONVERT(varchar(23),m.CapturedAtUtc8,121) AS CapturedAtUtc8,
       CONVERT(varchar(23),m.RefreshedAtUtc8,121) AS RefreshedAtUtc8,
       i.cInvName AS InventoryName,i.cInvStd AS InventorySpec,md.InvCode AS ParentInventoryCode,pi.cInvName AS ParentInventoryName,
       n.QualityNumber,n.ProductionQualityNumber,n.CurrentSalesProductionNumber,n.U8PartNumber,sr.SalesNumberReferenceStatus,
       qc.QualityNumberCheck,
       CASE WHEN nr.NumberReferenceStatus='matched' THEN md.SortSeq END AS ProductionLineSequence,
       n.CalculatedU8PartNumber,nr.NumberReferenceStatus,
       CASE WHEN nr.NumberReferenceStatus<>'matched' THEN 'reference_unconfirmed'
            WHEN NULLIF(LTRIM(RTRIM(n.U8PartNumber)),N'') IS NULL OR n.CalculatedU8PartNumber IS NULL THEN 'missing'
            WHEN LTRIM(RTRIM(n.U8PartNumber))=n.CalculatedU8PartNumber THEN 'same' ELSE 'different' END AS PartNumberCheck,
       CASE WHEN nr.NumberReferenceStatus='matched' THEN ma.SortSeq END AS AllocationLineSequence,
       CASE WHEN nr.NumberReferenceStatus='matched' AND ma.InvCode=m.InventoryCode THEN bc.SortSeq END AS BomComponentLineSequence
