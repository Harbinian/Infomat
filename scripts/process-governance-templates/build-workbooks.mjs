/**
 * Create one process-governance workbook per department with @oai/artifact-tool.
 *
 * Run this file from a temporary working directory that has a node_modules
 * junction to the Codex workspace dependency bundle. The normalized JSON input
 * is produced by build-template-data.mjs.
 */

import fs from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const COLORS = {
  brown: '#704B3A',
  brown2: '#8A624B',
  beige: '#F4EDE3',
  beige2: '#FAF7F2',
  sage: '#DDE8DF',
  sageDark: '#55705B',
  mist: '#E5EDF2',
  gold: '#D6B56A',
  goldLight: '#FFF4CC',
  ink: '#2F2A27',
  muted: '#706A65',
  line: '#D7CEC4',
  red: '#9B1C1C',
  redFill: '#FDECEC',
  amber: '#8A5A00',
  amberFill: '#FFF1CC',
  green: '#2F6B3D',
  greenFill: '#E7F4E9',
  white: '#FFFFFF',
  source: '#E9EEF1',
  editable: '#FFF7D6',
  formula: '#E8F0F7',
};

const SHEETS = [
  '00_填写说明',
  '01_流程总览',
  '02_业务行为',
  '03_数据字典',
  '04_证据索引',
  '05_完整性检查',
  '98_下拉选项',
  '99_来源快照',
];

function parseArgs(argv) {
  const args = { data: '', output: '', qa: '', dept: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--data') args.data = resolve(argv[++index] || '');
    else if (key === '--output') args.output = resolve(argv[++index] || '');
    else if (key === '--qa') args.qa = resolve(argv[++index] || '');
    else if (key === '--dept') args.dept = argv[++index] || '';
  }
  if (!args.data || !args.output || !args.qa) {
    throw new Error('Usage: node build-workbooks.mjs --data <json> --output <dir> --qa <dir> [--dept <name>]');
  }
  return args;
}

