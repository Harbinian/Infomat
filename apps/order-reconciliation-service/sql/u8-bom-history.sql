SELECT HistoryId,VariationAction,VariationLogId,HistorySeq,HistoryMode,BomId,BomType,Version,VersionDesc,VersionEffDate,VersionEndDate,ParentScrap,ApplyDId,CreateDate,ModifyDate,Status,OrgStatus,RelsDate,RelsTime,CreateTime,ModifyTime,CloseDate,CloseTime,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bom_bomhistory
