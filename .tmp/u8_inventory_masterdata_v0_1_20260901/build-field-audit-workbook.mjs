import fs from "node:fs/promises";
import {
  FileBlob,
  SpreadsheetFile,
  Workbook,
} from "file:///C:/Users/charl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const paths = {
  liveAudit: "E:/CA001/Infomat/.tmp/u8_inventory_masterdata_v0_1_20260901/live-audit.json",
  sourceWorkbook: "E:/CA001/Infomat/outputs/ca_inventory_export_20260831/Ca_Inventory_明细导出.xlsx",
  inventoryDdl: "C:/Users/charl/.codex/attachments/28d71746-52c1-41eb-95b1-2b6b3e003cbb/pasted-text.txt",
  inventorySubDdl: "C:/Users/charl/.codex/attachments/9b385d93-23ba-4c06-aead-5b4aa5da6dbd/pasted-text.txt",
  inventoryDescriptions: "C:/Users/charl/.codex/attachments/cad1d14e-0046-4e86-8d6e-20dafa2c718c/pasted-text.txt",
  outputDir: "E:/CA001/Infomat/outputs/u8_inventory_masterdata_v0_1_20260901",
  outputFile: "E:/CA001/Infomat/outputs/u8_inventory_masterdata_v0_1_20260901/用友U8存货档案字段级审核附表_V0.1.xlsx",
  previewDir: "E:/CA001/Infomat/.tmp/u8_inventory_masterdata_v0_1_20260901/previews",
};

const COLORS = {
  navy: "#1F4E78",
  blue: "#5B9BD5",
  lightBlue: "#D9EAF7",
  paleBlue: "#EDF4FA",
  gold: "#BF9000",
  paleGold: "#FFF2CC",
  red: "#C00000",
  paleRed: "#FCE4D6",
  green: "#548235",
  paleGreen: "#E2F0D9",
  gray: "#666666",
  paleGray: "#F2F2F2",
  border: "#C9D2DA",
  white: "#FFFFFF",
  black: "#1F1F1F",
};

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flatten(value) {
  if (!Array.isArray(value)) return value == null ? [] : [value];
  return value.flat(Infinity);
}

function distributionText(value) {
  const rows = flatten(value).filter((item) => item && typeof item === "object" && "value" in item);
  return rows.map((item) => `${String(item.value)}:${Number(item.row_count).toLocaleString("zh-CN")}`).join("；");
}

function asExcelText(value) {
  if (value == null || value === "") return "";
  return String(value);
}