function excelColumn(index) {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function splitPrimaryAndOthers(value) {
  const values = String(value || '').split('；').map(item => item.trim()).filter(Boolean);
  return { primary: values[0] || '未提供制度原文（待部门补证）', others: values.slice(1).join('；') };
}

function matrixRange(sheet, startRow, startColumn, matrix) {
  if (matrix.length === 0 || matrix[0].length === 0) return null;
  const range = sheet.getRangeByIndexes(startRow - 1, startColumn - 1, matrix.length, matrix[0].length);
  range.values = matrix;
  return range;
}

function styleTitle(sheet, title, subtitle, lastColumn) {
  const last = excelColumn(lastColumn);
  sheet.mergeCells(`A1:${last}1`);
  sheet.getRange('A1').values = [[title]];
  sheet.getRange(`A1:${last}1`).format = {
    fill: COLORS.brown,
    font: { bold: true, color: COLORS.white, size: 16 },
    horizontalAlignment: 'left',
    verticalAlignment: 'center',
  };
  sheet.getRange(`A1:${last}1`).format.rowHeight = 32;
  sheet.mergeCells(`A2:${last}2`);
  sheet.getRange('A2').values = [[subtitle]];
  sheet.getRange(`A2:${last}2`).format = {
    fill: COLORS.beige,
    font: { color: COLORS.muted, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
  };
  sheet.getRange(`A2:${last}2`).format.rowHeight = 34;
}

function styleTableHeader(sheet, headerRow, lastColumn) {
  const last = excelColumn(lastColumn);
  sheet.getRange(`A${headerRow}:${last}${headerRow}`).format = {
    fill: COLORS.brown2,
    font: { bold: true, color: COLORS.white, size: 10 },
    wrapText: true,
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    borders: { preset: 'all', style: 'thin', color: COLORS.line },
  };
  sheet.getRange(`A${headerRow}:${last}${headerRow}`).format.rowHeight = 42;
}

function setWidths(sheet, widths, lastRow) {
  widths.forEach((width, index) => {
    const column = excelColumn(index + 1);
    sheet.getRange(`${column}1:${column}${lastRow}`).format.columnWidth = width;
  });
}

function addTable(sheet, name, headerRow, dataRows, columnCount) {
  const lastColumn = excelColumn(columnCount);
  const lastRow = headerRow + Math.max(dataRows, 1);
  const table = sheet.tables.add(`A${headerRow}:${lastColumn}${lastRow}`, true, name);
  table.style = 'TableStyleMedium2';
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}

function applyStatusFormatting(range) {
  range.conditionalFormats.add('containsText', {
    text: '缺原文证据',
    format: { fill: COLORS.redFill, font: { color: COLORS.red, bold: true } },
  });
  range.conditionalFormats.add('containsText', {
    text: '待部门确认',
    format: { fill: COLORS.amberFill, font: { color: COLORS.amber, bold: true } },
  });
  range.conditionalFormats.add('containsText', {
    text: '已完成',
    format: { fill: COLORS.greenFill, font: { color: COLORS.green, bold: true } },
  });
}

function applyTitleMatchFormatting(range) {
  for (const text of ['不唯一', '待补', '待核验', '缺原文']) {
    range.conditionalFormats.add('containsText', {
      text,
      format: { fill: COLORS.redFill, font: { color: COLORS.red, bold: true } },
    });
  }
  range.conditionalFormats.add('containsText', {
    text: '唯一匹配',
    format: { fill: COLORS.greenFill, font: { color: COLORS.green } },
  });
}

function formatDataArea(sheet, firstRow, lastRow, lastColumn, rowHeight = 54) {
  const last = excelColumn(lastColumn);
  const range = sheet.getRange(`A${firstRow}:${last}${lastRow}`);
  range.format = {
    font: { color: COLORS.ink, size: 9 },
    wrapText: true,
    verticalAlignment: 'top',
    borders: {
      insideHorizontal: { style: 'thin', color: COLORS.line },
      bottom: { style: 'thin', color: COLORS.line },
    },
  };
  range.format.rowHeight = rowHeight;
}

function sourceFill(sheet, columns, firstRow, lastRow) {
  for (const column of columns) {
    sheet.getRange(`${column}${firstRow}:${column}${lastRow}`).format.fill = COLORS.source;
  }
}

function editableFill(sheet, columns, firstRow, lastRow) {
  for (const column of columns) {
    sheet.getRange(`${column}${firstRow}:${column}${lastRow}`).format.fill = COLORS.editable;
  }
}

function formulaFill(sheet, columns, firstRow, lastRow) {
  for (const column of columns) {
    sheet.getRange(`${column}${firstRow}:${column}${lastRow}`).format.fill = COLORS.formula;
  }
}

function addListValidation(sheet, column, firstRow, lastRow, values) {
  sheet.getRange(`${column}${firstRow}:${column}${lastRow}`).dataValidation = {
    rule: { type: 'list', values },
  };
}

function populateInstructions(sheet, dept, pkg) {
  sheet.showGridLines = false;
  sheet.mergeCells('A1:H1');
  sheet.getRange('A1').values = [[`${dept.name}｜流程与数据梳理模板`]];
  sheet.getRange('A1:H1').format = {
    fill: COLORS.brown,
    font: { bold: true, color: COLORS.white, size: 18 },
    verticalAlignment: 'center',
  };
  sheet.getRange('A1:H1').format.rowHeight = 38;
  sheet.mergeCells('A2:H2');
  sheet.getRange('A2').values = [[`桑基图快照：${pkg.snapshotDate}｜Excel为唯一填报真源｜现有内容均为待部门确认的预填值`]];
  sheet.getRange('A2:H2').format = { fill: COLORS.beige, font: { color: COLORS.muted }, verticalAlignment: 'center' };
  sheet.getRange('A2:H2').format.rowHeight = 26;

  const cards = [
    ['L3流程', dept.counts.processes],
    ['A1业务行为', dept.counts.behaviors],
    ['已有承接方向', dept.counts.mappedProcesses],
    ['系统承接待确认', dept.counts.unmappedProcesses],
  ];
  cards.forEach((card, index) => {
    const start = index * 2 + 1;
    const end = start + 1;
    sheet.mergeCells(`${excelColumn(start)}4:${excelColumn(end)}4`);
    sheet.mergeCells(`${excelColumn(start)}5:${excelColumn(end)}5`);
    sheet.getRange(`${excelColumn(start)}4`).values = [[card[0]]];
    sheet.getRange(`${excelColumn(start)}5`).values = [[card[1]]];
    sheet.getRange(`${excelColumn(start)}4:${excelColumn(end)}4`).format = {
      fill: index === 3 ? COLORS.amberFill : COLORS.sage,
      font: { bold: true, color: COLORS.ink },
      horizontalAlignment: 'center', verticalAlignment: 'center',
    };
    sheet.getRange(`${excelColumn(start)}5:${excelColumn(end)}5`).format = {
      fill: COLORS.beige2, font: { bold: true, color: COLORS.brown, size: 16 },
      horizontalAlignment: 'center', verticalAlignment: 'center',
    };
  });

  sheet.mergeCells('A7:H7');
  sheet.getRange('A7').values = [['本周每条流程必须回答的8个问题']];
  sheet.getRange('A7:H7').format = { fill: COLORS.brown2, font: { bold: true, color: COLORS.white } };
  const questionRows = pkg.rules.workflowQuestions.map((question, index) => [index + 1, question, index < 2 ? '01_流程总览' : '02_业务行为', '状态：已完成 / 待部门确认 / 缺原文证据']);
  sheet.getRange('A8:H8').values = [['序号', '问题与填写口径', '主要填写位置', '状态口径', '', '', '', '']];
  questionRows.forEach((row, index) => {
    const targetRow = index + 9;
    sheet.mergeCells(`B${targetRow}:D${targetRow}`);
    sheet.mergeCells(`F${targetRow}:H${targetRow}`);
    sheet.getRange(`A${targetRow}`).values = [[row[0]]];
    sheet.getRange(`B${targetRow}`).values = [[row[1]]];
    sheet.getRange(`E${targetRow}`).values = [[row[2]]];
    sheet.getRange(`F${targetRow}`).values = [[row[3]]];
  });
  sheet.getRange('A8:H8').format = { fill: COLORS.mist, font: { bold: true }, horizontalAlignment: 'center' };
  sheet.getRange('A8:H16').format.wrapText = true;
  sheet.getRange('A8:H16').format.borders = { preset: 'all', style: 'thin', color: COLORS.line };
  sheet.getRange('A9:A16').format.horizontalAlignment = 'center';
  sheet.getRange('E9:E16').format.horizontalAlignment = 'center';
  sheet.getRange('A9:H16').format.rowHeight = 38;

  sheet.mergeCells('A18:H18');
  sheet.getRange('A18').values = [['填写顺序与证据纪律']];
  sheet.getRange('A18:H18').format = { fill: COLORS.brown2, font: { bold: true, color: COLORS.white } };
  const notes = [
    ['1', '先确认01流程总览中的流程范围和系统接管期待。'],
    ['2', '再逐条完善02业务行为；判断节点必须同时写条件、下一步和退回位置。'],
    ['3', '本周至少选择3条流程，在03数据字典中逐字段填写。新增字段时复制所在A1的起始行。'],
    ['4', '流程和A1必须直接显示原文制度名称；“继承所属流程制度”不等于本行为已有直接证据。'],
    ['5', '原文未写清的内容保持待确认或缺原文证据，不根据经验补成已确认事实。'],
    ['6', '同一制度编号对应多个不同原文名称时，保留原文名称并标记“编号-名称不唯一”，不能按已完成处理。'],
  ];
  notes.forEach((note, index) => {
    const row = 19 + index;
    sheet.getRange(`A${row}`).values = [[note[0]]];
    sheet.mergeCells(`B${row}:H${row}`);
    sheet.getRange(`B${row}`).values = [[note[1]]];
  });
  sheet.getRange('A19:H24').format = { fill: COLORS.beige2, wrapText: true, borders: { preset: 'all', style: 'thin', color: COLORS.line } };
  sheet.getRange('A19:A24').format.horizontalAlignment = 'center';
  sheet.getRange('A19:H24').format.rowHeight = 34;
  setWidths(sheet, [7, 20, 20, 20, 18, 20, 20, 20], 24);
}

function populateProcessSheet(sheet, dept, dictionaryEndRow) {
  const headers = [
    '模板内部流程号', '部门', '能力域（L1）', '业务能力（L2）', '业务流程（L3）',
    '原文制度编号', '原文制度名称', '其他关联制度名称', '原文位置', '原始文件名', '制度引用展示',
    '当前桑基图承接方向', '系统承接状态', '是否期望信息化接管', '期望接管范围',
    '①解决什么事（流程目的和结束边界）', '②谁负总责', '③何时触发', '④开始前有什么（前置条件和输入）',
    '⑧最终交付什么（输出和完成标志）', '本周是否纳入数据字典', '数据字典完成状态',
    '是否调整', '调整说明', '部门确认意见', '原始证据状态', '流程填报状态', '原始制度引用', '来源映射文件',
    '制度编号-名称匹配状态',
  ];
  styleTitle(sheet, `${dept.name}｜01 流程总览`, '灰色为来源预填，浅黄色为部门填写，浅蓝色为公式结果。原文制度名称固定显示在流程名称之后。', headers.length);
  const startRow = 4;
  const rows = dept.processes.map(process => {
    const titles = splitPrimaryAndOthers(process.originalDocTitles);
    return [
      process.processId, process.dept, process.l1, process.l2, process.l3,
      process.originalDocNos, titles.primary, titles.others, process.originalLocators, process.sourceFileNames, process.citationDisplay,
      process.systemDisplay, process.systemMappingStatus, process.itTakeoverExpectation, process.takeoverScope,
      process.purposeAndBoundary, process.overallOwner, process.overallTrigger, process.startConditionsAndInputs,
      process.finalDeliverableAndCompletion, process.weeklyDictionaryScope, '', process.adjustmentNeeded, process.adjustmentNote,
      process.departmentConfirmation, process.evidenceStatus, '', process.rawCitation, process.sourceFile, process.titleMatchStatus,
    ];
  });
  matrixRange(sheet, 3, 1, [headers]);
  matrixRange(sheet, startRow, 1, rows);
  const endRow = startRow + rows.length - 1;
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRange(`V${row}`).formulas = [[`=IF($U${row}<>"是","未纳入",IF(COUNTIFS('03_数据字典'!$C$4:$C$${dictionaryEndRow},$A${row},'03_数据字典'!$AN$4:$AN$${dictionaryEndRow},"<>已完成")=0,"已完成","待完善"))`]];
    sheet.getRange(`AA${row}`).formulas = [[`=IF(OR($Z${row}="缺原文证据",$AD${row}<>"编号-名称唯一匹配",$G${row}="未提供制度原文（待部门补证）",$I${row}="待补原文位置"),"缺原文证据",IF(OR($N${row}="待确认",$P${row}="",$Q${row}="",$R${row}="",$S${row}="",$T${row}=""),"待部门确认","已完成"))`]];
  }
  addTable(sheet, `${dept.code}ProcessTable`, 3, rows.length, headers.length);
  formatDataArea(sheet, startRow, endRow, headers.length, 66);
  styleTableHeader(sheet, 3, headers.length);
  sourceFill(sheet, ['A','B','C','D','E','F','G','H','I','J','K','L','M','Z','AB','AC','AD'], startRow, endRow);
  editableFill(sheet, ['N','O','P','Q','R','S','T','U','W','X','Y'], startRow, endRow);
  formulaFill(sheet, ['V','AA'], startRow, endRow);
  addListValidation(sheet, 'N', startRow, endRow, ['是', '否', '部分', '待确认']);
  addListValidation(sheet, 'U', startRow, endRow, ['是', '否']);
  addListValidation(sheet, 'W', startRow, endRow, ['是', '否', '待确认']);
  applyStatusFormatting(sheet.getRange(`M${startRow}:AA${endRow}`));
  applyTitleMatchFormatting(sheet.getRange(`AD${startRow}:AD${endRow}`));
  setWidths(sheet, [16,10,18,22,42,18,28,26,18,30,42,20,18,18,30,40,20,28,34,34,16,18,14,30,28,16,16,38,32,24], endRow);
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(7);
  sheet.showGridLines = false;
  return { startRow, endRow, statusColumn: 'AA' };
}

function populateBehaviorSheet(sheet, dept) {
  const headers = [
    '行为行号', '部门', '模板内部流程号', '所属L3流程', 'A1编号', 'A1业务行为',
    '原文制度编号', '原文制度名称', '原文位置', '原始文件名', '制度引用展示', '证据引用方式', '证据类型',
    '⑤每一步谁来做（执行角色）', '执行角色依据', '③何时触发', '触发依据', '④前置条件', '前置条件依据', '输入材料',
    '⑥具体做什么', '节点类型', '判断条件', '下一步', '退回位置', '时限', '⑦执行规则', '验收条件', '验收依据',
    '输出结果', '⑧完成标志', '输入来源部门', '输出目标部门', '审批类型', '当前系统', '当前模块',
    '核验提醒', '是否调整', '调整建议', '部门确认意见', '备注', '原始证据状态', '行为填报状态', '原始制度引用',
    '制度编号-名称匹配状态',
  ];
  styleTitle(sheet, `${dept.name}｜02 业务行为`, '每条A1均显示原文制度名称。判断节点必须补齐判断条件、下一步和退回位置；“继承所属流程制度”不等于A1直接证据。', headers.length);
  const startRow = 4;
  const rows = dept.behaviors.map(item => [
    item.behaviorRowId, item.dept, item.processId, item.l3, item.a1Code, item.a1Name,
    item.originalDocNos, item.originalDocTitles, item.originalLocators, item.sourceFileNames, item.citationDisplay,
    item.citationMode, item.evidenceType, item.actor, item.actorBasis, item.triggerScene, item.triggerBasis,
    item.precondition, item.preconditionBasis, item.inputMaterials, item.concreteAction, item.nodeType,
    item.decisionCondition, item.nextStep, item.returnStep, item.timeLimit, item.executionStandard,
    item.acceptanceCondition, item.acceptanceBasis, item.outputResult, item.completionMarker,
    item.inputSourceDept, item.outputTargetDept, item.approvalType, item.currentSystems, item.currentModule,
    item.verificationNote, item.adjustmentNeeded, item.adjustmentSuggestion, item.departmentOpinion,
    item.remarks, item.evidenceStatus, '', item.rawCitation, item.titleMatchStatus,
  ]);
  matrixRange(sheet, 3, 1, [headers]);
  matrixRange(sheet, startRow, 1, rows);
  const endRow = startRow + rows.length - 1;
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRange(`AQ${row}`).formulas = [[`=IF(OR($AP${row}="缺原文证据",$AS${row}<>"编号-名称唯一匹配",$H${row}="未提供制度原文（待部门补证）",$I${row}="待补原文位置"),"缺原文证据",IF(OR($N${row}="",$P${row}="",$R${row}="",$T${row}="",$U${row}="",$V${row}="",$AA${row}="",$AD${row}="",$AE${row}=""),"待部门确认","已完成"))`]];
  }
  addTable(sheet, `${dept.code}BehaviorTable`, 3, rows.length, headers.length);
  formatDataArea(sheet, startRow, endRow, headers.length, 72);
  styleTableHeader(sheet, 3, headers.length);
  sourceFill(sheet, ['A','B','C','D','E','F','G','H','I','J','K','L','M','O','Q','S','AC','AF','AG','AH','AI','AJ','AK','AP','AR','AS'], startRow, endRow);
  editableFill(sheet, ['N','P','R','T','U','V','W','X','Y','Z','AA','AB','AD','AE','AL','AM','AN','AO'], startRow, endRow);
  formulaFill(sheet, ['AQ'], startRow, endRow);
  addListValidation(sheet, 'V', startRow, endRow, ['行为', '判断']);
  addListValidation(sheet, 'AL', startRow, endRow, ['是', '否', '待确认']);
  applyStatusFormatting(sheet.getRange(`L${startRow}:AQ${endRow}`));
  applyTitleMatchFormatting(sheet.getRange(`AS${startRow}:AS${endRow}`));
  setWidths(sheet, [16,10,16,36,18,34,18,28,18,30,40,32,18,24,30,28,28,28,28,32,32,14,28,22,22,14,32,32,28,32,32,20,20,16,18,18,36,14,32,28,28,16,16,38,24], endRow);
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(8);
  sheet.showGridLines = false;
  return { startRow, endRow, statusColumn: 'AQ' };
}

