import { userMessage } from './businessPresentation.js';

// Explain existing checks without changing their admission, state or findings.
const processChecks = {
  'v7.format': ['文件内容能否读取', '按所选材料保存时的文件格式检查。', '暂不能读取的材料只保留读取问题，不据此认定业务内容错误。'],
  'v7.required': ['必填内容是否齐备', '仅检查该文件格式明确要求提供的内容。', '允许留空的说明和字段清单不作为缺失。'],
  'v7.duplicate': ['重复关联或定义', '材料可读取且必要内容齐备后，检查重复关联和重复定义。', '不按业务名称自动合并对象。'],
  'v7.local_integrity': ['材料内的关联是否完整', '材料可读取且必要内容齐备后，核对已记录的关联。', '文件中的关联问题仍须人工核实，不直接认定业务做法错误。'],
  'v7.field_binding': ['填写项与对象字段的对应关系', '存在明确字段关联时，核对所引用的对象字段。', '没有声明字段关联的填写项，不自动要求补充关联。'],
  'v7.isolated': ['未与其他环节衔接的流程环节', '环节不止一个、关联完整且没有歧义时检查。', '单个环节、内容缺失或关联有歧义时不作判断。'],
  'v7.exit': ['判断和并行办理的后续路线', '关联完整且没有歧义时，检查判断或分出并行工作的环节。', '普通办理的末环节、并行工作的汇合末环节及未明确类型的环节不作错误判断。'],
  'v7.branch_condition': ['办理路线的条件说明', '关联完整且没有歧义时，检查按条件办理或返回前序环节的路线。', '依次办理和并行办理的路线不因此要求填写条件。'],
  'v7.unreachable': ['从流程入口能否到达各环节', '须先明确流程入口和完整办理含义。', '本项检查尚未开启；没有明确入口的历史材料不推断其入口或结束环节。'],
  'v7.content_completeness': ['流程编制完整性', '材料可读取且关联核对通过后，检查流程内容的缺项。', '空数据对象、空表单及明确待确认的内容保留待核实，不补造事实。'],
  'v7.decision_branches': ['判断分支和办理路线', '材料可读取且关联核对通过后，检查已声明的分支、条件及路线。', '不从名称或排列推断入口、出口及业务判断结果。'],
  'v7.action_executability': ['各环节的操作说明', '材料可读取且关联核对通过后，检查办理环节是否说明具体动作。', '文字检查只提供修订提示，仍须人工核对实际做法，不表示业务验收。']
};

export function analysisRulePresentation(rule) {
  const known = processChecks[rule?.rule_id];
  if (known) return {...rule, title: known[0], prerequisite: known[1], not_applicable: known[2]};
  const result = {...rule, title: userMessage(rule?.title, '材料检查项目'),
    prerequisite: userMessage(rule?.prerequisite, '请按本次材料和当前检查范围核对。'),
    not_applicable: userMessage(rule?.not_applicable, '本项结果仍须人工核实，不表示业务确认。')};
  if (String(rule?.rule_id || '').startsWith('handoff.')) result.prerequisite = '已保存的设计交接记录、对象及字段版本，以及明确的流程对应关系。';
  return result;
}
