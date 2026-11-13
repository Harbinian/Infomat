SELECT p.PartId,p.InvCode,p.bVirtual,p.Free1,p.Free2,p.Free3,p.Free4,p.Free5,p.Free6,p.Free7,p.Free8,p.Free9,p.Free10,p.RoundingFactor,
 i.cInvName,i.cInvStd,i.cComUnitCode,i.cAssComUnitCode,u.cComUnitName,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bas_part p LEFT JOIN dbo.Inventory i ON i.cInvCode=p.InvCode LEFT JOIN dbo.ComputationUnit u ON u.cComunitCode=i.cComUnitCode ORDER BY p.PartId