function populateDictionarySheet(sheet, dept) {
  const headers = [
    '字典行号', '部门', '模板内部流程号', '所属L3流程', 'A1编号', 'A1业务行为', '输入输出线索',
    '字段梳理结论', '无字段说明', '表单编号', '表单名称', '表类型', '表名称', '字段序号',
    '字段中文名', '候选英文字段名', '业务定义', '数据对象', '数据类型', '长度', '精度',
    '必填', '主键', '查询条件', '可见', '可编辑', '隐藏', '自动生成', '审批留痕',
    '枚举项', '编号规则', '默认值', '条件带出规则', '计算公式',
    '原文制度或表单编号', '原文制度或表单名称', '原文位置', '制度编号-名称匹配状态', '待确认问题', '字段行状态', '备注',
  ];
  styleTitle(sheet, `${dept.name}｜03 数据字典`, '一字段一行。每个A1已预置一条“待拆字段”起始行；复制行时必须保留流程号、A1编号和原文资料名称。', headers.length);
  const startRow = 4;
  const rows = dept.dictionaryStarters.map(item => [
    item.dictionaryRowId, item.dept, item.processId, item.l3, item.a1Code, item.a1Name, item.inputOutputClue,
    item.fieldConclusion, item.noFieldReason, item.formNo, item.formName, item.tableKind, item.tableName,
    item.fieldSequence, item.fieldChineseName, item.candidateEnglishName, item.businessDefinition, item.dataObject,
    item.dataType, item.length, item.precision, item.required, item.primaryKey, item.queryCondition, item.visible,
    item.editable, item.hidden, item.autoGenerated, item.approvalTrace, item.enumItems, item.numberingRule,
    item.defaultValue, item.conditionalFill, item.calculationFormula, item.sourceDocNo, item.sourceDocTitle,
    item.sourceLocator, item.sourceTitleMatchStatus, item.openQuestion, '', '',
  ]);
  matrixRange(sheet, 3, 1, [headers]);
  matrixRange(sheet, startRow, 1, rows);
  const endRow = startRow + rows.length - 1;
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRange(`AN${row}`).formulas = [[`=IF(OR($AJ${row}="未提供制度原文（待部门补证）",$AK${row}="待补原文位置",$AL${row}<>"编号-名称唯一匹配"),"缺原文证据",IF($H${row}="无字段",IF($I${row}<>"","已完成","待部门确认"),IF($H${row}="有字段",IF(COUNTA($K${row},$M${row},$O${row},$Q${row},$S${row})=5,"已完成","待部门确认"),"待部门确认")))`]];
  }
  addTable(sheet, `${dept.code}DictionaryTable`, 3, rows.length, headers.length);
  formatDataArea(sheet, startRow, endRow, headers.length, 60);
  styleTableHeader(sheet, 3, headers.length);
  sourceFill(sheet, ['A','B','C','D','E','F','G','AI','AJ','AK','AL'], startRow, endRow);
  editableFill(sheet, ['H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AM','AO'], startRow, endRow);
  formulaFill(sheet, ['AN'], startRow, endRow);
  addListValidation(sheet, 'H', startRow, endRow, ['有字段', '无字段', '待确认']);
  addListValidation(sheet, 'L', startRow, endRow, ['主表', '明细表', '表单', '台账', '记录', '接口临时表', '其他']);
  addListValidation(sheet, 'S', startRow, endRow, ['文本', '整数', '小数', '日期', '日期时间', '布尔', '枚举', '长文本', '附件', '人员', '组织', '编码', '其他']);
  for (const column of ['V','W','X','Y','Z','AA','AB','AC']) addListValidation(sheet, column, startRow, endRow, ['是', '否', '待确认']);
  applyStatusFormatting(sheet.getRange(`H${startRow}:AN${endRow}`));
  applyTitleMatchFormatting(sheet.getRange(`AL${startRow}:AL${endRow}`));
  setWidths(sheet, [16,10,16,36,18,32,38,16,28,18,24,16,24,12,22,22,32,22,16,10,10,12,12,14,12,12,12,14,14,28,28,24,30,26,18,30,18,24,30,16,28], endRow);
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(7);
  sheet.showGridLines = false;
  return { startRow, endRow, statusColumn: 'AN' };
}