function parseInventoryDescriptions(text) {
  const map = new Map();
  const pattern = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)(?:\s+\([^)]+\))?\s{2,}(.*?)\s{2,}(nvarchar|varchar|nchar|char|bit|tinyint|smallint|int|bigint|float|decimal|numeric|money|datetime|timestamp|uniqueidentifier)\s+/gm;
  for (const match of text.matchAll(pattern)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

function parseDdlDefaults(text, fields) {
  const map = new Map();
  for (const field of fields) {
    const blockPattern = new RegExp(
      `^\\s{4}${escapeRegex(field)}\\s+[\\s\\S]*?(?=^\\s{4}[A-Za-z_][A-Za-z0-9_]*\\s+|^\\)\\s*$)`,
      "m",
    );
    const block = text.match(blockPattern)?.[0] ?? "";
    const match = block.match(/\bdefault\s+((?:N?'[^']*'|[-+]?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?|\([^)]*\)))/i);
    if (match) map.set(field, match[1]);
  }
  return map;
}

function typeDisplay(column) {
  const type = String(column.data_type);
  if (["nvarchar", "varchar", "nchar", "char", "binary", "varbinary"].includes(type)) {
    return `${type}(${Number(column.declared_length) === -1 ? "max" : column.declared_length})`;
  }
  if (["decimal", "numeric"].includes(type)) {
    return `${type}(${column.precision},${column.scale})`;
  }
  return type;
}

function fieldKey(objectName, columnName) {
  return `${objectName}.${columnName}`;
}

const exactCategory = new Map([
  ["Inventory.cInvCode", ["稳定身份", "企业物料主键"]],
  ["Inventory_Sub.cInvSubCode", ["稳定身份", "扩展表关联键"]],
  ["Inventory.cInvCCode", ["内在分类", "当前U8分类引用"]],
  ["InventoryClass.cInvCCode", ["内在分类", "分类身份"]],
  ["InventoryClass.cInvCName", ["内在分类", "分类名称"]],
  ["InventoryClass.iInvCGrade", ["内在分类", "分类级次"]],
  ["InventoryClass.bInvCEnd", ["内在分类", "末级标志"]],
  ["Inventory.I_id", ["审计字段", "系统内部自增编号"]],
  ["Inventory.iId", ["历史兼容字段", "所属权限组；不是物料身份"]],
  ["Inventory.cInvDefine9", ["自定义字段", "历史自由文本标签"]],
  ["Inventory.iSupplyType", ["计划参数", "BOM子件供应/领用方式"]],
  ["Inventory.bPurchase", ["ERP功能开关", "外购能力"]],
  ["Inventory.bSelf", ["ERP功能开关", "自制能力"]],
  ["Inventory.bBomMain", ["ERP功能开关", "允许BOM母件"]],
  ["Inventory.bBomSub", ["ERP功能开关", "允许BOM子件"]],
  ["Inventory.bProductBill", ["ERP功能开关", "允许生产订单"]],
  ["Inventory.bSpecialOrder", ["ERP功能开关", "客户订单专用；不是客供"]],
  ["Inventory.bProxyForeign", ["ERP功能开关", "委外资格；不是实际来源"]],
  ["Inventory.cInvProjectCode", ["ERP功能开关", "售前ATP方案；不是项目适用性"]],
  ["Inventory.cCurrencyName", ["历史兼容字段", "药品通用名称"]],
  ["Inventory.iRecipeBatch", ["历史兼容字段", "处方/非处方药类别"]],
  ["Inventory.iInvBatch", ["计划参数", "经济批量"]],
  ["Inventory.iDrawBatch", ["计划参数", "领料批量"]],
  ["Inventory.iPFBatchQty", ["计划参数", "流转卡批量"]],
  ["Inventory.iBatchRule", ["计划参数", "批量规则"]],
  ["Inventory.fBatchIncrement", ["计划参数", "批量增量"]],
  ["Inventory.bCheckBatch", ["ERP功能开关", "批次核算；不是批次身份"]],
  ["Inventory.iBatchCounter", ["追溯控制", "批号累计计数候选"]],
  ["Inventory.cEngineerFigNo", ["名称规格", "工程图号引用"]],
  ["Inventory.cReplaceItem", ["历史兼容字段", "旧替换件文本"]],
  ["Inventory.dReplaceDate", ["历史兼容字段", "旧替换日期"]],
  ["Inventory.bMngOldpart", ["历史兼容字段", "旧件管理"]],
  ["Inventory.iOldpartMngRule", ["历史兼容字段", "旧件管理规则"]],
  ["Inventory_Sub.bInvKeyPart", ["质量控制", "关键件候选"]],
  ["Inventory_Sub.bPrjMat", ["ERP功能开关", "项目物料候选；不是用途关系"]],
  ["Inventory_Sub.fPrjMatLimit", ["ERP功能开关", "项目物料限额候选"]],
  ["Inventory_Sub.iBOMExpandUnitType", ["ERP功能开关", "BOM展开单位类型；不是BOM层级"]],
  ["Inventory_Sub.bBondedInv", ["ERP功能开关", "保税属性；不是所有权"]],
  ["Inventory_Sub.bImport", ["ERP功能开关", "进口属性；不是实际来源"]],
  ["Inventory_Sub.bProcessProduct", ["历史兼容字段", "正式语义待确认；不是PBOM/MBOM"]],
  ["Inventory_Sub.bProcessMaterial", ["历史兼容字段", "正式语义待确认；不是PBOM/MBOM"]],
  ["Inventory_Sub.bSCkeyProjections", ["历史兼容字段", "正式语义待确认"]],
  ["Inventory_Sub.iCalcStartingPoint", ["历史兼容字段", "正式计算口径待确认"]],
  ["Inventory_Sub.bX64", ["历史兼容字段", "版本兼容语义待确认"]],
]);

function classifyField(objectName, columnName) {
  const key = fieldKey(objectName, columnName);
  if (exactCategory.has(key)) return exactCategory.get(key);

  if (objectName === "InventoryClass") return ["内在分类", "当前U8分类属性"];
  if (/^(cInvDefine\d+|bFree\d+|bConfigFree\d+|bCheckFree\d+|bPurPriceFree\d+|bOMPriceFree\d+|bSalePriceFree\d+|bControlFreeRange\d+)$/.test(columnName)) {
    return ["自定义字段", "自由项、自定义值或控制开关"];
  }
  if (/^(cCreatePerson|cModifyPerson|dModifyDate|dInvCreateDatetime|cInvAppDocNo|pubufts|PictureGUID|bIsAttachFile)$/.test(columnName)) {
    return ["审计字段", "创建、修改、附件或行版本"];
  }
  if (/^(bImportMedicine|bFirstBusiMedicine|cRegisterNo|cEnterNo|cPreparationType|cNotPatentName|cLicence|cCommodity|bPromotSales|cRetailDefReturnWH|bSuitRetail|bCoupon|bStoreCard)$/.test(columnName)) {
    return ["历史兼容字段", "药品、零售或行业扩展"];
  }
  if (/(Serial|Track|BarCode|Expirat|Warranty|MassDate|WarnDays|BatchCreate|BatchProperty|Solitude|CheckOut)/i.test(columnName)) {
    return ["追溯控制", "批次、序列、保质期、条码或隔离"];
  }
  if (/(Quality|PropertyCheck|Test|DT|QT|AQL|CIQ|ROHS|Accept|RuleCode|InByProCheck|ReceiptByDT|InvKeyPart)/i.test(columnName)) {
    return ["质量控制", "检验、合规、接收或关键件"];
  }
  if (/(Plan|ROP|MPS|Supply|Advance|Subscribe|SafeNum|TopSum|LowSum|OverStock|OrderUpLimit|TfDay|Overlap|Sureness|TimeBucket|AvailabilityDate|MaterialsCycle|Frequency|Wastage|MinSplit|MaxSupply)/i.test(columnName)) {
    return ["计划参数", "补货、批量、提前期、供应或能力计划"];
  }
  if (/(InvName|InvStd|InvAddCode|MnemCode|EnglishName|PackingType|EngineerFigNo|Weight|Volume|GrossW|Length|Width|Height|ProduceAddress|ProduceNation|ProductUnit|MassUnit|ComUnit|AssComUnit|ShopUnit|WUnit|VUnit)/i.test(columnName)) {
    return ["名称规格", "名称、规格、计量或物理属性"];
  }
  if (/(Cost|Price|Tax|Rate|Expenses|Currency|ValueType|Exch)/i.test(columnName)) {
    return ["ERP功能开关", "计价、成本、税率或换算参数"];
  }
  return ["ERP功能开关", "U8业务资格、关系或运行参数"];
}

const specificDescriptions = new Map([
  ["Inventory.pubufts", "SQL Server行版本；用于变化识别，不是完整审计日志"],
  ["InventoryClass.cInvCCode", "存货分类编码"],
  ["InventoryClass.cInvCName", "存货分类名称"],
  ["InventoryClass.iInvCGrade", "分类级次"],
  ["InventoryClass.bInvCEnd", "是否末级分类"],
  ["InventoryClass.cEcoCode", "字段名提示为经济分类代码；正式含义待确认"],
  ["InventoryClass.cBarCode", "分类条码；当前全空"],
  ["InventoryClass.pubufts", "SQL Server行版本；不是完整变更历史"],
  ["Inventory_Sub.cInvSubCode", "Inventory_Sub扩展记录关联键；当前与cInvCode一一对齐，但DDL无外键"],
  ["Inventory_Sub.iRequireTrackStyle", "字段名提示为追踪方式；枚举值义待用友帮助确认"],
  ["Inventory_Sub.iExpiratDateCalcu", "字段名提示为失效日期计算方式；枚举值义待确认"],
  ["Inventory_Sub.iBOMExpandUnitType", "字段名提示为BOM展开单位类型；不是EBOM/PBOM/MBOM类型"],
  ["Inventory_Sub.bBondedInv", "字段名提示为保税存货属性；不是实际来源或所有权"],
  ["Inventory_Sub.bBatchCreate", "字段名提示为批次生成控制；不是实际批号"],
  ["Inventory_Sub.bInvKeyPart", "关键件控制候选；DDL默认1，当前全部为1"],
  ["Inventory_Sub.iAcceptEarlyDays", "提前接收天数候选；DDL默认999，默认值不等于业务批准"],
  ["Inventory_Sub.dInvCreateDatetime", "扩展记录创建时间；系统默认getdate()"],
  ["Inventory_Sub.cInvAppDocNo", "字段名提示为存货申请单号；正式来源关系待确认"],
  ["Inventory_Sub.bPrjMat", "项目物料候选；不能替代项目/用途多值关系"],
  ["Inventory_Sub.bImport", "进口属性候选；不能替代实际来源"],
]);

function fieldDescription(objectName, columnName, inventoryDescriptions) {
  const key = fieldKey(objectName, columnName);
  if (specificDescriptions.has(key)) return specificDescriptions.get(key);
  if (objectName === "Inventory" && inventoryDescriptions.has(columnName)) {
    return `${inventoryDescriptions.get(columnName)}（用户提供U8字段说明；结构以当前DDL为准）`;
  }
  if (objectName === "Inventory_Sub" && /^bBatchProperty\d+$/.test(columnName)) {
    return "批次属性启用开关；属性名称和值域未定义，正式语义待确认";
  }
  if (objectName === "Inventory_Sub") {
    return "用户材料未提供正式中文说明；仅有DDL字段名，语义和枚举待用友帮助或业务确认";
  }
  return "DDL字段；正式业务说明待确认";
}

function qualityJudgment(objectName, columnName, stat, defaultValue, column) {
  const emptyCount = Number(stat.total_count) - Number(stat.nonblank_count);
  const total = Number(stat.total_count);
  const key = fieldKey(objectName, columnName);

  const overrides = new Map([
    ["Inventory.cInvCode", "当前6,565条全部唯一、无空白；历史格式与新规范并存"],
    ["Inventory.cInvName", "当前无空白，但DDL允许空，未来漏填未被结构阻止"],
    ["Inventory.cInvStd", "当前4,356条未形成有效值；应按对象类型条件复核"],
    ["Inventory.cInvCCode", "当前无空白、无孤儿；DDL仍允许空，且分类维度混杂"],
    ["Inventory.cInvAddCode", "当前2,840条非空、2,798个不同值；不具备全局唯一性"],
    ["Inventory.cInvDefine9", "当前867条非空，其中865条含“客供”；仅为历史文本线索"],
    ["Inventory.iSupplyType", "当前6,565条全部为0；没有来源分类能力"],
    ["Inventory.bSerial", "当前6,565条全部为0；不能声称已建立单件序列追溯"],
    ["Inventory.bInvBatch", "当前3,281条为1；追溯适用性仍需按风险确认"],
    ["Inventory.bBomMain", "当前3,642条为1；只表示BOM母件资格"],
    ["Inventory.bBomSub", "当前6,560条为1；只表示BOM子件资格"],
    ["Inventory.bProductBill", "当前6,006条为1；只表示生产订单资格"],
    ["Inventory_Sub.cInvSubCode", "当前与Inventory 6,565比6,565完整对齐；DDL无外键"],
    ["Inventory_Sub.bInvKeyPart", "DDL默认1且当前6,565条全部为1；现值无区分能力"],
    ["Inventory_Sub.iAcceptEarlyDays", "当前仅999和0两值；999是DDL默认值，不能视为已批准接收规则"],
  ]);
  if (overrides.has(key)) return overrides.get(key);
  if (objectName === "Inventory_Sub" && /^bBatchProperty\d+$/.test(columnName)) {
    return "当前全部为0；批次属性尚未通过这些开关受控";
  }
  if (Number(stat.nonblank_count) === 0) return "当前全空；不等于字段可删除或业务不适用";
  if (Number(stat.distinct_nonblank_count) === 1 && defaultValue != null) {
    return `当前只有1个非空值且DDL默认值为${defaultValue}；不能视为人工确认`;
  }
  if (Number(stat.distinct_nonblank_count) === 1) return "当前只有1个非空值；区分能力有限";
  if (emptyCount > 0) return `当前${emptyCount.toLocaleString("zh-CN")}条未形成有效值；按适用性复核`;
  if (column.is_nullable) return "当前完整，但DDL允许空；业务必填性另行判断";
  return "结构非空且当前完整；仍需核对业务语义和值域";
}

function disposition(objectName, columnName, category, stat) {
  const key = fieldKey(objectName, columnName);
  const overrides = new Map([
    ["Inventory.cInvCode", "保留＋必填；发布后不变、不复用；历史码冻结并映射"],
    ["Inventory.cInvName", "保留＋必填；统一名称规则"],
    ["Inventory.cInvStd", "保留＋条件必填；按对象类型规定"],
    ["Inventory.cInvCCode", "保留历史＋必填＋建立企业技术分类映射；停止新增混合节点"],
    ["Inventory.cInvAddCode", "保留；如作为辅助码须定义唯一范围；不能替代别名关系"],
    ["Inventory.cInvDefine9", "保留历史；不再新增来源、所有权或用途权威语义；不自动迁移"],
    ["Inventory.bPurchase", "保留并按能力条件维护；不得判定实际自采/客供"],
    ["Inventory.bSelf", "保留并按能力条件维护；不得判定实际制造来源"],
    ["Inventory.iSupplyType", "条件启用＋受控字典；只管理BOM子件供应/领用方式"],
    ["Inventory.bInvBatch", "按风险条件启用；主档规则与实际批号分开"],
    ["Inventory.bSerial", "按单件追溯要求条件启用；启用前定义序列规则和历史处理"],
    ["Inventory.bBomMain", "保留资格开关；不得替代BOM身份、修订或发布基线"],
    ["Inventory.bBomSub", "保留资格开关；不得替代BOM行和来源映射"],
    ["Inventory.bProductBill", "保留资格开关；不得替代MBOM或生产执行事实"],
    ["Inventory.cReplaceItem", "保留历史；新的替代使用受控多对多关系"],
    ["Inventory.dReplaceDate", "保留历史；新的替代生效期进入受控替代关系"],
    ["Inventory_Sub.cInvSubCode", "保留为扩展关联键；持续对账；不得作为第二套物料身份"],
    ["Inventory_Sub.bInvKeyPart", "重新由工程和质量确认；默认1不得直接沿用为业务结论"],
    ["Inventory_Sub.iAcceptEarlyDays", "待确认999等值义；业务批准前不得把默认值当规则"],
  ]);
  if (overrides.has(key)) return overrides.get(key);
  if (objectName === "Inventory_Sub" && /^bBatchProperty\d+$/.test(columnName)) {
    return "条件启用；先定义批次属性名称、值域、责任和生效规则";
  }
  if (category === "稳定身份") return "保留；作为关联或身份字段受控";
  if (category === "内在分类") return "保留历史；建立企业技术分类映射；受控字典";
  if (category === "自定义字段") return "保留历史；无正式定义、值域和责任人时不再新增使用";
  if (category === "审计字段") return "保留；只作系统镜像或审计证据，不作为业务身份";
  if (category === "追溯控制" || category === "质量控制") return "按风险和业务条件启用；由质量及相关责任部门确认";
  if (category === "计划参数") return "条件启用；使用受控值域；默认值不代替业务确认";
  if (category === "历史兼容字段") return "保留历史；正式语义确认前不再新增使用";
  if (Number(stat.nonblank_count) === 0) return "保留兼容；无批准业务场景时不再新增使用；不得直接删除";
  return "保留并按适用业务场景维护；字段值域和责任需确认";
}

function requiredCandidate(objectName, columnName, category) {
  const key = fieldKey(objectName, columnName);
  if (["Inventory.cInvCode", "Inventory.cInvName", "Inventory.cInvCCode", "Inventory_Sub.cInvSubCode", "InventoryClass.cInvCCode", "InventoryClass.cInvCName", "InventoryClass.iInvCGrade"].includes(key)) return "必填";
  if (key === "Inventory.cInvStd") return "条件必填";
  if (category === "审计字段") return "系统生成/条件";
  if (["追溯控制", "质量控制", "计划参数"].includes(category)) return "条件必填";
  return "待业务确认";
}

function responsibility(category, subCategory, objectName, columnName) {
  const key = fieldKey(objectName, columnName);
  if (["Inventory.cInvCode", "Inventory.cInvName", "Inventory.cInvStd", "Inventory.cInvCCode", "Inventory.cEngineerFigNo"].includes(key) || category === "名称规格") {
    return "工程技术部提供/确认；MDM审核发布";
  }
  if (category === "内在分类") return "工程技术部确认技术类别；MDM维护字典与映射";
  if (category === "质量控制" || category === "追溯控制") return "质量管理部定义规则；工程技术部/物资保障部按场景参与；MDM发布";
  if (category === "计划参数") return "经营发展部、工程技术部或项目管理部按场景确认；MDM校验";
  if (category === "审计字段") return "U8系统自动生成或用友管理员维护技术配置";
  if (category === "自定义字段" || category === "历史兼容字段") return "原业务责任部门确认历史含义；MDM冻结语义";
  if (/成本|价格|税率|计价/.test(subCategory)) return "对应业务主管部门待确认；MDM只校验定义和值域";
  if (/仓库|货位|库存|收货/.test(subCategory) || /WareHouse|Position/.test(columnName)) return "物资保障部确认；用友管理员配置批准结果";
  return "对应业务主管部门待确认；MDM校验；用友管理员只执行批准结果";
}

function noteForField(objectName, columnName, stat, defaultValue) {
  const key = fieldKey(objectName, columnName);
  const notes = new Map([
    ["Inventory.cInvCode", "新编码格式仅适用于新物料；不批量改写现有6,565个编码"],
    ["Inventory.cInvDefine9", "865条含客供；与客供半成品分类410条重叠369条，不能相加作为事实"],
    ["Inventory.iSupplyType", "U8帮助：入库倒冲/工序倒冲/领用/虚拟件/直接供应；数值映射待确认"],
    ["Inventory.bSerial", "系统有字段不等于现有产品已经建立单件追溯"],
    ["Inventory_Sub.bInvKeyPart", "最新快照全部为1，且DDL默认1"],
    ["InventoryClass.cInvCCode", "Inventory外键存在但既有探查显示is_not_trusted=1；另有其他业务表引用"],
  ]);
  if (notes.has(key)) return notes.get(key);
  if (objectName === "Inventory_Sub" && /^bBatchProperty\d+$/.test(columnName)) return "当前全部为0；属性标签和值域待确认";
  if (defaultValue != null && Number(stat.distinct_nonblank_count) === 1) return "单一现值可能由DDL默认值产生";
  return "";
}

function evidenceLabel(objectName) {
  return objectName === "Inventory_Sub"
    ? "结构事实＋当前数据事实；字段语义多为待确认；处置为建议"
    : "结构事实＋当前数据事实；字段语义参考用户材料；处置为建议";
}

function applyTitle(sheet, rangeAddress, title) {
  const range = sheet.getRange(rangeAddress);
  range.merge();
  range.values = [[title]];
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size: 16, name: "Microsoft YaHei" },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  range.format.rowHeight = 30;
}

function applyHeader(range) {
  range.format = {
    fill: COLORS.blue,
    font: { bold: true, color: COLORS.white, name: "Microsoft YaHei" },
    verticalAlignment: "center",
    horizontalAlignment: "center",
    wrapText: true,
  };
  range.format.borders = { preset: "all", style: "thin", color: COLORS.border };
  range.format.rowHeight = 34;
}

function applyBody(range) {
  range.format = {
    font: { color: COLORS.black, size: 10, name: "Microsoft YaHei" },
    verticalAlignment: "top",
    wrapText: true,
  };
  range.format.borders = { preset: "all", style: "thin", color: COLORS.border };
}

function setWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) {
    sheet.getRange(`${column}:${column}`).format.columnWidth = width;
  }
}

