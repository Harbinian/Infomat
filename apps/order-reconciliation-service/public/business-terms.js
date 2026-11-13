// Presentation vocabulary only. Never rewrite frozen values, issue keys or rules.
export const sourceNames = {u8:'用友', kfu:'转换平台', mes:'勤哲', qinzhe:'勤哲', cesoft:'勤哲'};
const forms = {
  'u8:dbo.SO_SODetails':'销售订单', 'u8:dbo.SO_SOMain':'销售订单主单',
  'u8:dbo.mom_orderdetail':'生产订单', 'u8:dbo.mom_order':'生产订单主单',
  'kfu:dbo.SODetails':'销售订单转换记录', 'kfu:dbo.momorderdetail':'生产订单转换记录',
  'mes:dbo.生产任务单_主表':'生产任务单', 'mes:dbo.生产订单中间表新_明细':'生产订单接收记录',
  'mes:dbo.产品制造大纲流转卡_主表':'产品制造大纲流转卡', 'mes:dbo.工艺清单汇总_主表':'工艺清单汇总'
};
Object.assign(forms,{"u8:dbo.bom_bom + dbo.bom_parent": "BOM及母件", "u8:dbo.bom_opcomponent": "BOM子件", "u8:dbo.bas_part + dbo.Inventory + dbo.ComputationUnit": "物料及计量单位", "u8:dbo.mom_moallocate": "生产订单用料明细", "u8:dbo.bom_opcomponentopt": "BOM子件选配信息", "u8:dbo.bom_opcomponentsub": "替代子件", "u8:dbo.bom_bomhistory": "BOM历史", "u8:dbo.bom_opcomponenthistory": "BOM子件历史", "u8:dbo.bom_orderbom": "订单BOM关联", "u8:dbo.ecn_ecnapply": "工程变更单", "u8:dbo.ecn_ecnapplydetail": "工程变更明细", "u8:dbo.ecn_bom": "工程变更BOM", "u8:dbo.ecn_opcomponent": "工程变更子件", "u8:dbo.ecn_ecnnote": "工程变更通知", "u8:dbo.variationlog (BOM and production categories)": "BOM及生产操作记录", "u8:dbo.AA_Enum (quantity semantics)": "数量计算选项", "mes:dbo.产品制造大纲版次记录页_明细 + 主表 (quantity clues)": "制造大纲更改线索"});
Object.assign(forms,{
 'u8:dbo.rdrecord10 + dbo.rdrecords10':'产品入库凭据',
 'u8:dbo.rdrecord11 + dbo.rdrecords11 + dbo.mom_moallocate':'材料出库及用料关联',
 'u8:dbo.rdrecord09 + dbo.rdrecords09 (outbound)':'其他出库线索',
 'u8:dbo.mom_orderdetail (all current links)':'当前生产订单关联',
 'u8:13 inspected production-detail retained tables':'生产明细保留资料',
 'u8:sys.objects (13 retained tables)':'保留资料来源信息',
 'u8:production/material/stock histories and substitution clues':'生产用料及库存历史线索',
 'u8:quantity defaults and visible module metadata':'数量默认值及程序线索',
 'kfu:dbo.momorderdetail (all accounts for reference conflicts)':'完工及跨账套关联线索',
 'kfu:business control parameters and latest completion task outcome':'完工任务及保护状态',
 'mes:dbo.ES_Rules completion/issue rules (secret values excluded)':'勤哲完工及领料规则',
 'u8:dbo.DispatchLists + dbo.DispatchList':'发货明细',
 'u8:dbo.rdrecords32 + dbo.rdrecord32':'销售出库明细'
});
export const formName = (source, object) => forms[`${source}:${object}`] || '表单名称待核实';
export const sourceName = source => sourceNames[source] || '来源待核实';
const fields = {
  cSOCode:'销售订单号', MoCode:'生产订单号', cInvCode:'存货编码', InvCode:'存货编码',
  cDefine25:'生产编号', Define25:'生产编号', cDefine29:'销售质量编号', Define29:'生产质量编号',
  cDefine28:'销售单自定义内容（名称待核实）', Define28:'生产单自定义内容（名称待核实）',
  iQuantity:'销售数量', Qty:'生产数量', iRowNo:'销售明细行号', SortSeq:'生产明细行号',
  OrderCode:'来源订单号', OrderSeq:'来源订单行号', SoCode:'销售订单号',
  dDate:'销售单据日期', dverifydate:'销售审核日期', dclosedate:'销售主单关闭日期', dbclosedate:'销售明细关闭日期',
  CreateDate:'生产主单创建日期', RelsDate:'生产订单审核日期', CloseDate:'生产明细关闭日期',
  cVerifier:'销售审核人', cCloser:'销售主单关闭人', cSCloser:'销售明细关闭人',
  RelsUser:'生产订单审核人', CloseUser:'生产明细关闭人',
  U8生产编号:'用友生产编号', u8生产编号:'用友生产编号', U8零件编号:'用友零件编号',
  BOM编号:'BOM编号',
  任务与u8生产编号:'任务登记的用友生产编号', u8id:'关联的用友生产主单系统内编号',
  u8autoid:'关联的用友生产明细系统内编号'
};
// Do not assign a business meaning to unconfirmed custom fields or state enums.
const exportOnlyFields = new Set(['AutoID','AuditStatus','status','BomId','SoDId','ExcelServerRCID','ExcelServerRN','ExcelServerCHG']);
export function fieldName(source, object, field) {
  if (exportOnlyFields.has(field)) return null;
  if (field==='ID') return source==='kfu' ? '转换记录系统内编号' : '销售主单系统内编号';
  if (field==='iSOsID') return '销售明细系统内编号';
  if (field==='MoId') return '生产主单系统内编号';
  if (field==='MoDId') return '生产明细系统内编号';
  if (field==='OrderDId') return '来源订单明细系统内编号';
  if (field==='OrderType') return '来源订单类型';
  if (field==='U8ID') return object==='dbo.SODetails' ? '关联的用友销售主单系统内编号' : '关联的用友生产主单系统内编号';
  if (field==='U8AUTOID') return object==='dbo.SODetails' ? '关联的用友销售明细系统内编号' : '关联的用友生产明细系统内编号';
  if (field==='Status'||field==='iStatus') return '单据状态';
  return fields[field] || (/^[\u3400-\u9fff0-9／（）]+$/.test(field) ? field : null);
}
export function fieldValue(field, value) {
  if (value===null||value===undefined||value==='') return value;
  if (field==='Status') return ({3:'已审核',4:'已关闭'})[value] || `状态名称待核实（原值：${value}）`;
  if (field==='iStatus') return String(value)==='1' ? '已审核' : `状态名称待核实（原值：${value}）`;
  if (field==='OrderType') return String(value)==='1' ? '销售订单' : `来源类型待核实（原值：${value}）`;
  return value;
}
const issueLabels = {
  'KFU生产父单引用不一致':'转换平台关联的生产订单主单不一致',
  'KFU销售父单引用不一致':'转换平台关联的销售订单主单不一致',
  'U8销售与KFU销售的生产编号原值不同':'用友与转换平台的销售生产编号不同',
  'U8与KFU生产的生产编号原值不同':'用友与转换平台的生产编号不同',
  'U8与KFU的质量编号原值不同':'用友与转换平台的质量编号不同',
  'U8与KFU的零件编号原值不同':'用友与转换平台的零件编号不同',
  'U8与勤哲接口的质量编号原值不同':'用友与勤哲生产订单接收记录的质量编号不同',
  'U8与勤哲工艺清单的质量编号原值不同':'用友与勤哲工艺清单的质量编号不同',
  'U8与勤哲任务的U8生产编号原值不同':'用友与勤哲任务登记的用友生产编号不同',
  'U8与勤哲的U8生产编号原值不同':'用友与勤哲登记的用友生产编号不同',
  '销售与生产的生产编号原值不同':'销售订单与生产订单的生产编号不同',
  '销售与生产的质量编号原值不同':'销售订单与生产订单的质量编号不同',
  '生产的销售订单号与明细引用不一致':'生产订单登记的销售订单号与关联销售明细不一致',
  '生产订单未确认已审核销售来源':'生产订单尚未对应到已审核销售订单',
  '勤哲任务销售来源与生产源引用冲突':'勤哲任务与用友生产订单对应的销售明细不同'
};
export function issueName(issue) {
  if (issueLabels[issue.label]) return issueLabels[issue.label];
  if (/^(销售|生产)生产编号(缺失|不是18位)$/.test(issue.label) || ['销售质量编号缺失','同一生产编号对应多条销售明细'].includes(issue.label)) return issue.label;
  return '核对问题（名称待核实，详见导出资料）';
}
export const queryText = value => Object.entries(issueLabels).find(([,label])=>label===value)?.[0] || value;
const comparisons = {
  '销售与生产的生产编号原值不同':['用友销售订单','用友生产订单'],
  '销售与生产的质量编号原值不同':['用友销售订单','用友生产订单'],
  'U8销售与KFU销售的生产编号原值不同':['用友销售订单','转换平台销售订单'],
  'U8与KFU生产的生产编号原值不同':['用友生产订单','转换平台生产订单'],
  'U8与KFU的质量编号原值不同':['用友生产订单','转换平台生产订单'],
  'U8与KFU的零件编号原值不同':['用友生产订单','转换平台生产订单'],
  'U8与勤哲接口的质量编号原值不同':['用友生产订单','勤哲生产订单接收记录'],
  'U8与勤哲工艺清单的质量编号原值不同':['用友生产订单','勤哲工艺清单'],
  'U8与勤哲任务的U8生产编号原值不同':['用友订单','勤哲任务'],
  'U8与勤哲的U8生产编号原值不同':['用友订单','勤哲表单']
};
export function issueValues(issue) {
  const values=issue.values || {};
  if (issue.code==='RAW_DIFFERENCE' && comparisons[issue.label]) return [[comparisons[issue.label][0],values.left],[comparisons[issue.label][1],values.right]];
  const names={value:'原填内容',length:'字符数',u8:'用友主单系统内编号',kfu:'转换平台登记的主单系统内编号',salesDetailIds:'销售明细系统内编号',referencedOrder:'关联销售明细所属订单号',recordedOrder:'生产订单登记的销售订单号',OrderType:'来源订单类型原值',OrderDId:'来源销售明细系统内编号',Define25:'生产编号',taskSalesDetailId:'勤哲任务对应的销售明细系统内编号',productionOrderDId:'生产订单对应的销售明细系统内编号'};
  return Object.entries(values).filter(([key])=>names[key]).map(([key,value])=>[names[key],value]);
}
export function businessText(value) {
  if (!value) return '';
  const replacements = [
    ['销售接口创建时间字段','销售转换记录创建时间'], ['生产接口创建日期字段','生产转换记录创建日期'],
    ['生产审核／释放日期字段','生产订单审核日期'],
    ['生产审核／释放字段','生产订单审核人'],
    ['OrderType=1且OrderDId指向销售iSOsID','生产订单来源为销售订单，并已关联销售明细'],
    ['333接口的U8AUTOID、U8ID、BOM编号三项源引用一致','账套333的转换记录中，关联生产明细、主单及生产订单表编号一致'],
    ['333任务范围与u8autoid、u8id源引用一致','账套333的任务范围与登记的用友生产明细、主单一致'],
    ['333任务本地生产编号引用＋销售来源下唯一U8零件编号','账套333的任务生产编号，加上同一销售订单下唯一的用友零件编号'],
    ['U8AUTOID可定位明细，父单引用仍需单独核对','已找到对应的用友订单明细，仍需核对其所属主单'],
    ['333账套及U8AUTOID明细引用','按账套333及登记的用友订单明细关联'],
    ['未找到333账套KFU生产明细引用','未找到对应的账套333转换平台生产明细'],
    ['同时保留任务、接口及U8引用证据','同时保留任务、转换平台和用友的关联资料'],
    ['源明细引用关联','按原单据登记的明细关联'], ['源引用','原单据关联'],
    ['引用冲突','关联不一致'], ['明细引用','明细关联'], ['明确引用','明确的单据关联'],
    ['不按相同编号猜并','不凭相同编号合并'], ['格式等价处理','格式换算'],
    ['手工字段等价规则待明确','手工填写内容的统一口径待确认'],
    ['直接复制字段原值比较','比较原填内容'], ['源端缺失','原单据未填写'],
    ['数据元等价关系','是否表示同一业务内容'], ['尚未确认销售来源','尚未确认对应的销售订单'],
    ['KFU8QZ','转换平台'], ['KFU','转换平台'], ['U8','用友'],
    ['原始快照','本次盘点保存的数据'], ['快照','盘点保存的数据'], ['源系统','用友、转换平台或勤哲'],
    ['底账','订单核对明细'], ['本批','本次盘点'], ['字段','内容项']
  ];
  let text=String(value);
  for (const [before,after] of replacements) text=text.replaceAll(before,after);
  return text;
}
export const batchState = status => ({running:'盘点中',succeeded:'已完成',failed:'盘点失败'})[status] || '状态待核实';
export const batchFailure = '读取、核对或保存未全部完成，本次没有可用结果。可重新盘点；如仍失败，请联系维护人员查看运行记录。';