function populateEvidenceSheet(sheet, dept) {
  const headers = [
    '证据行号', '部门', '对象类型', '对象编号', '对象名称', '来源类型', '原文制度编号', '原文制度名称',
    '制度编号-名称匹配状态', '原始文件名', '原文位置', '原始引用', '引用方式', '证据状态', '原文核验状态', '源文件匹配状态', '源文件路径',
  ];
  styleTitle(sheet, `${dept.name}｜04 证据索引`, '一条来源证据一行。制度名称来自当前映射或唯一源文件匹配；“未逐条核验”不得视为已经完成原文复核。', headers.length);
  const startRow = 4;
  const rows = dept.evidence.map((item, index) => [
    `${dept.code}-EV-${String(index + 1).padStart(5, '0')}`, item.dept, item.objectType, item.objectId,
    item.objectName, item.sourceType, item.docNo, item.docTitle, item.titleMatchStatus, item.sourceFileName, item.locator,
    item.rawCitation, item.citationMode, item.evidenceStatus, item.sourceVerification, item.matchStatus, item.sourcePath,
  ]);
  matrixRange(sheet, 3, 1, [headers]);
  matrixRange(sheet, startRow, 1, rows);
  const endRow = startRow + rows.length - 1;
  addTable(sheet, `${dept.code}EvidenceTable`, 3, rows.length, headers.length);
  formatDataArea(sheet, startRow, endRow, headers.length, 60);
  styleTableHeader(sheet, 3, headers.length);
  sourceFill(sheet, headers.map((_, index) => excelColumn(index + 1)), startRow, endRow);
  applyStatusFormatting(sheet.getRange(`M${startRow}:P${endRow}`));
  applyTitleMatchFormatting(sheet.getRange(`I${startRow}:I${endRow}`));
  setWidths(sheet, [16,10,14,18,36,16,18,30,24,32,20,38,34,16,34,22,48], endRow);
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(8);
  sheet.showGridLines = false;
  return { startRow, endRow };
}

