SELECT AutoId,OrderType,OrderDId,OrderCode,OrderSeq,BomId,COUNT_BIG(*) OVER() AS _expectedCount
FROM dbo.bom_orderbom
