SELECT ApplyDId,ApplyId,SortSeq,PartId,EcnType,NewFlag,ReferenceId,Version,VersionDesc,VersionEffDate,IdentCode,IdentDesc,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ecn_ecnapplydetail