function populateCompletenessSheet(sheet, dept, ranges) {
  sheet.showGridLines = false;
  sheet.mergeCells('A1:H1');
  sheet.getRange('A1').values = [[`${dept.name}｜05 完整性检查`]];
  sheet.getRange('A1:H1').format = { fill: COLORS.brown, font: { bold: true, color: COLORS.white, size: 16 } };
  sheet.mergeCells('A2:H2');
  sheet.getRange('A2').values = [['本页公式随01、02、03工作表的填写结果变化；问题清单展示本轮生成时已经识别的硬性提醒。']];
  sheet.getRange('A2:H2').format = { fill: COLORS.beige, font: { color: COLORS.muted } };

  const metrics = [
    ['L3流程总数', `=COUNTA('01_流程总览'!$A$${ranges.process.startRow}:$A$${ranges.process.endRow})`, '应与本部门桑基图流程数一致'],
    ['A1业务行为总数', `=COUNTA('02_业务行为'!$A$${ranges.behavior.startRow}:$A$${ranges.behavior.endRow})`, '应与本部门业务行为数一致'],
    ['系统承接待确认', `=COUNTIF('01_流程总览'!$M$${ranges.process.startRow}:$M$${ranges.process.endRow},"系统承接待确认")`, '不得从模板中删除'],
    ['流程已完成', `=COUNTIF('01_流程总览'!$AA$${ranges.process.startRow}:$AA$${ranges.process.endRow},"已完成")`, '八项流程级字段已具备'],
    ['流程待部门确认', `=COUNTIF('01_流程总览'!$AA$${ranges.process.startRow}:$AA$${ranges.process.endRow},"待部门确认")`, '继续补充或确认'],
    ['流程缺原文证据', `=COUNTIF('01_流程总览'!$AA$${ranges.process.startRow}:$AA$${ranges.process.endRow},"缺原文证据")`, '必须回到制度或表单源文件'],
    ['A1已完成', `=COUNTIF('02_业务行为'!$AQ$${ranges.behavior.startRow}:$AQ$${ranges.behavior.endRow},"已完成")`, '行为要素完整'],
    ['A1待部门确认', `=COUNTIF('02_业务行为'!$AQ$${ranges.behavior.startRow}:$AQ$${ranges.behavior.endRow},"待部门确认")`, '继续补充判断、标准或输出'],
    ['A1缺原文证据', `=COUNTIF('02_业务行为'!$AQ$${ranges.behavior.startRow}:$AQ$${ranges.behavior.endRow},"缺原文证据")`, '必须回到原文补证'],
    ['本周选入数据字典流程', `=COUNTIF('01_流程总览'!$U$${ranges.process.startRow}:$U$${ranges.process.endRow},"是")`, '每部门最低3条'],
    ['数据字典完成流程', `=COUNTIF('01_流程总览'!$V$${ranges.process.startRow}:$V$${ranges.process.endRow},"已完成")`, '至少达到3条'],
    ['本周最低要求检查', `=IF(COUNTIF('01_流程总览'!$V$${ranges.process.startRow}:$V$${ranges.process.endRow},"已完成")>=3,"已完成","待部门确认")`, '下次周例会前完成'],
  ];
  sheet.getRange('A4:C4').values = [['检查项', '当前结果', '判断口径']];
  sheet.getRange('A4:C4').format = { fill: COLORS.brown2, font: { bold: true, color: COLORS.white }, horizontalAlignment: 'center' };
  metrics.forEach((metric, index) => {
    const row = 5 + index;
    sheet.getRange(`A${row}`).values = [[metric[0]]];
    sheet.getRange(`B${row}`).formulas = [[metric[1]]];
    sheet.getRange(`C${row}`).values = [[metric[2]]];
  });
  sheet.getRange('A5:C16').format = { wrapText: true, borders: { preset: 'all', style: 'thin', color: COLORS.line } };
  sheet.getRange('B5:B16').format = { fill: COLORS.formula, font: { bold: true }, horizontalAlignment: 'center' };
  applyStatusFormatting(sheet.getRange('B5:B16'));

  const processIssues = dept.processes
    .filter(item => item.systemMappingStatus === '系统承接待确认' || item.evidenceStatus === '缺原文证据')
    .map(item => {
      const systemIssue = item.systemMappingStatus === '系统承接待确认';
      const titleIssue = item.titleMatchStatus !== '编号-名称唯一匹配';
      return [
        systemIssue ? '系统落位待确认' : titleIssue ? '制度编号-名称待核验' : '原文证据缺失',
        'L3流程', item.processId, item.l3,
        systemIssue
          ? '当前桑基图未给出系统承接方向'
          : titleIssue ? `当前状态：${item.titleMatchStatus}` : '制度名称或原文位置缺失',
        systemIssue
          ? '部门先确认是否期望信息化接管及接管范围'
          : titleIssue ? '回到制度或表单原文核对编号与完整标题' : '回到制度或表单源文件补充名称与位置',
        systemIssue ? '待部门确认' : item.evidenceStatus,
      ];
    });
  const behaviorIssues = dept.behaviors
    .filter(item => item.evidenceStatus === '缺原文证据')
    .map(item => {
      const titleIssue = item.titleMatchStatus !== '编号-名称唯一匹配';
      return [
        titleIssue ? '制度编号-名称待核验' : '原文证据缺失',
        'A1行为', item.a1Code, item.a1Name,
        titleIssue ? `当前状态：${item.titleMatchStatus}` : '制度名称或原文位置缺失',
        titleIssue ? '回到制度或表单原文核对编号与完整标题' : '回到制度或表单源文件补充名称与位置',
        item.evidenceStatus,
      ];
    });
  const issues = [...processIssues, ...behaviorIssues];
  const issueStart = 19;
  sheet.getRange(`A${issueStart}:G${issueStart}`).values = [['问题类型', '对象类型', '对象编号', '对象名称', '当前问题', '建议动作', '当前状态']];
  sheet.getRange(`A${issueStart}:G${issueStart}`).format = { fill: COLORS.brown2, font: { bold: true, color: COLORS.white }, wrapText: true };
  const issueRows = issues.length ? issues : [['无生成期硬性问题', '—', '—', '—', '继续按八项要求填写', '按完整性公式检查', '待部门确认']];
  matrixRange(sheet, issueStart + 1, 1, issueRows);
  sheet.getRange(`A${issueStart + 1}:G${issueStart + issueRows.length}`).format = {
    wrapText: true,
    borders: { preset: 'all', style: 'thin', color: COLORS.line },
    verticalAlignment: 'top',
  };
  applyStatusFormatting(sheet.getRange(`G${issueStart + 1}:G${issueStart + issueRows.length}`));
  setWidths(sheet, [22,14,18,42,36,38,18,12], issueStart + issueRows.length);
  sheet.freezePanes.freezeRows(4);
}

