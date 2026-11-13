SELECT OpComponentId,BomId,SortSeq,OpSeq,ComponentId,EffBegDate,EffEndDate,FVFlag,BaseQtyN,BaseQtyD,CompScrap,ByproductFlag,OptionsId,AuxUnitCode,ChangeRate,AuxBaseQtyN,ProductType,RecursiveFlag,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bom_opcomponent ORDER BY BomId,SortSeq,OpComponentId
