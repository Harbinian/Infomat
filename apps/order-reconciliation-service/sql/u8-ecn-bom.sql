SELECT BomType,EBomId,ParentId,ParentScrap,Version,VersionDesc,VersionEffDate,VersionEndDate,IdentCode,IdentDesc,CreateDate,ModifyDate,Updcount,CreateTime,ModifyTime,ApplyDId,Status,RelsDate,RelsTime,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ecn_bom
