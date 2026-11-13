SELECT ID,U8ID,U8AUTOID,[账套号],[生产编号],[订单号],[产品代码],[产品图号],[数量],[单位],status,[创建时间],COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.SODetails WHERE [账套号]=N'333' ORDER BY ID
