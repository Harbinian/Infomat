SELECT ComponentSubId,OpComponentId,PartId,Factor,EffBegDate,EffEndDate,ReplaceFlag,COUNT_BIG(*) OVER() AS _expectedCount FROM dbo.bom_opcomponentsub ORDER BY ComponentSubId
