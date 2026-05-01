// Quick layout analyzer
const state = {
  capabilities: [
    { name: '工艺策划', l3: ['工艺与制造方案策划', '生产线规划与管控', '制造过程风险分析'] },
    { name: '工艺验证与改进管理', l3: ['工艺技术实施与管控', '工艺优化与总结提升'] },
    { name: '工艺设计', l3: ['工艺生产过程管控', '工艺文件编制与管控', '制造数据统筹管控', '物料及特制件管控'] }
  ],
  processes: [
    '工艺网络计划制定', '制造总方案制定', '装配协调方案制定', '零件制造方案制定',
    '互换和替换检查控制', '包装运输技术策划', '生产线规划', '产能控制',
    '架次流程图制定', '产品制造的风险控制', 'PFMEA', '工艺评审', '工艺鉴定',
    '工艺纪律检查', '工艺仿真', '技术问题处理', '研制工艺工作总结',
    '制造物料清单（MBOM）编制', 'ERP物料主数据维护', '工时定额编制',
    '材料和外购件代用', '特制件管控', '关键工序控制', '关重件的控制',
    'KC控制', '特殊过程控制', '一般生产过程管理', '工艺过程管控',
    '零组件供应状态表的编制', '装配工艺文件管控', '零件工艺文件管控'
  ],
  systems: [
    { id: 's1', name: '三维仿真工具' },
    { id: 's2', name: '产能管理系统' },
    { id: 's3', name: 'CPM' },
    { id: 's4', name: 'CAPP' },
    { id: 's5', name: 'MES' },
    { id: 's6', name: '三维工艺' },
    { id: 's7', name: 'PDM（BOM管理）' },
    { id: 's8', name: '用友U8' }
  ],
  colX: { cap: 30, proc: 320, sys: 600 },
  rowHeight: 45,
  startY: 55,
  nodeHeight: 36
};

// Calculate
let capTotalRows = 0;
state.capabilities.forEach(cap => { capTotalRows += 1 + cap.l3.length; });

const totalRows = Math.max(capTotalRows, state.processes.length, state.systems.length);
const canvasHeight = state.startY + totalRows * state.rowHeight + 50;

const procY = state.startY + (totalRows - state.processes.length) / 2 * state.rowHeight;
const sysY = state.startY + (totalRows - state.systems.length) / 2 * state.rowHeight;

console.log('=== Layout Analysis ===');
console.log(`Capability rows: ${capTotalRows} (including L2 headers)`);
console.log(`Process rows: ${state.processes.length}`);
console.log(`System rows: ${state.systems.length}`);
console.log(`Total rows (max): ${totalRows}`);
console.log(`Canvas height: ${canvasHeight}px`);
console.log(`Process starts at y: ${procY}px`);
console.log(`System starts at y: ${sysY}px`);
console.log(`Cap starts at y: ${state.startY}px`);
console.log(`Cap ends at y: ${state.startY + capTotalRows * state.rowHeight}px`);