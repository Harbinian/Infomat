SELECT u8autoid,u8id,[生产编号],[投产数量],[数量],[单位],ExcelServerRCID,ExcelServerRN
FROM dbo.[生产订单中间表新_明细] WHERE u8autoid IN(N'1000000479',N'1000000481',N'1000000483')
