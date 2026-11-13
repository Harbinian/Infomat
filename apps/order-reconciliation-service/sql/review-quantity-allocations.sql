SELECT a.AllocateId,a.MoDId,a.SortSeq,a.OpSeq,a.ComponentId,a.OpComponentId,a.InvCode,a.FVFlag,a.BaseQtyN,a.BaseQtyD,a.ParentScrap,a.CompScrap,a.Qty,a.OrgQty,a.AuxQty,a.AuxUnitCode,a.ChangeRate,a.ByproductFlag,a.ProductType,a.SoType,a.SoDId,a.SoCode,a.DemandCode,a.VirOpComponentIds,
 COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.mom_moallocate a JOIN dbo.mom_orderdetail d ON d.MoDId=a.MoDId
WHERE d.Status IN (3,4) ORDER BY a.AllocateId
