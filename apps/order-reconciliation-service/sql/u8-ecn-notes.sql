SELECT NoteId,ApplyId,ApplyDId,DocCode,DocDate,DeptCode,CreateDate,ModifyDate,UpdCount,CreateTime,ModifyTime,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.ecn_ecnnote
