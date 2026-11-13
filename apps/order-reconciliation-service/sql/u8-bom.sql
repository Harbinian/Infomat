SELECT b.BomId,b.BomType,b.Version,b.VersionDesc,b.VersionEffDate,b.VersionEndDate,b.Status,b.RelsDate,b.CreateDate,b.CreateTime,b.ModifyDate,b.ModifyTime,b.UpdCount,b.ApplyDId,p.ParentId,p.ParentScrap,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bom_bom b JOIN dbo.bom_parent p ON p.BomId=b.BomId ORDER BY b.BomId