function writeSectionHeader(sheet, row, startColumn, endColumn, text) {
  const range = sheet.getRange(`${startColumn}${row}:${endColumn}${row}`);
  range.merge();
  range.values = [[text]];
  range.format = {
    fill: COLORS.lightBlue,
    font: { bold: true, color: COLORS.navy, size: 11, name: "Microsoft YaHei" },
    verticalAlignment: "center",
  };
  range.format.borders = { preset: "all", style: "thin", color: COLORS.border };
}

const rawAudit = stripBom(await fs.readFile(paths.liveAudit, "utf8"));
const audit = JSON.parse(rawAudit);
const inventoryDdl = await fs.readFile(paths.inventoryDdl, "utf8");
const inventorySubDdl = await fs.readFile(paths.inventorySubDdl, "utf8");
const descriptionText = await fs.readFile(paths.inventoryDescriptions, "utf8");
const inventoryDescriptions = parseInventoryDescriptions(descriptionText);

const sourceBlob = await FileBlob.load(paths.sourceWorkbook);
const sourceWorkbook = await SpreadsheetFile.importXlsx(sourceBlob);
const sourceDataSheet = sourceWorkbook.worksheets.getItem("Ca_Inventory");
const sourceInfoSheet = sourceWorkbook.worksheets.getItem("导出说明");
const sourceData = sourceDataSheet.getUsedRange(true).values;
const sourceHeaders = sourceData[0].map((value) => String(value ?? ""));
const sourceRows = sourceData.slice(1);
const sourceInfo = sourceInfoSheet.getRange("A1:F31").values;