function populateOptionsSheet(sheet) {
  const rows = [
    ['状态', '已完成'], ['状态', '待部门确认'], ['状态', '缺原文证据'],
    ['编号-名称匹配', '编号-名称唯一匹配'], ['编号-名称匹配', '编号-名称不唯一'], ['编号-名称匹配', '制度编号待补'], ['编号-名称匹配', '编号-名称待核验'],
    ['信息化接管', '是'], ['信息化接管', '否'], ['信息化接管', '部分'], ['信息化接管', '待确认'],
    ['是/否/待确认', '是'], ['是/否/待确认', '否'], ['是/否/待确认', '待确认'],
    ['节点类型', '行为'], ['节点类型', '判断'],
    ['字段梳理结论', '有字段'], ['字段梳理结论', '无字段'], ['字段梳理结论', '待确认'],
    ['表类型', '主表'], ['表类型', '明细表'], ['表类型', '表单'], ['表类型', '台账'], ['表类型', '记录'], ['表类型', '接口临时表'], ['表类型', '其他'],
    ['数据类型', '文本'], ['数据类型', '整数'], ['数据类型', '小数'], ['数据类型', '日期'], ['数据类型', '日期时间'], ['数据类型', '布尔'], ['数据类型', '枚举'], ['数据类型', '长文本'], ['数据类型', '附件'], ['数据类型', '人员'], ['数据类型', '组织'], ['数据类型', '编码'], ['数据类型', '其他'],
  ];
  styleTitle(sheet, '98 下拉选项', '系统维护页：保存本模板使用的标准枚举。部门填写时不要删除已有值。', 2);
  sheet.getRange('A3:B3').values = [['选项类别', '标准值']];
  matrixRange(sheet, 4, 1, rows);
  addTable(sheet, 'TemplateOptionsTable', 3, rows.length, 2);
  styleTableHeader(sheet, 3, 2);
  formatDataArea(sheet, 4, 3 + rows.length, 2, 24);
  sourceFill(sheet, ['A','B'], 4, 3 + rows.length);
  setWidths(sheet, [24,28], 3 + rows.length);
  sheet.freezePanes.freezeRows(3);
  sheet.showGridLines = false;
}

