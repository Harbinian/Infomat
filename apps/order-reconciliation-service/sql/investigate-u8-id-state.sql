SELECT N'physical' AS scope,
 (SELECT MAX(MoId) FROM dbo.mom_order) AS max_header_moid,
 (SELECT MAX(MoId) FROM dbo.mom_orderdetail) AS max_detail_moid,
 (SELECT MAX(MoDId) FROM dbo.mom_orderdetail) AS max_modid,
 (SELECT COUNT_BIG(*) FROM dbo.mom_order) AS headers,
 (SELECT COUNT_BIG(*) FROM dbo.mom_orderdetail) AS details
UNION ALL
SELECT N'user_joined',MAX(a.MoId),MAX(b.MoId),MAX(b.MoDId),COUNT_BIG(DISTINCT a.MoId),COUNT_BIG(*)
FROM dbo.mom_order a JOIN dbo.mom_orderdetail b ON a.MoId=b.MoId JOIN dbo.bas_part c ON b.PartId=c.PartId