const labelIndex = sourceHeaders.indexOf("cInvDefine9");
const classNameIndex = sourceHeaders.indexOf("cInvCName");
let sourceCustomerLabel = 0;
let sourceCustomerClass = 0;
let sourceOverlap = 0;
for (const row of sourceRows) {
  const label = String(row[labelIndex] ?? "").includes("客供");
  const customerClass = String(row[classNameIndex] ?? "") === "客供半成品";
  if (label) sourceCustomerLabel += 1;
  if (customerClass) sourceCustomerClass += 1;
  if (label && customerClass) sourceOverlap += 1;
}

const physicalColumns = audit.columns.filter((column) => ["Inventory", "Inventory_Sub", "InventoryClass"].includes(column.object_name));
const viewColumns = audit.columns.filter((column) => column.object_name === "Ca_Inventory");
if (physicalColumns.length !== 378) throw new Error(`Expected 378 physical fields, got ${physicalColumns.length}`);
if (viewColumns.length !== 38) throw new Error(`Expected 38 Ca_Inventory fields, got ${viewColumns.length}`);
if (sourceHeaders.length !== 21 || sourceRows.length !== 6532) throw new Error("Excel snapshot scope no longer matches 21 fields / 6,532 rows");
if (sourceCustomerLabel !== 865 || sourceCustomerClass !== 410 || sourceOverlap !== 369) throw new Error("Excel customer-supply text counts do not match the frozen evidence");
if (Number(audit.start_snapshot.Inventory_rows) !== Number(audit.end_snapshot.Inventory_rows)) throw new Error("Inventory row count changed during profiling");
if (Number(audit.core_metrics.customer_supplied_text_no_batch_rows) !== 62 || audit.customer_supply_no_batch_review.length !== 62) throw new Error("Expected 62 customer-supply no-batch review rows");

