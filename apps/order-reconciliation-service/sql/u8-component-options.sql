SELECT OptionsId,OptionalFlag,MutexRule,PlanFactor,FeatureRel,COUNT_BIG(*) OVER() AS _expectedCount FROM dbo.bom_opcomponentopt ORDER BY OptionsId