function populateSnapshotSheet(sheet, dept) {
  sheet.showGridLines = false;
  sheet.mergeCells('A1:O1');
  sheet.getRange('A1').values = [[`${dept.name}｜99 来源快照（只读参考）`]];
  sheet.getRange('A1:O1').format = { fill: '#5D6268', font: { bold: true, color: COLORS.white, size: 15 } };
  sheet.mergeCells('A2:O2');
  sheet.getRange('A2').values = [['本页保存生成时的原始映射值，用于核对部门调整前后差异。请勿在本页填写。']];
  sheet.getRange('A2:O2').format = { fill: COLORS.source, font: { color: COLORS.muted } };

  const processHeaders = ['模板内部流程号','能力域（L1）','业务能力（L2）','业务流程（L3）','原始制度引用','制度名称','原文位置','编号-名称匹配状态','系统方向','来源映射文件'];
  const processRows = dept.processes.map(item => [item.processId,item.l1,item.l2,item.l3,item.rawCitation,item.originalDocTitles,item.originalLocators,item.titleMatchStatus,item.systemDisplay,item.sourceFile]);
  sheet.getRange('A4:J4').values = [processHeaders];
  matrixRange(sheet, 5, 1, processRows);
  addTable(sheet, `${dept.code}SnapshotProcessTable`, 4, processRows.length, processHeaders.length);
  styleTableHeader(sheet, 4, processHeaders.length);
  const behaviorHeaderRow = 7 + processRows.length;
  const behaviorHeaders = ['行为行号','模板内部流程号','所属L3流程','A1编号','A1业务行为','原始制度引用','制度名称','原文位置','证据类型','执行角色','触发情景','前置条件','数据输入','数据输出','编号-名称匹配状态'];
  const behaviorRows = dept.behaviors.map(item => [
    item.behaviorRowId,item.processId,item.l3,item.a1Code,item.a1Name,item.rawCitation,item.originalDocTitles,item.originalLocators,
    item.evidenceType,item.actor,item.triggerScene,item.precondition,item.inputMaterials,item.outputResult,item.titleMatchStatus,
  ]);
  sheet.getRange(`A${behaviorHeaderRow}:O${behaviorHeaderRow}`).values = [behaviorHeaders];
  matrixRange(sheet, behaviorHeaderRow + 1, 1, behaviorRows);
  addTable(sheet, `${dept.code}SnapshotBehaviorTable`, behaviorHeaderRow, behaviorRows.length, behaviorHeaders.length);
  styleTableHeader(sheet, behaviorHeaderRow, behaviorHeaders.length);
  const endRow = behaviorHeaderRow + behaviorRows.length;
  sheet.getRange(`A5:O${endRow}`).format = { fill: COLORS.source, wrapText: true, verticalAlignment: 'top', font: { size: 9 } };
  sheet.getRange(`A5:J${4 + processRows.length}`).format.rowHeight = 54;
  sheet.getRange(`A${behaviorHeaderRow + 1}:O${endRow}`).format.rowHeight = 60;
  setWidths(sheet, [16,18,22,38,38,28,18,24,18,32,24,28,28,32,32], endRow);
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(5);
}