const defaults = new Map();
for (const [field, value] of parseDdlDefaults(inventoryDdl, physicalColumns.filter((c) => c.object_name === "Inventory").map((c) => c.column_name))) defaults.set(fieldKey("Inventory", field), value);
for (const [field, value] of parseDdlDefaults(inventorySubDdl, physicalColumns.filter((c) => c.object_name === "Inventory_Sub").map((c) => c.column_name))) defaults.set(fieldKey("Inventory_Sub", field), value);

const statByField = new Map(audit.field_statistics.map((stat) => [fieldKey(stat.object_name, stat.column_name), stat]));
const indexByField = new Map();
for (const index of audit.indexes) {
  const key = fieldKey(index.object_name, index.column_name);
  if (!indexByField.has(key)) indexByField.set(key, []);
  const flags = [index.is_primary_key ? "PK" : "", index.is_unique ? "唯一" : "", index.is_included_column ? "包含列" : `键序${index.key_ordinal}`].filter(Boolean).join("/");
  indexByField.get(key).push(`${index.index_name}(${flags})`);
}

const relationByField = new Map();
for (const fk of audit.foreign_keys) {
  const parentKey = fieldKey(fk.parent_object, fk.parent_column);
  const referencedKey = fieldKey(fk.referenced_object, fk.referenced_column);
  if (!relationByField.has(parentKey)) relationByField.set(parentKey, []);
  if (!relationByField.has(referencedKey)) relationByField.set(referencedKey, []);
  relationByField.get(parentKey).push(`${fk.foreign_key_name} → ${fk.referenced_object}.${fk.referenced_column}${fk.is_not_trusted ? "；未受信" : ""}`);
  relationByField.get(referencedKey).push(`${fk.foreign_key_name} ← ${fk.parent_object}.${fk.parent_column}${fk.is_not_trusted ? "；未受信" : ""}`);
}

const tableOrder = new Map([["Inventory", 1], ["Inventory_Sub", 2], ["InventoryClass", 3]]);
physicalColumns.sort((a, b) => tableOrder.get(a.object_name) - tableOrder.get(b.object_name) || Number(a.column_id) - Number(b.column_id));

const fieldHeaders = [
  "序号", "表名", "字段序号", "字段名", "数据类型", "允许空", "默认约束", "默认值",
  "主键/唯一/索引", "外键/引用", "总行数", "非空非空白数", "使用率", "NULL数", "空白字符串数",
  "空值率", "不同非空值数", "低基数值分布", "字段说明/依据", "结论等级", "一级类别", "业务子类",
  "当前质量判断", "处置建议", "业务必填候选", "维护责任候选", "待确认/备注",
];

const fieldRows = physicalColumns.map((column, index) => {
  const key = fieldKey(column.object_name, column.column_name);
  const stat = statByField.get(key);
  if (!stat) throw new Error(`Missing field statistics for ${key}`);
  const defaultValue = defaults.has(key) ? defaults.get(key) : null;
  const [category, subCategory] = classifyField(column.object_name, column.column_name);
  return [
    index + 1,
    column.object_name,
    Number(column.column_id),
    column.column_name,
    typeDisplay(column),
    column.is_nullable ? "是" : "否",
    column.default_constraint_name ?? "",
    defaultValue ?? "",
    (indexByField.get(key) ?? []).join("；"),
    (relationByField.get(key) ?? []).join("；") || "未发现已声明字段级外键",
    Number(stat.total_count),
    Number(stat.nonblank_count),
    null,
    Number(stat.null_count),
    Number(stat.blank_count),
    null,
    Number(stat.distinct_nonblank_count),
    distributionText(stat.low_cardinality_distribution),
    fieldDescription(column.object_name, column.column_name, inventoryDescriptions),
    evidenceLabel(column.object_name),
    category,
    subCategory,
    qualityJudgment(column.object_name, column.column_name, stat, defaultValue, column),
    disposition(column.object_name, column.column_name, category, stat),
    requiredCandidate(column.object_name, column.column_name, category),
    responsibility(category, subCategory, column.object_name, column.column_name),
    noteForField(column.object_name, column.column_name, stat, defaultValue),
  ];
});

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("审核说明");
const fieldSheet = workbook.worksheets.add("字段审核总表");
const mappingSheet = workbook.worksheets.add("Ca导出映射");
const reviewSheet = workbook.worksheets.add("客供未批次复核");
const classSheet = workbook.worksheets.add("分类现状");
const evidenceSheet = workbook.worksheets.add("证据与指标");

for (const sheet of workbook.worksheets.items) {
  sheet.showGridLines = false;
}

// 审核说明
summarySheet.getRange("A1:H31").format.fill = COLORS.white;
applyTitle(summarySheet, "A1:H1", "用友U8存货档案字段级审核附表 V0.1");
summarySheet.getRange("A2:H2").merge();
summarySheet.getRange("A2:H2").values = [["状态：评审稿｜只读快照：2026-09-01 10:54:54—10:55:26｜未修改数据库或用友配置｜不代表业务验收"]];
summarySheet.getRange("A2:H2").format = { fill: COLORS.paleGold, font: { bold: true, color: COLORS.gold, name: "Microsoft YaHei" }, wrapText: true };

writeSectionHeader(summarySheet, 4, "A", "H", "一、核心结论");
const conclusionRows = [
  ["结论", "说明", "证据等级", "状态"],
  ["稳定编码不增加语义数位", "新编码使用<域>-<对象>-<8位流水>；用途、来源、所有权、项目、仓库和BOM层级均不入码", "治理建议", "待部门评审"],
  ["最新核心对象为6,565/6,565/146", "Inventory与Inventory_Sub当前一一对齐；Inventory_Sub没有数据库外键", "当前数据事实＋结构事实", "已核对"],
  ["客供文本线索865条，未批次62条", "62条进入人工复核，不自动启用批次；文本不等于实际来源或所有权", "当前数据事实＋分析判断", "待业务复核"],
  ["现有分类维度混杂", "保留U8分类，另建企业技术分类及映射；停止新增项目、用途、来源类节点", "当前数据事实＋治理建议", "待部门评审"],
  ["BOM开关不是三类BOM基线", "bBomMain/bBomSub/bProductBill只表示资格；EBOM/PBOM/MBOM需独立身份、修订、发布和映射", "结构事实＋治理建议", "待系统设计"],
];
summarySheet.getRangeByIndexes(4, 0, conclusionRows.length, conclusionRows[0].length).values = conclusionRows;
applyHeader(summarySheet.getRange("A5:D5"));
applyBody(summarySheet.getRange(`A6:D${4 + conclusionRows.length}`));

