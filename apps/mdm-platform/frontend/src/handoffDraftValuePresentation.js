import {businessText} from './businessPresentation.js';

const labels={
  data_type:{string:'文本',text:'长文本',varchar:'短文本',nvarchar:'多语言文本',number:'数字',integer:'整数',int:'整数',decimal:'小数',boolean:'是否',date:'日期',datetime:'日期和时间',timestamp:'时间点'},
  data_format:{'YYYY-MM-DD':'年、月、日','yyyy-MM-dd':'年、月、日','YYYY-MM-DD HH:mm:ss':'年、月、日、时、分、秒'},
  stage:{create:'形成',creation:'形成',use:'使用',usage:'使用',storage:'存储',archive:'归档',archival:'归档',retention:'保管',destroy:'销毁',destruction:'销毁'},
  operation:{create:'创建',read:'读取',use:'使用',update:'更新',modify:'修改',delete:'删除',archive:'归档',retain:'保留',transfer:'传递',destroy:'销毁'},
  operations:{create:'创建',read:'读取',use:'使用',update:'更新',modify:'修改',delete:'删除',archive:'归档',retain:'保留',transfer:'传递',destroy:'销毁'},
  identifier_role:{primary:'主标识',primary_key:'主标识',identifier:'识别记录',unique:'唯一识别',foreign_key:'关联其他记录',none:'不用于识别'},
  sensitivity:{public:'公开',internal:'内部使用',confidential:'保密',restricted:'限制使用',personal:'个人信息',sensitive:'敏感信息',normal:'普通'},
  masking:{none:'不脱敏',mask:'遮盖部分内容',masked:'遮盖部分内容',redact:'隐藏敏感内容',hash:'不可逆替代',encrypt:'加密保护'}
};

export const hasDraftValuePresentation=kind=>Object.hasOwn(labels,kind);
export function draftValueText(kind,value){
  const raw=Array.isArray(value)?value.join('\n'):String(value??'');
  return raw.split('\n').map(part=>labels[kind]?.[part]||(/[\p{Script=Han}]/u.test(part)?businessText(part,''):'')).join('\n');
}

// Rendering never rewrites a saved value. Only an explicit text edit reaches
// this conversion; aliases keep the exact original token when the label fits.
export function draftValueFromText(kind,text,original){
  const previous=(Array.isArray(original)?original.join('\n'):String(original??'')).split('\n');
  return String(text).split('\n').map((part,index)=>{
    if(labels[kind]?.[previous[index]]===part)return previous[index];
    return Object.entries(labels[kind]||{}).find(([,label])=>label===part)?.[0]??part;
  }).join('\n');
}
