import React from 'react';
import { IdentityTable } from './IdentityShared.jsx';
import { conflictHistory } from './conflictHistory.js';

export function ConflictHistory({ detail }) {
  return <section data-conflict-timeline aria-label="冲突事件时间线">
    <h4>事件时间线</h4>
    <p>按已记录时间排列；同一时间的先后顺序不代表动作因果。缺少有效时间的记录列在末尾，原时间值保留供核对。</p>
    <IdentityTable headers={['记录时间', '事件', '操作人员', '内容与依据']}
      rows={conflictHistory(detail).map(event => [event.time || '时间未记录', event.action, event.actor, event.note])}/>
    <p className="muted">这里只汇总接口当前保留的记录，不代表完整审计日志。重新打开时，原接口会清空处理决定；归档、升级或重新打开的发生时间未单独提供，不能用截止日期代替，也不据此补造历史。</p>
  </section>;
}
