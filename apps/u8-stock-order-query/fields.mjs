export const fields = [
  ['VoucherType', '单据类型', '10 为产成品入库；11 为材料出库。', '单据'],
  ['DetailID', '单据明细 ID', '原明细表 AutoID。与单据类型一起唯一标识这条记录。', '单据'],
  ['VoucherID', '单据主表 ID', '原明细表 ID，对应原单据主表 ID。', '单据'],
  ['VoucherCode', '单据号', '来自原单据主表 cCode。一张单据可以有多条映射。', '单据'],
  ['VoucherDate', '单据日期', '原单据业务日期，可能早于首次捕获时间。', '单据'],
  ['InventoryCode', '物料编码', '入库为本次产出物料；材料出库为本次领用物料。', '物料'],
  ['BatchNumber', '批号', '原单据批号，可以为空；相同批号不能单独证明具体来源入库。', '物料'],
  ['Quantity', '数量', '原单据明细数量，保留正负号；本表没有保存计量单位与换算率。', '物料'],
  ['SourceProductionNumber', '原生产编号', '原明细 cDefine25，保留原值和空值，不由实际领用归属覆盖。', '原始引用'],
  ['SourceProductionOrderCode', '原生产订单号', '原明细 cmocode，保留原值。', '原始引用'],
  ['SourceReferenceID', '原生产引用 ID', '原明细 iMPoIds。材料出库指向生产用料 AllocateId；入库当前仅保留该引用。', '原始引用'],
  ['AttributionRole', '归属角色', '入库记录来源归属；材料出库记录实际领用归属。', '订单归属'],
  ['AttributedProductionNumber', '实际归属编号', '入库取原生产编号；材料出库经生产用料引用取得生产明细 Define25。', '订单归属'],
  ['ProductionOrderCode', '生产订单号', '入库取原明细 cmocode；材料出库取实际领用引用对应的生产订单。', '订单归属'],
  ['ProductionDetailID', '生产订单明细 ID', '材料出库保存归属生产明细 MoDId；入库当前为空，不代表没有生产订单。', '订单归属'],
  ['SalesDetailID', '销售订单明细 ID', '销售明细 iSOsID。入库按生产编号唯一匹配；出库按生产明细 OrderDId 引用取得。', '订单归属'],
  ['SalesOrderCode', '销售订单号', '已确定销售明细的 cSOCode。', '订单归属'],
  ['SalesProductionNumber', '销售生产编号', '已确定销售明细的 cDefine25，用于核对实际归属生产编号。', '订单归属'],
  ['ResolutionStatus', '解析状态', '已解析表示归属解析条件满足；待确认表示信息缺失、匹配不唯一或编号不一致。不是单据审核状态。', '核查'],
  ['ResolutionReason', '解析原因', '记录第一个未满足的解析条件；可能还存在其他缺项。', '核查'],
  ['ProductionNumberDiffers', '生产编号差异', '不同：两个有效编号不一致；相同：一致；无法比较：至少一方缺失。不能单独证明跨订单实物流转。', '核查'],
  ['ProductionOrderDiffers', '生产订单差异', '比较原生产订单号与归属生产订单号。至少一方缺失时显示无法比较。', '核查'],
  ['CapturedAtUtc8', '首次捕获时间', '北京时间（UTC+8）。首次生成映射时写入；更新保留，删除后重新捕获会产生新时间。', '时间'],
  ['RefreshedAtUtc8', '最近同步时间', '北京时间（UTC+8）。原出入库主表或明细变化时更新；上游订单单独变化不会刷新。', '时间']
].map(([key, label, comment, group]) => ({ key, label, comment, group }));

export const relatedFields = [
  ['QualityNumber', '质量编号', '源头为已捕获销售明细 ID 对应的 SO_SODetails.cDefine29。生产明细 Define29 为复制值，另行核对。材料出库显示实际领用订单对应的销售质量编号，不代表领用子件自身的来源编号。读取当前值，未固化在映射表。', '质量与零件编号'],
  ['ProductionQualityNumber', '生产明细质量编号', '读取 mom_orderdetail.Define29 当前复制值。与销售源头质量编号分开保存到查询结果，不相互覆盖。', '质量与零件编号'],
  ['QualityNumberCheck', '质量编号核对', '比较销售源头 cDefine29 与生产复制值 Define29，显示一致、不一致、编号缺失或引用待核查。销售与生产同时修改不能由当前值比较发现历史差异。', '质量与零件编号'],
  ['SalesNumberReferenceStatus', '销售源头引用核查', '按映射表 SalesDetailID 查找 SO_SODetails.iSOsID 并核对销售订单号；有有效生产明细引用时再核对 OrderDId。销售引用不完整或不一致时不展示源头质量编号，不按相同质量编号反查订单。', '质量与零件编号'],
  ['CurrentSalesProductionNumber', '销售源头生产编号', '读取 SO_SODetails.cDefine25 当前值。映射表中的销售生产编号是最近一次出入库同步时的值，两者时点不同。', '质量与零件编号'],
  ['U8PartNumber', 'U8 零件编号', '读取 mom_orderdetail.Define28 原值。当前样本符合生产订单号与生产明细行号直接拼接；字段缺失时不自动计算填入。材料出库对应实际领用母件，不是领用材料的来源零件编号。', '质量与零件编号'],
  ['ProductionLineSequence', '生产明细行号', 'mom_orderdetail.SortSeq，是当前零件编号拼接所用的行号。与生产用料行号、BOM 子件行号分开显示。', '质量与零件编号'],
  ['CalculatedU8PartNumber', '按规则计算的零件编号', '用当前 mom_order.MoCode 与 mom_orderdetail.SortSeq 直接拼接，不加分隔符、不补零。仅用于核对，不覆盖 U8 原值。', '质量与零件编号'],
  ['PartNumberCheck', '零件编号核对', '比较 U8 原编号与计算编号：一致、不一致、编号缺失或引用待核查。核对一致不表示实物追溯完成。', '质量与零件编号'],
  ['NumberReferenceStatus', '生产编号引用核查', '核对生产明细、生产订单及物料引用。生产引用不完整或与已捕获归属不符时，不展示生产复制的质量编号及 U8 零件编号。销售源头值由销售源头引用核查独立控制。', '质量与零件编号'],
  ['AllocationLineSequence', '生产用料行号', '材料出库的 mom_moallocate.SortSeq。本次领用在生产用料清单中的行号，不用于生成生产母件的零件编号。', '当前物料与 BOM'],
  ['BomComponentLineSequence', 'BOM 子件行号', '通过生产用料 OpComponentId 读取 bom_opcomponent.SortSeq。没有有效指针时为空，不按相同物料编码猜测。', '当前物料与 BOM'],
  ['InventoryName', '物料名称', '根据本条物料编码读取当前存货档案。', '当前物料与 BOM'],
  ['InventorySpec', '规格型号', '当前存货档案的规格型号。', '当前物料与 BOM'],
  ['ParentInventoryCode', '生产母件编码', '材料出库按已捕获生产明细 ID 读取；入库按保留的原生产引用读取。该信息未固化在映射表。', '当前物料与 BOM'],
  ['ParentInventoryName', '生产母件名称', '当前生产母件档案名称。名称或编码本身不证明组件层级或具体来源批次。', '当前物料与 BOM']
].map(([key, label, comment, group]) => ({ key, label, comment, group, storage: 'current' }));

