SELECT cAcc_Id,cSub_Id,cUser_Id,cAuth_Id,cStation,dInTime,dOutTime,Success
FROM UFSystem.dbo.UA_Log
WHERE cAcc_Id=N'333' AND dInTime>=CONVERT(datetime,'2026-03-27T18:00:00',126) AND dInTime<CONVERT(datetime,'2026-03-27T19:00:00',126)
ORDER BY dInTime,cSub_Id,cAuth_Id
