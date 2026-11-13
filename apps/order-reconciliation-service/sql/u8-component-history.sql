SELECT HistoryId,VariationAction,VariationLogId,ParentHistoryId,HistorySeq,HistoryMode,OpComponentId,BomId,SortSeq,ComponentId,EffBegDate,EffEndDate,FVFlag,BaseQtyN,BaseQtyD,CompScrap,ByproductFlag,OptionsId,AuxUnitCode,ChangeRate,AuxBaseQtyN,ProductType,Remark,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bom_opcomponenthistory