async function buildWorkbook(pkg, dept, outputDir, qaDir) {
  process.stderr.write(`[workbook] ${dept.name}: create workbook\n`);
  const workbook = Workbook.create();
  const sheets = Object.fromEntries(SHEETS.map(name => [name, workbook.worksheets.add(name)]));
  const dictionaryEnd = 3 + dept.dictionaryStarters.length;

  process.stderr.write(`[workbook] ${dept.name}: populate 00\n`);
  populateInstructions(sheets['00_填写说明'], dept, pkg);
  process.stderr.write(`[workbook] ${dept.name}: populate 01\n`);
  const processRange = populateProcessSheet(sheets['01_流程总览'], dept, dictionaryEnd);
  process.stderr.write(`[workbook] ${dept.name}: populate 02\n`);
  const behaviorRange = populateBehaviorSheet(sheets['02_业务行为'], dept);
  process.stderr.write(`[workbook] ${dept.name}: populate 03\n`);
  const dictionaryRange = populateDictionarySheet(sheets['03_数据字典'], dept);
  process.stderr.write(`[workbook] ${dept.name}: populate 04\n`);
  const evidenceRange = populateEvidenceSheet(sheets['04_证据索引'], dept);
  process.stderr.write(`[workbook] ${dept.name}: populate 05\n`);
  populateCompletenessSheet(sheets['05_完整性检查'], dept, {
    process: processRange,
    behavior: behaviorRange,
    dictionary: dictionaryRange,
    evidence: evidenceRange,
  });
  process.stderr.write(`[workbook] ${dept.name}: populate 98/99\n`);
  populateOptionsSheet(sheets['98_下拉选项']);
  populateSnapshotSheet(sheets['99_来源快照'], dept);

  process.stderr.write(`[workbook] ${dept.name}: inspect\n`);
  const summaryInspect = await workbook.inspect({
    kind: 'table',
    range: `'05_完整性检查'!A1:C16`,
    include: 'values,formulas',
    tableMaxRows: 20,
    tableMaxCols: 8,
    maxChars: 7000,
  });
  const errorInspect = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 100 },
    summary: `${dept.name} final formula error scan`,
    maxChars: 5000,
  });

  const packageDate = String(pkg.generatedAt || pkg.snapshotDate).slice(0, 10);
  const fileName = `${dept.name}_流程与数据梳理模板_${packageDate}.xlsx`;
  const filePath = join(outputDir, fileName);
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(filePath);
  process.stderr.write(`[workbook] ${dept.name}: exported\n`);

  return {
    department: dept.name,
    code: dept.code,
    fileName,
    filePath,
    counts: dept.counts,
    sheetCount: SHEETS.length,
    inspect: summaryInspect.ndjson,
    formulaErrors: errorInspect.ndjson,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(await fs.readFile(args.data, 'utf8'));
  await fs.mkdir(args.output, { recursive: true });
  await fs.mkdir(args.qa, { recursive: true });
  const departments = args.dept ? pkg.departments.filter(item => item.name === args.dept) : pkg.departments;
  if (departments.length === 0) throw new Error(`Department not found: ${args.dept}`);

  const reports = [];
  for (const dept of departments) {
    reports.push(await buildWorkbook(pkg, dept, args.output, args.qa));
    process.stdout.write(`${dept.name}: ${dept.counts.processes} L3 / ${dept.counts.behaviors} A1\n`);
  }
  const reportPath = join(args.qa, `workbook-validation-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify({ dataFile: basename(args.data), reports }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputDir: args.output, qaDir: args.qa, reportPath, files: reports.map(item => item.fileName) })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