export const reasons = {
  resolved: '归属解析完成', header_missing: '原单据主表未找到',
  production_number_missing: '生产编号缺失', production_order_missing: '生产订单号缺失',
  sales_number_not_found: '生产编号未匹配销售明细', sales_number_ambiguous: '生产编号匹配多个销售明细',
  sales_order_code_missing: '销售订单号缺失', allocation_reference_missing: '生产用料引用缺失',
  allocation_not_found: '生产用料明细未找到', production_detail_not_found: '生产订单明细未找到',
  production_header_not_found: '生产订单主表未找到', sales_reference_missing: '销售明细引用缺失',
  sales_detail_not_found: '销售明细未找到', sales_production_number_missing: '销售生产编号缺失',
  production_number_disagreement: '归属生产与销售生产编号不一致'
};

export const qualityUniquenessMeta = {
  source: 'dbo.SO_SODetails', unitLabel: '销售生产编号数',
  ruleDescription: '范围为当前账套全部现存销售明细，包括以往及已关闭订单。按销售产品图号 cInvCode 与质量编号 cDefine29 分组；同组存在多个不同销售生产编号 cDefine25 时判为重复。同一来源多次出入库、生产拆单不会增加计数。前后普通空格先去除，按数据库排序规则判等；缺失项单独待核查。',
  fields: [
    {key:'ProductDrawing',label:'产品图号',comment:'SO_SODetails.cInvCode，按用户确认作为产品图号；不使用领用材料或生产母件编码替代。'},
    {key:'QualityNumber',label:'质量编号',comment:'SO_SODetails.cDefine29 销售源头。分组时去除前后普通空格，明细保留原值；不与生产复制值混合计数。'},
    {key:'UnitCount',label:'销售生产编号数',comment:'本图号、质量编号组合中，去除前后普通空格后不同 cDefine25 的数量。相同生产编号出现在多个源头明细中仍计一个。'},
    {key:'SourceDetailCount',label:'源头明细数',comment:'本组合销售明细 iSOsID 数，不按出入库单或生产明细展开。'},
    {key:'SalesOrderCount',label:'销售订单数',comment:'本组合有效销售订单号 cSOCode 的去重数量。'},
    {key:'CheckStatus',label:'核查结果',comment:'有效图号、有效质量编号对应至少两个不同有效生产编号时为重复；缺少必要编号且尚不能证实重复时待核查；否则未发现重复。不表示编号已获业务审核。'}
  ]
};
export const qualitySourceFields = [
  ['ProductDrawing','产品图号原值','SO_SODetails.cInvCode 的原值；组合列表使用去除前后普通空格后的图号。'],
  ['QualityNumber','质量编号原值','SO_SODetails.cDefine29 的原值，不用生产复制值补填。'],
  ['SalesProductionNumber','销售生产编号原值','SO_SODetails.cDefine25 原值，去除前后普通空格后作为本页去重单位。'],
  ['SalesOrderCode','销售订单号','SO_SODetails.cSOCode，保留源头原值。'],
  ['SalesDetailID','销售明细 ID','SO_SODetails.iSOsID，唯一定位销售源头记录；按字符串传输。'],
  ['SalesLineSequence','销售行号','SO_SODetails.iRowNo，不是生产明细行号或 BOM 子件行号。'],
  ['Quantity','销售明细数量','SO_SODetails.iQuantity 原值，保留数据库精度；不据此推断不同销售生产编号或实物实例数量。']
].map(([key,label,comment])=>({key,label,comment}));
qualityUniquenessMeta.fields.push(...qualitySourceFields.filter(field=>!qualityUniquenessMeta.fields.some(existing=>existing.key===field.key)));
