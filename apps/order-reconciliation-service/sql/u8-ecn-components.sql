SELECT OpComponentId,EBomId,SortSeq,OpSeq,ComponentId,EffBegDate,EffEndDate,FVFlag,BaseQtyN,BaseQtyD,CompScrap,ByproductFlag,OptionsId,AuxUnitCode,ChangeRate,AuxBaseQtyN,ProductType,Remark,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ecn_opcomponent
