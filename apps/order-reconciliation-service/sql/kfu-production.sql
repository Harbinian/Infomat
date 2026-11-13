SELECT ID,U8ID,U8AUTOID,[账套号],[BOM编号],[生产编号],[零件编号],[产品代码],[零件代码],[数量],[投产数量],status,[质量编号],[创建日期],COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.momorderdetail WHERE [账套号]=N'333' ORDER BY ID