writeSectionHeader(summarySheet, 12, "A", "H", "二、覆盖与公式核对");
const coverageRows = [
  ["指标", "数值", "口径", "核对"],
  ["物理字段总数", null, "Inventory 257＋Inventory_Sub 114＋InventoryClass 7", "应为378"],
  ["当前全空字段", null, "非空非空白数为0；不代表可以删除", "公式统计"],
  ["当前单一取值字段", null, "不同非空值数为1；默认值不代表人工确认", "公式统计"],
  ["Ca_Inventory字段", 38, "视图字段；另表映射", "已核对"],
  ["Excel保留字段", 21, "2026-08-31冻结快照", "已核对"],
  ["Excel省略字段", 17, "不代表9月1日仍为空", "已核对"],
  ["客供未批次复核行", 62, "cInvDefine9含客供且bInvBatch=0", "已核对"],
];
summarySheet.getRangeByIndexes(12, 0, coverageRows.length, coverageRows[0].length).values = coverageRows;
summarySheet.getRange("B14").formulas = [["=COUNTA('字段审核总表'!$D$2:$D$379)"]];
summarySheet.getRange("B15").formulas = [["=COUNTIF('字段审核总表'!$L$2:$L$379,0)"]];
summarySheet.getRange("B16").formulas = [["=COUNTIF('字段审核总表'!$Q$2:$Q$379,1)"]];
applyHeader(summarySheet.getRange("A13:D13"));
applyBody(summarySheet.getRange("A14:D20"));

writeSectionHeader(summarySheet, 22, "A", "H", "三、使用说明与红线");
const instructionRows = [
  ["事项", "说明"],
  ["字段事实", "类型、长度、空值、约束和统计来自当前DDL/元数据及只读SELECT；默认值从用户提供DDL解析。"],
  ["字段语义", "Inventory优先引用用户提供的U8字段说明；Inventory_Sub未取得正式中文字段字典时保持待确认。"],
  ["处置建议", "保留、必填、受控字典、条件启用、只作镜像、保留历史、不再新增使用和待确认均为V0.1候选。"],
  ["数据库红线", "本次没有执行INSERT、UPDATE、DELETE、MERGE、SELECT INTO、DDL、权限变更、存储过程或临时表落数。"],
  ["业务边界", "自动统计不能替代工程、项目、经营、物资、质量和MDM工作组确认。"],
  ["时间边界", "Excel 6,532条、早间报告6,533条、最新快照6,565条分别对应不同时间点；差异原因未确认。"],
];
summarySheet.getRangeByIndexes(22, 0, instructionRows.length, instructionRows[0].length).values = instructionRows;
applyHeader(summarySheet.getRange("A23:B23"));
applyBody(summarySheet.getRange(`A24:B${22 + instructionRows.length}`));
summarySheet.freezePanes.freezeRows(2);
setWidths(summarySheet, { A: 24, B: 78, C: 30, D: 22, E: 2, F: 2, G: 2, H: 2 });
summarySheet.getRange("A1:H31").format.rowHeight = 22;
summarySheet.getRange("A1:H1").format.rowHeight = 30;

// 字段审核总表
fieldSheet.getRangeByIndexes(0, 0, 1, fieldHeaders.length).values = [fieldHeaders];
fieldSheet.getRangeByIndexes(1, 0, fieldRows.length, fieldHeaders.length).values = fieldRows;
fieldSheet.getRange("M2").formulas = [["=IF(K2=0,0,L2/K2)"]];
fieldSheet.getRange(`M2:M${fieldRows.length + 1}`).fillDown();
fieldSheet.getRange("P2").formulas = [["=IF(K2=0,0,(N2+O2)/K2)"]];
fieldSheet.getRange(`P2:P${fieldRows.length + 1}`).fillDown();
fieldSheet.getRange(`M2:M${fieldRows.length + 1}`).format.numberFormat = "0.00%";
fieldSheet.getRange(`P2:P${fieldRows.length + 1}`).format.numberFormat = "0.00%";
applyHeader(fieldSheet.getRange("A1:AA1"));
applyBody(fieldSheet.getRange(`A2:AA${fieldRows.length + 1}`));
fieldSheet.getRange(`A2:AA${fieldRows.length + 1}`).format.rowHeight = 42;
fieldSheet.freezePanes.freezeRows(1);
fieldSheet.freezePanes.freezeColumns(4);
setWidths(fieldSheet, {
  A: 7, B: 18, C: 9, D: 25, E: 16, F: 9, G: 28, H: 13, I: 38, J: 42,
  K: 12, L: 15, M: 11, N: 11, O: 13, P: 11, Q: 15, R: 38, S: 48, T: 34,
  U: 17, V: 30, W: 48, X: 54, Y: 15, Z: 52, AA: 48,
});
fieldSheet.getRange(`A2:AA${fieldRows.length + 1}`).conditionalFormats.add("containsText", { text: "当前全空", format: { fill: COLORS.paleGray, font: { color: COLORS.gray } } });
fieldSheet.getRange(`A2:AA${fieldRows.length + 1}`).conditionalFormats.add("containsText", { text: "无区分能力", format: { fill: COLORS.paleGold, font: { color: COLORS.gold } } });
fieldSheet.getRange(`A2:AA${fieldRows.length + 1}`).conditionalFormats.add("containsText", { text: "禁止", format: { fill: COLORS.paleRed, font: { color: COLORS.red, bold: true } } });

// Ca导出映射
const caHeaders = ["视图序号", "Ca_Inventory字段", "视图类型", "视图允许空", "2026-08-31是否导出", "Excel列序", "Excel数据行数", "导出范围说明", "与主档关系边界", "字段类别", "审核处置", "证据等级"];
const caRows = viewColumns.map((column) => {
  const exportIndex = sourceHeaders.indexOf(column.column_name);
  const [category] = classifyField("Inventory", column.column_name);
  return [
    Number(column.column_id),
    column.column_name,
    typeDisplay(column),
    column.is_nullable ? "是" : "否",
    exportIndex >= 0 ? "是" : "否",
    exportIndex >= 0 ? exportIndex + 1 : "",
    sourceRows.length,
    exportIndex >= 0 ? "导出说明标记为至少存在一条非空值" : "冻结文件未导出；不能据此判断9月1日仍为空或字段可删除",
    column.column_name === "cInvCode" ? "当前与Inventory键值全量对齐；视图定义不可读，物理依赖仍待确认" : "字段同名或当前值对齐不等于已证明物理来源",
    category,
    /^Free\d+$|^cInvDefine/.test(column.column_name) ? "保留历史；无定义时不新增权威语义" : "用于查询投影；企业主数据权威性需回到源对象确认",
    "视图结构事实＋冻结快照事实；来源关系部分待确认",
  ];
});
mappingSheet.getRangeByIndexes(0, 0, 1, caHeaders.length).values = [caHeaders];
mappingSheet.getRangeByIndexes(1, 0, caRows.length, caHeaders.length).values = caRows;
applyHeader(mappingSheet.getRange("A1:L1"));
applyBody(mappingSheet.getRange(`A2:L${caRows.length + 1}`));
mappingSheet.freezePanes.freezeRows(1);
mappingSheet.freezePanes.freezeColumns(2);
setWidths(mappingSheet, { A: 10, B: 23, C: 16, D: 12, E: 19, F: 11, G: 14, H: 44, I: 48, J: 18, K: 45, L: 36 });
mappingSheet.getRange(`A2:L${caRows.length + 1}`).format.rowHeight = 42;
mappingSheet.getRange(`E2:E${caRows.length + 1}`).conditionalFormats.add("containsText", { text: "否", format: { fill: COLORS.paleGold, font: { color: COLORS.gold } } });

