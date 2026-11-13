SELECT ID,U8ID,U8AUTOID,[账套号],[BOM编号],[生产编号],[零件编号],[产品代码],[零件代码],[创建日期],[是否领料],[是否入库],[批号],[投产数量],DENSE_RANK() OVER(ORDER BY U8AUTOID) AS ReferenceGroup,DENSE_RANK() OVER(ORDER BY [零件编号]) AS PartGroup,GETDATE() AS ObservedServerTime,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.momorderdetail ORDER BY ID
