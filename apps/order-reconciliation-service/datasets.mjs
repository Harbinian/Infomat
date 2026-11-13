import {DATASETS} from './reconcile.mjs';
// Quantity-only extracts stay as immutable, hashed batch files. The eight
// existing ledger sources are read once and retain their SQLite snapshots.
export const QUANTITY_DATASETS={
 'u8-bom':{source:'u8',object:'dbo.bom_bom + dbo.bom_parent',key:'BomId'},
 'u8-bom-components':{source:'u8',object:'dbo.bom_opcomponent',key:'OpComponentId'},
 'u8-parts':{source:'u8',object:'dbo.bas_part + dbo.Inventory + dbo.ComputationUnit',key:'PartId'},
 'u8-allocations':{source:'u8',object:'dbo.mom_moallocate',key:'AllocateId'},
 'u8-component-options':{source:'u8',object:'dbo.bom_opcomponentopt',key:'OptionsId'},
 'u8-substitutes':{source:'u8',object:'dbo.bom_opcomponentsub',key:'ComponentSubId'},
 'u8-bom-history':{source:'u8',object:'dbo.bom_bomhistory',key:'HistoryId'},
 'u8-component-history':{source:'u8',object:'dbo.bom_opcomponenthistory',key:'HistoryId'},
 'u8-order-bom':{source:'u8',object:'dbo.bom_orderbom',key:'AutoId'},
 'u8-ecn':{source:'u8',object:'dbo.ecn_ecnapply',key:'ApplyId'},
 'u8-ecn-details':{source:'u8',object:'dbo.ecn_ecnapplydetail',key:'ApplyDId'},
 'u8-ecn-bom':{source:'u8',object:'dbo.ecn_bom',key:'EBomId'},
 'u8-ecn-components':{source:'u8',object:'dbo.ecn_opcomponent',key:'OpComponentId'},
 'u8-ecn-notes':{source:'u8',object:'dbo.ecn_ecnnote',key:'NoteId'},
 'u8-bom-log':{source:'u8',object:'dbo.variationlog (BOM and production categories)',key:'Id'},
 'u8-quantity-enums':{source:'u8',object:'dbo.AA_Enum (quantity semantics)',key:'field_code'},
 'mes-outline-changes':{source:'mes',object:'dbo.产品制造大纲版次记录页_明细 + 主表 (quantity clues)',key:'明细主键'}
};
export const MATERIAL_DATASETS={
 'u8-product-receipts':{source:'u8',object:'dbo.rdrecord10 + dbo.rdrecords10',key:'ReceiptLineId'},
 'u8-material-issues':{source:'u8',object:'dbo.rdrecord11 + dbo.rdrecords11 + dbo.mom_moallocate',key:'IssueLineId'},
 'u8-other-issues':{source:'u8',object:'dbo.rdrecord09 + dbo.rdrecords09 (outbound)',key:'AutoID'},
 'u8-production-links':{source:'u8',object:'dbo.mom_orderdetail (all current links)',key:'MoDId'},
 'u8-production-copies':{source:'u8',object:'13 inspected production-detail retained tables',key:'MoDId'},
 'u8-copy-metadata':{source:'u8',object:'sys.objects (13 retained tables)',key:'ObjectName'},
 'u8-material-history':{source:'u8',object:'production/material/stock histories and substitution clues',key:'RecordId'},
 'u8-quantity-write-metadata':{source:'u8',object:'quantity defaults and visible module metadata',key:'ObjectName'}
};
export const CHAIN_DATASETS={
 'kfu-completion':{source:'kfu',object:'dbo.momorderdetail (all accounts for reference conflicts)',key:'ID'},
 'kfu-completion-control':{source:'kfu',object:'business control parameters and latest completion task outcome',key:'ItemKey'},
 'mes-completion-rules':{source:'mes',object:'dbo.ES_Rules completion/issue rules (secret values excluded)',key:'RuleId'}
};
export const DELIVERY_DATASETS={
 'u8-dispatches':{source:'u8',object:'dbo.DispatchLists + dbo.DispatchList',key:'DispatchLineId'},
 'u8-sales-issues':{source:'u8',object:'dbo.rdrecords32 + dbo.rdrecord32',key:'SalesIssueLineId'}
};
export const PROCESSING_DATASETS={
 'mes-operation-events':{source:'mes',object:'dbo.生产工序信息_主表 (processing facts)',key:'OperationId'},
 'mes-inspection-events':{source:'mes',object:'dbo.单工序检验_主表 (inspection facts)',key:'InspectionId'}
};
export const ALL_DATASETS={...DATASETS,...QUANTITY_DATASETS,...MATERIAL_DATASETS,...CHAIN_DATASETS,...DELIVERY_DATASETS,...PROCESSING_DATASETS};
export const quantityAliases={
 'quantity-sales':'u8-sales','quantity-production':'u8-production','quantity-mes':'mes-intermediate','quantity-kfu':'kfu-production','quantity-tasks':'mes-tasks',
 'quantity-bom':'u8-bom','quantity-components':'u8-bom-components','quantity-parts':'u8-parts','quantity-allocations':'u8-allocations',
 'review-quantity-component-options':'u8-component-options','review-quantity-substitutes':'u8-substitutes','bom-quantity-enums':'u8-quantity-enums','investigate-outline-quantity-changes':'mes-outline-changes'
};
export const historyDatasets=['u8-bom-history','u8-component-history','u8-order-bom','u8-ecn','u8-ecn-details','u8-ecn-bom','u8-ecn-components','u8-ecn-notes','u8-bom-log'];