// 客供未批次复核
const reviewHeaders = ["序号", "cInvCode", "cInvName", "cInvStd", "cInvCCode", "cInvCName", "cInvDefine9原值", "bInvBatch", "bSerial", "bPurchase", "bSelf", "cEngineerFigNo", "复核结论", "复核依据", "责任人", "复核日期"];
const reviewRows = audit.customer_supply_no_batch_review.map((row, index) => [
  index + 1,
  asExcelText(row.cInvCode),
  row.cInvName ?? "",
  row.cInvStd ?? "",
  asExcelText(row.cInvCCode),
  row.cInvCName ?? "",
  row.cInvDefine9 ?? "",
  Number(row.bInvBatch),
  Number(row.bSerial),
  Number(row.bPurchase),
  Number(row.bSelf),
  asExcelText(row.cEngineerFigNo),
  "",
  "",
  "",
  null,
]);
reviewSheet.getRangeByIndexes(0, 0, 1, reviewHeaders.length).values = [reviewHeaders];
reviewSheet.getRangeByIndexes(1, 0, reviewRows.length, reviewHeaders.length).values = reviewRows;
applyHeader(reviewSheet.getRange("A1:P1"));
applyBody(reviewSheet.getRange(`A2:P${reviewRows.length + 1}`));
reviewSheet.getRange(`M2:M${reviewRows.length + 1}`).dataValidation = { rule: { type: "list", values: ["需启用批次", "批次不适用", "原标签错误", "资料不足", "其他"] } };
reviewSheet.getRange(`P2:P${reviewRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
reviewSheet.getRange(`B2:B${reviewRows.length + 1}`).format.numberFormat = "@";
reviewSheet.getRange(`E2:E${reviewRows.length + 1}`).format.numberFormat = "@";
reviewSheet.getRange(`L2:L${reviewRows.length + 1}`).format.numberFormat = "@";
reviewSheet.freezePanes.freezeRows(1);
reviewSheet.freezePanes.freezeColumns(2);
setWidths(reviewSheet, { A: 7, B: 24, C: 34, D: 32, E: 14, F: 26, G: 24, H: 12, I: 10, J: 11, K: 10, L: 22, M: 18, N: 46, O: 16, P: 16 });
reviewSheet.getRange(`A2:P${reviewRows.length + 1}`).format.rowHeight = 38;
reviewSheet.getRange(`M2:P${reviewRows.length + 1}`).format.fill = COLORS.paleGold;

// 分类现状
function classAssessment(row) {
  const code = String(row.cInvCCode);
  const name = String(row.cInvCName ?? "");
  if (["98", "99"].includes(code) || /研制|批产|任务/.test(name)) return "项目阶段/任务维度混入分类";
  if (code === "0399" || /客供/.test(name)) return "来源或所有权线索混入分类";
  if (/试验|项目|鸟撞/.test(name)) return "项目或试验用途混入分类";
  if (/自制|外购/.test(name)) return "制造/采购方式可能混入分类；需结合技术类别复核";
  return "未发现明显项目/用途/来源词；仍需技术类别确认";
}
const classHeaders = ["分类编码", "分类名称", "级次", "末级", "关联存货数", "客供文本数", "批次启用数", "维度审核", "企业技术分类映射", "复核状态", "复核依据", "责任人", "复核日期"];
const classRows = audit.inventory_classes.map((row) => [
  asExcelText(row.cInvCCode),
  row.cInvCName ?? "",
  Number(row.iInvCGrade),
  row.bInvCEnd ? "是" : "否",
  Number(row.inventory_rows),
  Number(row.customer_supplied_text_rows),
  Number(row.batch_enabled_rows),
  classAssessment(row),
  "",
  "未复核",
  "",
  "",
  null,
]);
classSheet.getRangeByIndexes(0, 0, 1, classHeaders.length).values = [classHeaders];
classSheet.getRangeByIndexes(1, 0, classRows.length, classHeaders.length).values = classRows;
applyHeader(classSheet.getRange("A1:M1"));
applyBody(classSheet.getRange(`A2:M${classRows.length + 1}`));
classSheet.getRange(`J2:J${classRows.length + 1}`).dataValidation = { rule: { type: "list", values: ["未复核", "已映射", "不适用", "需拆分", "资料不足"] } };
classSheet.getRange(`M2:M${classRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
classSheet.getRange(`A2:A${classRows.length + 1}`).format.numberFormat = "@";
classSheet.freezePanes.freezeRows(1);
classSheet.freezePanes.freezeColumns(2);
setWidths(classSheet, { A: 14, B: 34, C: 9, D: 9, E: 14, F: 13, G: 13, H: 48, I: 34, J: 16, K: 46, L: 16, M: 16 });
classSheet.getRange(`A2:M${classRows.length + 1}`).format.rowHeight = 38;
classSheet.getRange(`H2:H${classRows.length + 1}`).conditionalFormats.add("containsText", { text: "混入", format: { fill: COLORS.paleRed, font: { color: COLORS.red, bold: true } } });
classSheet.getRange(`I2:M${classRows.length + 1}`).format.fill = COLORS.paleGold;

// 证据与指标
evidenceSheet.getRange("A1:H50").format.fill = COLORS.white;
applyTitle(evidenceSheet, "A1:H1", "证据、时间点和主要统计");
writeSectionHeader(evidenceSheet, 3, "A", "H", "一、时间点");
const timelineRows = [
  ["时间点", "对象", "数量", "证据", "结论边界"],
  ["2026-08-31 16:09:09", "Ca_Inventory Excel", 6532, "冻结快照", "21字段；不代表9月1日实时状态"],
  ["2026-09-01 08:57:55", "Inventory/Ca_Inventory", 6533, "既有只读探查报告", "较早同日快照"],
  [audit.start_snapshot.database_time, "Inventory", Number(audit.start_snapshot.Inventory_rows), "本次只读SELECT开始", "与结束数量一致"],
  [audit.end_snapshot.database_time, "Inventory", Number(audit.end_snapshot.Inventory_rows), "本次只读SELECT结束", "本报告最新快照"],
];
evidenceSheet.getRangeByIndexes(3, 0, timelineRows.length, timelineRows[0].length).values = timelineRows;
applyHeader(evidenceSheet.getRange("A4:E4"));
applyBody(evidenceSheet.getRange("A5:E8"));

writeSectionHeader(evidenceSheet, 10, "A", "H", "二、核心指标");
const metricRows = [
  ["指标", "数值", "说明"],
  ["Inventory", Number(audit.start_snapshot.Inventory_rows), "257字段"],
  ["Inventory_Sub", Number(audit.start_snapshot.Inventory_Sub_rows), "114字段；当前全量对齐，无外键"],
  ["InventoryClass", Number(audit.start_snapshot.InventoryClass_rows), "7字段；146个分类"],
  ["Ca_Inventory", Number(audit.start_snapshot.Ca_Inventory_rows), "38字段视图"],
  ["cInvDefine9含客供", Number(audit.core_metrics.customer_supplied_text_rows), "文本线索，不是实际来源"],
  ["含客供且未批次", Number(audit.core_metrics.customer_supplied_text_no_batch_rows), "人工复核，不自动修改"],
  ["bSerial=1", Number(audit.core_metrics.bSerial_1), "不能声称现有单件序列追溯"],
  ["bInvKeyPart=1", Number(audit.inventory_sub_metrics.bInvKeyPart_1), "DDL默认1；无区分能力"],
  ["cInvStd未形成有效值", Number(audit.core_metrics.blank_cInvStd), "按对象类型条件复核"],
];
evidenceSheet.getRangeByIndexes(10, 0, metricRows.length, metricRows[0].length).values = metricRows;
applyHeader(evidenceSheet.getRange("A11:C11"));
applyBody(evidenceSheet.getRange("A12:C20"));

writeSectionHeader(evidenceSheet, 22, "A", "H", "三、编码质量");
const codeMetricRows = [
  ["检查", "数量", "解释"],
  ["总数/不同码", `${audit.code_quality.total_rows}/${audit.code_quality.distinct_codes}`, "主键唯一"],
  ["最短/最长/平均长度", `${audit.code_quality.min_code_length}/${audit.code_quality.max_code_length}/${Number(audit.code_quality.avg_code_length).toFixed(2)}`, "现有nvarchar(60)足够"],
  ["小写字母", Number(audit.code_quality.code_lowercase_rows), "历史码与新规范差异；不批量改写"],
  ["新字符集外字符", Number(audit.code_quality.code_outside_new_charset_rows), "历史码与新规范差异；通过别名映射"],
  ["连续连字符", Number(audit.code_quality.code_double_hyphen_rows), "历史格式复核候选"],
  ["重复名称组/涉及行", `${audit.code_quality.duplicate_name_groups}/${audit.code_quality.duplicate_name_rows}`, "仅作身份复核候选，不能自动合并"],
  ["名称+规格重复组/涉及行", `${audit.code_quality.duplicate_name_std_groups}/${audit.code_quality.duplicate_name_std_rows}`, "需要形状、配合、功能和互换性判断"],
];
evidenceSheet.getRangeByIndexes(22, 0, codeMetricRows.length, codeMetricRows[0].length).values = codeMetricRows;
applyHeader(evidenceSheet.getRange("A23:C23"));
applyBody(evidenceSheet.getRange("A24:C30"));

writeSectionHeader(evidenceSheet, 32, "A", "H", "四、一级分类分布");
const rootRows = [["分类编码", "分类名称", "存货数", "自制=1", "外购=1", "客供文本", "批次启用"]];
for (const row of audit.root_class_distribution) {
  rootRows.push([
    asExcelText(row.cInvCCode),
    row.cInvCName,
    Number(row.inventory_rows),
    Number(row.self_rows),
    Number(row.purchase_rows),
    Number(row.customer_supplied_text_rows),
    Number(row.batch_enabled_rows),
  ]);
}
evidenceSheet.getRangeByIndexes(32, 0, rootRows.length, rootRows[0].length).values = rootRows;
applyHeader(evidenceSheet.getRange("A33:G33"));
applyBody(evidenceSheet.getRange(`A34:G${32 + rootRows.length}`));

writeSectionHeader(evidenceSheet, 42, "A", "H", "五、只读边界和证据限制");
const boundaryRows = [
  ["边界", "说明"],
  ["数据库操作", audit.extraction_method],
  ["视图定义", "当前账号不能读取Ca_Inventory定义；字段同名和数据对齐不自动证明物理来源。"],
  ["Inventory_Sub字段语义", "用户材料未提供正式中文字段字典；英文名解释保持分析判断或待确认。"],
  ["业务验收", "数据库统计和自动化检查不等于六类部门业务验收。"],
  ["交易追溯", "采购、收货、库存批次、生产订单、实耗、实装和质量记录表族未纳入本次审核。"],
];
evidenceSheet.getRangeByIndexes(42, 0, boundaryRows.length, boundaryRows[0].length).values = boundaryRows;
applyHeader(evidenceSheet.getRange("A43:B43"));
applyBody(evidenceSheet.getRange("A44:B48"));
evidenceSheet.freezePanes.freezeRows(1);
setWidths(evidenceSheet, { A: 28, B: 32, C: 70, D: 28, E: 50, F: 18, G: 18, H: 4 });
evidenceSheet.getRange("A1:H50").format.rowHeight = 23;
evidenceSheet.getRange("A1:H1").format.rowHeight = 30;
evidenceSheet.getRange(`A34:A${32 + rootRows.length}`).format.numberFormat = "@";

// Export and verify.
await fs.mkdir(paths.outputDir, { recursive: true });
await fs.mkdir(paths.previewDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(paths.outputFile);

const renderTargets = [
  ["审核说明", "A1:H31"],
  ["字段审核总表", "A1:AA30"],
  ["Ca导出映射", "A1:L39"],
  ["客供未批次复核", "A1:P25"],
  ["分类现状", "A1:M30"],
  ["证据与指标", "A1:H48"],
];
for (const [sheetName, range] of renderTargets) {
  const preview = await workbook.render({ sheetName, range, format: "png", scale: 0.8, headers: true });
  await fs.writeFile(`${paths.previewDir}/${sheetName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const inspection = await workbook.inspect({
  kind: "workbook,sheet",
  include: "id,name",
  maxChars: 6000,
});

let formulaErrors = [];
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  if (!used) continue;
  for (let rowIndex = 0; rowIndex < used.values.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < used.values[rowIndex].length; columnIndex += 1) {
      const value = used.values[rowIndex][columnIndex];
      if (typeof value === "string" && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(value)) {
        formulaErrors.push({ sheet: sheet.name, row: rowIndex + 1, column: columnIndex + 1, value });
      }
    }
  }
}

const parsedDefaultCount = defaults.size;
const constrainedWithoutParsedDefault = physicalColumns
  .filter((column) => column.default_constraint_name && !defaults.has(fieldKey(column.object_name, column.column_name)))
  .map((column) => fieldKey(column.object_name, column.column_name));

console.log(JSON.stringify({
  outputFile: paths.outputFile,
  sheets: workbook.worksheets.items.map((sheet) => ({ name: sheet.name, usedRange: sheet.getUsedRange(true)?.address ?? null })),
  physicalFieldRows: fieldRows.length,
  caMappingRows: caRows.length,
  reviewRows: reviewRows.length,
  classRows: classRows.length,
  inventoryDescriptionCount: inventoryDescriptions.size,
  parsedDefaultCount,
  constrainedWithoutParsedDefault,
  sourceChecks: {
    rows: sourceRows.length,
    fields: sourceHeaders.length,
    customerLabel: sourceCustomerLabel,
    customerClass: sourceCustomerClass,
    overlap: sourceOverlap,
  },
  formulaErrors,
  inspect: inspection?.ndjson ?? String(inspection),
}, null, 2));
