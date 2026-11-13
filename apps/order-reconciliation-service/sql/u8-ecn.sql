SELECT ApplyId,DocCode,DocDate,GradeId,ReasonId,PlanAuditDate,PlanReleaseDate,AuditDate,ReleaseDate,Status,AuditStatus,CreateDate,ModifyDate,UpdCount,CreateTime,ModifyTime,AuditTime,ReleaseTime,CloseDate,CloseTime,OrgStatus,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ecn_ecnapply
