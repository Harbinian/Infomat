import {businessText} from './businessPresentation.js';

// Translate only known saved summary phrases; source records and files stay exact.
const phrases = [
  ['根据用户已确认的Q33、Q34', '根据已确认的流程编制要求'],
  ['将原生编制表达升级为V9', '调整流程编制内容'],
  ['JSON正文', '原编制正文']
];
export function submissionSummary(value, label = '此项说明') {
  if (value == null || value === '') return '未记录';
  const text = phrases.reduce((result, [from,to]) => result.replaceAll(from,to), String(value));
  const unsafe = /\bJSON\b|\bV\d+\b|Q(?:33|34)(?!\d)|(?:^|[\s，、；：（])Q\d{1,4}(?=$|[\s，、；：）]|将|中|已)/i;
  // These model terms do not identify the affected business record or its use.
  // Do not infer those facts from the saved wording or rewrite source material.
  const modelWording = /独立记录集合|追加新实例|(?:记录模型|编制模型)中的(?:存在条件|存在时才读取)/;
  if (modelWording.test(text)) return `${label}的业务说明待补充。请由本流程已明确的编制人员在原案例说明：涉及哪份业务记录、具体改了什么，以及什么情况下需要填写或查阅。原材料和历史记录保留。`;
  const fallback = `${label}的原说明含技术标记，请由本流程编制人员在原案例补充业务说明。原材料继续保留。`;
  return unsafe.test(text) ? fallback : businessText(text, fallback);
}
