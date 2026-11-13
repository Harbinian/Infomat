SELECT N'bom_bom' AS object_name,COUNT_BIG(*) AS row_count FROM dbo.bom_bom
UNION ALL SELECT N'bom_parent',COUNT_BIG(*) FROM dbo.bom_parent
UNION ALL SELECT N'bom_opcomponent',COUNT_BIG(*) FROM dbo.bom_opcomponent
UNION ALL SELECT N'bom_bomhistory',COUNT_BIG(*) FROM dbo.bom_bomhistory
UNION ALL SELECT N'bom_opcomponenthistory',COUNT_BIG(*) FROM dbo.bom_opcomponenthistory
UNION ALL SELECT N'bom_orderbom',COUNT_BIG(*) FROM dbo.bom_orderbom
UNION ALL SELECT N'ecn_ecnapply',COUNT_BIG(*) FROM dbo.ecn_ecnapply
UNION ALL SELECT N'ecn_ecnapplydetail',COUNT_BIG(*) FROM dbo.ecn_ecnapplydetail
UNION ALL SELECT N'ecn_bom',COUNT_BIG(*) FROM dbo.ecn_bom
UNION ALL SELECT N'ecn_opcomponent',COUNT_BIG(*) FROM dbo.ecn_opcomponent
UNION ALL SELECT N'ecn_ecnnote',COUNT_BIG(*) FROM dbo.ecn_ecnnote
UNION ALL SELECT N'mom_moallocate',COUNT_BIG(*) FROM dbo.mom_moallocate
