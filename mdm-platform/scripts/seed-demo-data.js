/**
 * Seed MDM platform with demo data extracted from
 * docs/Demo/信息化系统应用与集成说明会V1.0.html (2026-05-14 meeting)
 *
 * Idempotent — skips records that already exist.
 * Run: node scripts/seed-demo-data.js
 */
const db = require('../server/db');
const { hashPassword } = require('../server/auth');

function demoHash() { return hashPassword('demo12345678'); }

// ── helpers ──────────────────────────────────────────────
function exists(table, col, val) {
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(val);
}
function lastId() {
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
function sys(name) {
  const full = {
    ERP: 'ERP (用友 U8)', OA: 'OA (华天动力)',
    PLM: 'PLM (PLM供应商)', MES: 'MES (北京虎蜥)',
    MDM: 'MDM 主数据管理平台',
  };
  return full[name] || name;
}

// ── 1. Departments ───────────────────────────────────────
console.log('Seeding departments...');
const depts = [
  { name: '行政人事部',         code: 'DEPT_XZRS',  type: '职能', sort: 1 },
  { name: '工程技术部',         code: 'DEPT_GCJS',  type: '业务', sort: 2 },
  { name: '质量管理部',         code: 'DEPT_ZLGL',  type: '职能', sort: 3 },
  { name: '物资保障部',         code: 'DEPT_WZBZ',  type: '业务', sort: 4 },
  { name: '信息化项目组',       code: 'DEPT_XXH',   type: '职能', sort: 5 },
  { name: '复材车间',           code: 'DEPT_FCCJ',  type: '生产', sort: 6 },
  { name: '财务部',             code: 'DEPT_CW',    type: '职能', sort: 7 },
  { name: '运维安环部',         code: 'DEPT_YW',    type: '职能', sort: 8 },
  { name: '项目管理部',         code: 'DEPT_XMGL',  type: '业务', sort: 9 },
];
const deptMap = {};
for (const d of depts) {
  if (!exists('departments', 'code', d.code)) {
    db.prepare(`INSERT INTO departments (name, code, department_type, sort_order, status)
                VALUES (?, ?, ?, ?, 'active')`).run(d.name, d.code, d.type, d.sort);
    deptMap[d.code] = lastId();
  } else {
    deptMap[d.code] = db.prepare('SELECT id FROM departments WHERE code=?').get(d.code).id;
  }
  console.log(`  department: ${d.name}`);
}

// ── 2. Users ────────────────────────────────────────────
console.log('Seeding users...');
const users = [
  { name: '系统管理员', eno: 'ADMIN001', dept: null,      post: '系统管理员', role: 'admin' },
  { name: '张工',       eno: 'EMP0001', dept: 'DEPT_GCJS', post: '主任工程师',  role: 'owner' },
  { name: '李质量',     eno: 'EMP0002', dept: 'DEPT_ZLGL', post: '质量主管',    role: 'reviewer' },
  { name: '王物资',     eno: 'EMP0003', dept: 'DEPT_WZBZ', post: '物资主管',    role: 'owner' },
  { name: '赵信息',     eno: 'EMP0004', dept: 'DEPT_XXH',  post: '项目经理',    role: 'admin' },
  { name: '刘车间',     eno: 'EMP0005', dept: 'DEPT_FCCJ', post: '车间主任',    role: 'submitter' },
  { name: '陈财务',     eno: 'EMP0006', dept: 'DEPT_CW',   post: '财务主管',    role: 'reviewer' },
  { name: '周人事',     eno: 'EMP0007', dept: 'DEPT_XZRS', post: '人事主管',    role: 'owner' },
  { name: '吴运维',     eno: 'EMP0008', dept: 'DEPT_YW',   post: '运维主管',    role: 'submitter' },
  { name: '郑项目',     eno: 'EMP0009', dept: 'DEPT_XMGL', post: '项目经理',    role: 'submitter' },
];
const userMap = {};
for (const u of users) {
  if (!exists('users', 'employee_no', u.eno)) {
    db.prepare(`INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(u.name, u.eno, deptMap[u.dept] || null, u.post, u.role, demoHash());
    userMap[u.eno] = lastId();
  } else {
    userMap[u.eno] = db.prepare('SELECT id FROM users WHERE employee_no=?').get(u.eno).id;
  }
  console.log(`  user: ${u.name} (${u.role})`);
}

// ── 3. Systems ──────────────────────────────────────────
console.log('Seeding systems...');
const sysNames = [
  { name: 'ERP (用友 U8)',        dept: 'DEPT_WZBZ' },
  { name: 'OA (华天动力)',         dept: 'DEPT_XZRS' },
  { name: 'PLM (PLM供应商)',       dept: 'DEPT_GCJS' },
  { name: 'MES (北京虎蜥)',       dept: 'DEPT_FCCJ' },
  { name: 'MDM 主数据管理平台',    dept: 'DEPT_XXH'  },
  { name: '工艺管理 (PLM一期)',       dept: 'DEPT_GCJS' },
  { name: 'WMS (远景规划)',        dept: 'DEPT_WZBZ' },
  { name: '供应链管理系统 (远景规划)', dept: 'DEPT_WZBZ' },
];
const sysMap = {};
for (const s of sysNames) {
  if (!exists('systems', 'name', s.name)) {
    db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run(s.name, deptMap[s.dept]);
    sysMap[s.name] = lastId();
  } else {
    sysMap[s.name] = db.prepare('SELECT id FROM systems WHERE name=?').get(s.name).id;
  }
  console.log(`  system: ${s.name}`);
}

// ── 4. Capabilities (L1 → L2 hierarchy) ─────────────────
console.log('Seeding capabilities hierarchy...');
function seedCap(parentId, name, level, ownerDeptCode) {
  if (exists('capabilities', 'name', name))
    return db.prepare('SELECT id FROM capabilities WHERE name=?').get(name).id;
  db.prepare(`INSERT INTO capabilities (name, level, owner_dept_id, parent_id, status)
              VALUES (?, ?, ?, ?, 'approved')`)
    .run(name, level, deptMap[ownerDeptCode] || null, parentId);
  return lastId();
}

// L1 = department domains
const capL1 = {};
for (const d of depts) capL1[d.code] = seedCap(null, d.name, 'L1', d.code);

// L2 = business capability groups
const capL2 = {};
const l2entries = [
  ['工艺生产过程管控','DEPT_GCJS'],['工艺文件编制与管控','DEPT_GCJS'],['生产线规划与管控','DEPT_GCJS'],
  ['物料及特制件管控','DEPT_GCJS'],['制造数据统筹管控','DEPT_GCJS'],
  ['动能供应','DEPT_YW'],['设备设施保障','DEPT_YW'],['设备设施规划','DEPT_YW'],['设备设施运维','DEPT_YW'],
  ['质量闭环','DEPT_ZLGL'],['质量策划','DEPT_ZLGL'],['质量执行','DEPT_ZLGL'],
  ['仓储与物流协同','DEPT_WZBZ'],['计划与排程','DEPT_XMGL'],['生产执行','DEPT_FCCJ'],
  ['工装策划与申请','DEPT_GCJS'],['工装设计与制造','DEPT_GCJS'],['工装使用与维护','DEPT_FCCJ'],['工装验证与优化','DEPT_ZLGL'],
  ['OA 协同办公能力','DEPT_XZRS'],['PLM 产品生命周期管理能力','DEPT_GCJS'],
  ['MES 制造执行能力','DEPT_FCCJ'],['ERP 经营管理能力','DEPT_WZBZ'],
];
for (const [name, owner] of l2entries) {
  capL2[name] = seedCap(capL1[owner], name, 'L2', owner);
  console.log(`  L2: ${name}`);
}
console.log(`  ${Object.keys(capL1).length} L1, ${Object.keys(capL2).length} L2`);

// ── 5. Processes (L3 items in processes table) ──────────
console.log('Seeding processes...');
const processList = [
  // 工艺生产过程管控
  ['关键工序控制','工艺生产过程管控','DEPT_GCJS'],['关键件的控制','工艺生产过程管控','DEPT_GCJS'],
  ['关键特性KC控制','工艺生产过程管控','DEPT_GCJS'],['特殊过程控制','工艺生产过程管控','DEPT_GCJS'],
  ['一般生产过程管理','工艺生产过程管控','DEPT_GCJS'],['工艺过程管控','工艺生产过程管控','DEPT_GCJS'],
  // 工艺文件编制与管控
  ['制造工艺文件管控','工艺文件编制与管控','DEPT_GCJS'],['零件制造工艺文件管控','工艺文件编制与管控','DEPT_GCJS'],
  // 生产线规划与管控
  ['生产线规划','生产线规划与管控','DEPT_GCJS'],['产能控制','生产线规划与管控','DEPT_GCJS'],
  // 物料及特制件管控
  ['物料主数据维护','物料及特制件管控','DEPT_GCJS'],['材料和外购件代用','物料及特制件管控','DEPT_GCJS'],
  ['特制件管控','物料及特制件管控','DEPT_GCJS'],
  // 制造数据统筹管控
  ['MBOM编制','制造数据统筹管控','DEPT_GCJS'],['零组件供应状态表编制','制造数据统筹管控','DEPT_GCJS'],
  ['工时定额编制','制造数据统筹管控','DEPT_GCJS'],
  // 动能供应
  ['动能供应与使用','动能供应','DEPT_YW'],
  // 设备设施保障
  ['设备设施事故处理','设备设施保障','DEPT_YW'],['设备设施备件','设备设施保障','DEPT_YW'],
  ['设备设施保养优化','设备设施保障','DEPT_YW'],
  // 设备设施规划
  ['设备设施计划策划','设备设施规划','DEPT_YW'],
  // 设备设施运维
  ['设备设施使用','设备设施运维','DEPT_YW'],['设备设施维护保养','设备设施运维','DEPT_YW'],
  ['设备设施维修','设备设施运维','DEPT_YW'],
  // 质量闭环
  ['不合格品控制','质量闭环','DEPT_ZLGL'],['工程MRB处置管理','质量闭环','DEPT_ZLGL'],
  ['质量逃逸','质量闭环','DEPT_ZLGL'],['交付文件的准备','质量闭环','DEPT_ZLGL'],
  // 质量策划
  ['产品检验策划','质量策划','DEPT_ZLGL'],
  // 质量执行
  ['首件检验','质量执行','DEPT_ZLGL'],['产品检验','质量执行','DEPT_ZLGL'],['印章管理','质量执行','DEPT_ZLGL'],
  ['顾客检验','质量执行','DEPT_ZLGL'],['适航检验','质量执行','DEPT_ZLGL'],['抽样检验','质量执行','DEPT_ZLGL'],
  ['无损检测质量控制','质量执行','DEPT_ZLGL'],['理化测试质量控制','质量执行','DEPT_ZLGL'],
  // 仓储与物流协同
  ['物流配置执行','仓储与物流协同','DEPT_WZBZ'],['器材紧急放行','仓储与物流协同','DEPT_WZBZ'],
  // 计划与排程
  ['订单执行','计划与排程','DEPT_XMGL'],['项目主进度计划','计划与排程','DEPT_XMGL'],
  ['项目临时需求计划','计划与排程','DEPT_XMGL'],['临时生产需求','计划与排程','DEPT_XMGL'],
  ['零件生产计划','计划与排程','DEPT_XMGL'],['零件用物料需求计划','计划与排程','DEPT_XMGL'],
  ['工序外协计划','计划与排程','DEPT_XMGL'],
  // 生产执行
  ['生产订单下达','生产执行','DEPT_FCCJ'],['生产订单关闭','生产执行','DEPT_FCCJ'],
  ['生产派工及执行','生产执行','DEPT_FCCJ'],['产品紧急放行','生产执行','DEPT_FCCJ'],
  ['产品交付','生产执行','DEPT_FCCJ'],['计划执行监控','生产执行','DEPT_FCCJ'],
  ['制造执行过程优化','生产执行','DEPT_FCCJ'],
  // 工装管理
  ['工装工具策划','工装策划与申请','DEPT_GCJS'],['工装申请管理','工装策划与申请','DEPT_GCJS'],
  ['工具申请','工装策划与申请','DEPT_GCJS'],['工装设计与更改','工装设计与制造','DEPT_GCJS'],
  ['专用工具设计与更改','工装设计与制造','DEPT_GCJS'],
  ['工艺装备验收','工装使用与维护','DEPT_FCCJ'],['工艺装备使用','工装使用与维护','DEPT_FCCJ'],
  ['工具现场管理','工装使用与维护','DEPT_FCCJ'],['工艺装备返工','工装使用与维护','DEPT_FCCJ'],
  ['工艺装备维护','工装使用与维护','DEPT_FCCJ'],['工艺装备定检','工装使用与维护','DEPT_FCCJ'],
  ['工装验证','工装验证与优化','DEPT_ZLGL'],['工装优化','工装验证与优化','DEPT_ZLGL'],
  ['工具验证','工装验证与优化','DEPT_ZLGL'],['工具试用与选型','工装验证与优化','DEPT_ZLGL'],
  // System processes
  ['统一门户','OA 协同办公能力','DEPT_XZRS'],['统一待办','OA 协同办公能力','DEPT_XZRS'],
  ['智慧流程','OA 协同办公能力','DEPT_XZRS'],['自定义表单','OA 协同办公能力','DEPT_XZRS'],
  ['权限安全','OA 协同办公能力','DEPT_XZRS'],['文档归档','OA 协同办公能力','DEPT_XZRS'],
  ['组织角色','OA 协同办公能力','DEPT_XZRS'],['移动协同','OA 协同办公能力','DEPT_XZRS'],
  ['系统集成','OA 协同办公能力','DEPT_XZRS'],
  ['MBOM','PLM 产品生命周期管理能力','DEPT_GCJS'],
  ['ECO (含ECN)','PLM 产品生命周期管理能力','DEPT_GCJS'],
  ['工程项目管理','PLM 产品生命周期管理能力','DEPT_GCJS'],
  ['MES主数据管理','MES 制造执行能力','DEPT_FCCJ'],['MES工艺管理','MES 制造执行能力','DEPT_FCCJ'],
  ['MES生产计划管理','MES 制造执行能力','DEPT_FCCJ'],['MES计划执行管理','MES 制造执行能力','DEPT_FCCJ'],
  ['MES质量管理','MES 制造执行能力','DEPT_FCCJ'],['MES仓储管理','MES 制造执行能力','DEPT_FCCJ'],
  ['MES设备管理','MES 制造执行能力','DEPT_FCCJ'],['MES设备数据采集','MES 制造执行能力','DEPT_FCCJ'],
  ['MES工装工具管理','MES 制造执行能力','DEPT_FCCJ'],['MES问题管理','MES 制造执行能力','DEPT_FCCJ'],
  ['MES生产管控','MES 制造执行能力','DEPT_FCCJ'],['MES监控看板','MES 制造执行能力','DEPT_FCCJ'],
  ['PS 项目管理','ERP 经营管理能力','DEPT_WZBZ'],['FI 财务会计','ERP 经营管理能力','DEPT_WZBZ'],
  ['CO 成本控制','ERP 经营管理能力','DEPT_WZBZ'],['PP 生产计划','ERP 经营管理能力','DEPT_WZBZ'],
  ['MM 物料管理','ERP 经营管理能力','DEPT_WZBZ'],['SD 销售分销','ERP 经营管理能力','DEPT_WZBZ'],
];
const procMap = {};
for (const [name, l2name, owner] of processList) {
  if (!exists('processes', 'name', name)) {
    db.prepare(`INSERT INTO processes (name, capability_id, owner_dept_id, status)
                VALUES (?, ?, ?, 'approved')`)
      .run(name, capL2[l2name], deptMap[owner]);
    procMap[name] = lastId();
  } else {
    procMap[name] = db.prepare('SELECT id FROM processes WHERE name=?').get(name).id;
  }
}
console.log(`  ${Object.keys(procMap).length} processes`);

// ── 6. Mappings (process → system) ─────────────────────
console.log('Seeding mappings...');
const mappingRules = {
  MES: [
    '关键工序控制','关键件的控制','关键特性KC控制','特殊过程控制','一般生产过程管理','工艺过程管控',
    '物料主数据维护','材料和外购件代用','特制件管控','MBOM编制',
    '动能供应与使用','设备设施事故处理','设备设施备件','设备设施保养优化','设备设施计划策划',
    '设备设施使用','设备设施维护保养','设备设施维修',
    '不合格品控制','工程MRB处置管理','质量逃逸','交付文件的准备','产品检验策划','首件检验',
    '产品检验','印章管理','顾客检验','适航检验','抽样检验','无损检测质量控制','理化测试质量控制',
    '物流配置执行','器材紧急放行','项目临时需求计划','临时生产需求','零件用物料需求计划',
    '生产派工及执行','产品紧急放行','产品交付','计划执行监控','制造执行过程优化',
    '工艺装备使用','工具现场管理','工艺装备返工','工艺装备维护','工艺装备定检',
    '工装验证','工具验证','工具试用与选型',
    'MES主数据管理','MES工艺管理','MES生产计划管理','MES计划执行管理','MES质量管理',
    'MES仓储管理','MES设备管理','MES设备数据采集','MES工装工具管理','MES问题管理','MES生产管控','MES监控看板',
  ],
  PLM: [
    '制造工艺文件管控','零件制造工艺文件管控','生产线规划','产能控制','零组件供应状态表编制',
    '工装工具策划','工装申请管理','工具申请','工装设计与更改','专用工具设计与更改','工艺装备验收',
    'MBOM','ECO (含ECN)','工程项目管理','工艺路线/规程管理',
  ],
  ERP: [
    '订单执行','项目主进度计划','工序外协计划',
    'PS 项目管理','FI 财务会计','CO 成本控制','PP 生产计划','MM 物料管理','SD 销售分销',
  ],
  OA: [
    '统一门户','统一待办','智慧流程','自定义表单','权限安全','文档归档','组织角色','移动协同','系统集成',
  ],
  'ERP+MES': ['零件生产计划','生产订单下达','生产订单关闭'],
  'PLM+MES': ['工时定额编制','工装优化'],
};

function mapSysShort(name) {
  const m = { ERP: 'ERP (用友 U8)', PLM: 'PLM (PLM供应商)', MES: 'MES (北京虎蜥)', OA: 'OA (华天动力)' };
  return m[name] || name;
}

let mapCount = 0;
for (const [sysKey, procNames] of Object.entries(mappingRules)) {
  const sysKeys = sysKey.split('+');
  const sysList = sysKeys.map(mapSysShort);

  for (const procName of procNames) {
    const pid = procMap[procName];
    if (!pid) continue;
    if (exists('mappings', 'process_id', pid)) continue;

    const ownerRow = db.prepare('SELECT owner_dept_id FROM processes WHERE id=?').get(pid);
    db.prepare(`INSERT INTO mappings (process_id, description, owner_dept_id, status)
                VALUES (?, ?, ?, 'published')`)
      .run(pid, `${procName} → ${sysKey}`, ownerRow.owner_dept_id);
    const mid = lastId();

    sysList.forEach((sysName, i) => {
      const sid = sysMap[sysName];
      if (sid) {
        db.prepare(`INSERT OR IGNORE INTO mapping_systems (mapping_id, system_id, system_role, sort_order)
                    VALUES (?, ?, ?, ?)`)
          .run(mid, sid, i === 0 ? 'primary' : 'secondary', i + 1);
      }
    });
    mapCount++;
  }
}
console.log(`  ${mapCount} mappings`);

// ── 7. Field Entries + Golden Source Identities ─────────
console.log('Seeding fields & golden sources...');
const fieldGroups = [
  { process: 'MBOM', fields: [
    { cn: '工序编码/名称', en: 'process_code_name', obj: '工艺路线', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: '工序唯一标识' },
    { cn: '工种资质要求', en: 'skill_cert_req', obj: '工艺路线', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES派工校验' },
    { cn: '额定准备/单件工时', en: 'std_setup_unit_hrs', obj: '工艺路线', type: '文本', consume: 'ERP (用友 U8)', sync: '批量', note: 'ERP成本核算消费' },
    { cn: '关联资源编码', en: 'resource_code', obj: '工艺资源', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: '设备/工装关联' },
    { cn: '工序类型', en: 'process_type', obj: '工艺路线', type: '枚举', consume: 'MES (北京虎蜥)', sync: '实时', note: '普通/检验/特殊/外协' },
    { cn: '前后置工序', en: 'prev_next_op', obj: '工艺路线', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: '工序顺序约束' },
    { cn: '铺层顺序号', en: 'ply_seq_no', obj: '铺层工艺', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES强校验' },
    { cn: '铺层方向', en: 'ply_orientation', obj: '铺层工艺', type: '枚举', consume: 'MES (北京虎蜥)', sync: '实时', note: '0/±45/90度' },
    { cn: '层数/厚度要求', en: 'layer_thickness', obj: '铺层工艺', type: '文本', consume: '质量管理部', sync: '实时', note: '质检消费' },
    { cn: '激光投影关联', en: 'laser_proj_ref', obj: '铺层工艺', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: '激光投影定位' },
    { cn: '材料规格号', en: 'material_spec_no', obj: '物料主数据', type: '编码', consume: 'ERP (用友 U8)', sync: '批量', note: 'ERP物料关联' },
    { cn: '铺层区域标识', en: 'ply_zone_id', obj: '铺层工艺', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: '分区铺层控制' },
    { cn: '升/降温速率', en: 'ramp_rate', obj: '固化工艺', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES实时比对' },
    { cn: '保温/保压点', en: 'dwell_point', obj: '固化工艺', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES实时比对' },
    { cn: '真空度/压力阶梯', en: 'vac_pressure_step', obj: '固化工艺', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES实时比对' },
    { cn: '标准曲线模板', en: 'std_curve_template', obj: '固化工艺', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES预警阈值' },
    { cn: '固化设备类型', en: 'cure_equip_type', obj: '固化工艺', type: '枚举', consume: 'MES (北京虎蜥)', sync: '实时', note: '热压罐/烘箱' },
    { cn: '最大允许偏差', en: 'max_allowable_dev', obj: '固化工艺', type: '文本', consume: '质量管理部', sync: '实时', note: '质检判定标准' },
    { cn: '检验特征点', en: 'inspection_point', obj: '质检规范', type: '文本', consume: '质量管理部', sync: '实时', note: '质检消费' },
    { cn: '标准值/公差', en: 'std_value_tolerance', obj: '质检规范', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: '自动判定' },
    { cn: '提检类型', en: 'inspection_type', obj: '质检规范', type: '枚举', consume: 'MES (北京虎蜥)', sync: '实时', note: '自检/专检/军检' },
    { cn: '检验工具/设备', en: 'inspection_tool', obj: '质检规范', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: 'MES校验' },
    { cn: '检验频次', en: 'inspection_freq', obj: '质检规范', type: '枚举', consume: '质量管理部', sync: '实时', note: '首件/过程抽检/完工全检' },
    { cn: '不合格品处置', en: 'nc_disposition', obj: '质检规范', type: '枚举', consume: '质量管理部', sync: '事件触发', note: '返工/让步接收/报废' },
  ]},
  { process: 'MBOM编制', fields: [
    { cn: '物料编码', en: 'item_code', obj: '物料主数据', type: '编码', consume: 'ERP (用友 U8), MES (北京虎蜥), PLM (PLM供应商)', sync: '批量', note: '设计件黄金源:PLM; 原材料黄金源:ERP-MM倾向' },
    { cn: '物料名称', en: 'item_name', obj: '物料主数据', type: '文本', consume: 'ERP (用友 U8), MES (北京虎蜥)', sync: '批量', note: '中文标准名称' },
    { cn: '规格', en: 'specification', obj: '物料主数据', type: '文本', consume: 'ERP (用友 U8), MES (北京虎蜥)', sync: '批量', note: '含牌号/供应状态' },
    { cn: '件号', en: 'part_number', obj: '物料主数据', type: '编码', consume: 'ERP (用友 U8), MES (北京虎蜥)', sync: '批量', note: '对外交付件号' },
    { cn: '版次/REV', en: 'revision', obj: '物料主数据', type: '编码', consume: 'ERP (用友 U8), MES (北京虎蜥), PLM (PLM供应商)', sync: '实时', note: 'A/B/C版次,独立字段' },
    { cn: '供应商/ASL', en: 'supplier_asl', obj: '物料主数据', type: '文本', consume: 'ERP (用友 U8)', sync: '批量', note: '合格供应商清单' },
  ]},
  { process: 'PP 生产计划', fields: [
    { cn: '生产订单号', en: 'production_order_no', obj: '生产订单', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: 'ERP下发MES' },
    { cn: '计划数量', en: 'planned_qty', obj: '生产订单', type: '文本', consume: 'MES (北京虎蜥)', sync: '实时', note: '' },
    { cn: '计划日期', en: 'planned_date', obj: '生产订单', type: '日期', consume: 'MES (北京虎蜥)', sync: '实时', note: '' },
    { cn: '工艺路线', en: 'routing_code', obj: '生产订单', type: '编码', consume: 'MES (北京虎蜥)', sync: '实时', note: '关联MBOM工艺' },
  ]},
];

let feCount = 0, fiCount = 0;
for (const { process, fields } of fieldGroups) {
  const pid = procMap[process];
  if (!pid) continue;
  const mapping = db.prepare('SELECT id FROM mappings WHERE process_id=? LIMIT 1').get(pid);
  if (!mapping) continue;

  for (const f of fields) {
    const existingFE = db.prepare('SELECT id FROM field_entries WHERE mapping_id=? AND field_name_cn=?').get(mapping.id, f.cn);
    let feId;
    if (!existingFE) {
      db.prepare(`INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`)
        .run(mapping.id, f.cn, f.en, f.obj, f.type, f.consume, f.sync, f.note);
      feId = lastId();
      feCount++;
    } else {
      feId = existingFE.id;
    }
    if (!exists('field_identities', 'field_entry_id', feId)) {
      db.prepare(`INSERT INTO field_identities (field_entry_id, candidate_systems, authoritative_system, maintain_dept_id, confirmed, note)
                  VALUES (?, ?, ?, ?, 1, ?)`)
        .run(feId, f.consume, f.consume.split(',')[0].trim(), deptMap['DEPT_GCJS'] || null,
             '黄金源认定 — 维护部门:工程技术部');
      fiCount++;
    }
  }
}
console.log(`  ${feCount} field entries, ${fiCount} golden source identities`);

// ── 8. Terms ────────────────────────────────────────────
console.log('Seeding terms...');
const terms = [
  { term: '黄金源', def: '某一字段或数据项的唯一权威来源系统', scope: '全系统' },
  { term: '主数据 (MDM)', def: '企业"通用语言" — 统一编码与标准属性,各系统的"身份证"', scope: '全系统' },
  { term: 'MBOM', def: '制造物料清单,由PLM一期能力承接', scope: 'PLM/MES/ERP' },
  { term: 'EBOM', def: '设计物料清单,设计结构表达', scope: 'PLM/ERP' },
  { term: 'ECO/ECN', def: '工程变更单/工程变更通知', scope: 'PLM/OA/ERP/MES' },
  { term: '铺层', def: '复合材料层叠铺放工艺', scope: 'MES/PLM' },
  { term: '固化', def: '复合材料热压固化成型工艺', scope: 'MES/PLM' },
  { term: '预浸料', def: '预先浸渍树脂的复合纤维材料', scope: 'WMS/MES/PLM' },
  { term: 'SFG', def: '半成品(Semi-Finished Good),需确认是否区分内部/外协半成品', scope: 'MES/ERP' },
  { term: 'ASL', def: '合格供应商清单(Approved Supplier List)', scope: 'ERP/供应链' },
  { term: 'NDT', def: '无损检测(Non-Destructive Testing)', scope: 'MES/质量' },
  { term: 'MRB', def: '材料审查委员会(Material Review Board)', scope: '质量/工程' },
  { term: '三单匹配', def: '采购订单/收货单/发票三方匹配', scope: 'ERP/WMS' },
  { term: '齐套性', def: '物料配套完整性检查', scope: 'MES/WMS' },
  { term: '适航追溯', def: '航空产品从材料到交付的全链路追溯', scope: '全系统' },
  { term: '偏离/超差', def: '超出设计或工艺规范允许范围的偏差', scope: '质量/工程' },
  { term: '归零', def: '质量问题根本原因消除与闭环', scope: '质量/工程' },
  { term: '构型状态', def: '产品在特定时刻的技术状态快照', scope: 'PLM/质量' },
  { term: '虚拟件', def: '非实物组件,用于工艺分组或BOM结构表达', scope: 'PLM/ERP' },
  { term: '工艺管理', def: '工艺路线、工序工步、定额和规程结构化管理,按PLM一期能力推进', scope: 'PLM/MES' },
];
let termCount = 0;
for (const t of terms) {
  if (!exists('terms', 'term', t.term)) {
    db.prepare(`INSERT INTO terms (term, definition, scope, status, created_by)
                VALUES (?, ?, ?, 'approved', ?)`)
      .run(t.term, t.def, t.scope, userMap['EMP0004']);
    termCount++;
  }
}
console.log(`  ${termCount} terms`);

// ── 9. Todos (action items) ─────────────────────────────
console.log('Seeding action items as todos...');
const todos = [
  { from: 'DEPT_XXH', to: 'DEPT_GCJS', type: 'terminology', content: 'Q1: SFG(半成品)是否需要细分为内部半成品和外协半成品?', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_WZBZ', type: 'general', content: 'Q1: SFG拆分 — 根据采购/库存/MES消耗场景输出典型业务样本', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_WZBZ', type: 'field_confirm', content: 'Q2: 预浸料有效期管理是否纳入WMS批次属性? 倾向:WMS批次属性+MES环境暴露记录', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_FCCJ', type: 'field_confirm', content: 'Q2: 预浸料有效期管理 — 输出批次字段和扫码节点', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_GCJS', type: 'general', content: 'Q3: 物料编码结构最终采用哪版? 20位含连字符方案待各系统供应商技术确认', urgency: 'medium', due: '2026-05-15' },
  { from: 'DEPT_XXH', to: 'DEPT_GCJS', type: 'general', content: 'Q4: 编码是否需要校验位(MOD11算法)? 需评估录入/导入/人工识别成本', urgency: 'medium', due: '2026-05-15' },
  { from: 'DEPT_XXH', to: 'DEPT_GCJS', type: 'gold_source', content: 'Q5 (已解决): 设计件物料主数据黄金源 — PLM为设计件黄金源,PLM上线前ERP+手工台账过渡', urgency: 'low', due: '2026-05-15' },
  { from: 'DEPT_XXH', to: 'DEPT_FCCJ', type: 'general', content: 'Q6: MBOM和工艺路线主写责任如何划分? 需确认PLM、ERP-PP、MES字段边界和版本生效规则', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_GCJS', type: 'general', content: 'Q6: MBOM工艺展开 — 需确认EBOM→MBOM转换责任和BOM表头字段表', urgency: 'high', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_XXH', type: 'general', content: 'Q7: 是否建设数据中台/集成总线? 先不决定最终架构,输出点对点/ESB/数据中台路线比较', urgency: 'medium', due: '2026-05-17' },
  { from: 'DEPT_XXH', to: 'DEPT_ZLGL', type: 'general', content: 'Q8: 适航追溯数据的存储和查询方案? 倾向统一追溯链,需确认质量记录/构型/偏离超差/批次归属', urgency: 'high', due: '2026-05-17' },
  { from: 'DEPT_GCJS', to: 'DEPT_GCJS', type: 'general', content: 'PLM供应商确认: 接口字段/实施周期/CAD工具适配范围/ERP与MES双向集成细节', urgency: 'medium', due: '2026-06-30' },
  { from: 'DEPT_GCJS', to: 'DEPT_GCJS', type: 'general', content: '工艺规程迁移: 3人专家合规审查组 + 8-10人数采组(4000人时/500人天) + 2人质量核验组', urgency: 'low', due: '2026-09-30' },
  { from: 'DEPT_XXH', to: 'DEPT_XZRS', type: 'general', content: '各接口卡补全主数据依赖和术语风险列 — 字段台账/黄金源/同步频率/失败重试/人工兜底', urgency: 'medium', due: '2026-05-30' },
  { from: 'DEPT_XXH', to: 'DEPT_XZRS', type: 'general', content: '各业务部门指定一名业务确认人(流程真实性)和一名数据确认人(字段/编码/主数据完整性)', urgency: 'high', due: '2026-05-17' },
];
let todoCount = 0;
for (const t of todos) {
  if (!db.prepare('SELECT 1 FROM todos WHERE content=?').get(t.content)) {
    db.prepare(`INSERT INTO todos (from_dept_id, to_dept_id, type, content, urgency, due_date, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
      .run(deptMap[t.from], deptMap[t.to], t.type, t.content, t.urgency, t.due);
    todoCount++;
  }
}
console.log(`  ${todoCount} todos`);

// ── 10. Interface mappings ──────────────────────────────
console.log('Seeding interface mappings...');
const interfaces = [
  { name: 'PLM→MDM:设计BOM发布接口', desc: '将设计态EBOM传递至一期MBOM/工艺管理能力,作为MBOM转换数据源。触发:工程发布。格式:REST API/WebService/JSON/XML。', owner: 'DEPT_GCJS', sys: ['PLM (PLM供应商)', 'MDM 主数据管理平台'] },
  { name: 'ERP-PP→MES:生产订单下发接口', desc: '下发生产订单至MES,驱动排程与执行。出站:生产订单号/物料编码/计划数量/计划日期/工艺路线。回传:完工数量/实际工时/质检结果', owner: 'DEPT_WZBZ', sys: ['ERP (用友 U8)', 'MES (北京虎蜥)'] },
  { name: 'MES→ERP:完工报工接口', desc: 'MES完工/工时/消耗/批次数据回传ERP进行成本核算和库存更新', owner: 'DEPT_FCCJ', sys: ['MES (北京虎蜥)', 'ERP (用友 U8)'] },
  { name: 'ERP-MM→MES:批次库存接口', desc: 'ERP传递批次/库存/有效期/出库时间至MES,支撑生产物料齐套校验', owner: 'DEPT_WZBZ', sys: ['ERP (用友 U8)', 'MES (北京虎蜥)'] },
  { name: 'OA↔PLM:ECO审批协同接口', desc: 'PLM发起ECO→OA推送审批/会签→OA回传审批结果→PLM生效→同步受影响对象至ERP/MES', owner: 'DEPT_GCJS', sys: ['OA (华天动力)', 'PLM (PLM供应商)'] },
];
let ifaceCount = 0;
for (const iface of interfaces) {
  if (exists('processes', 'name', iface.name)) {
    continue; // already seeded
  }
  db.prepare(`INSERT INTO processes (name, capability_id, owner_dept_id, status)
              VALUES (?, NULL, ?, 'approved')`)
    .run(iface.name, deptMap[iface.owner]);
  const ipid = lastId();
  db.prepare(`INSERT INTO mappings (process_id, description, owner_dept_id, status)
              VALUES (?, ?, ?, 'published')`)
    .run(ipid, iface.desc, deptMap[iface.owner]);
  const mid = lastId();
  iface.sys.forEach((sn, i) => {
    if (sysMap[sn]) {
      db.prepare(`INSERT OR IGNORE INTO mapping_systems (mapping_id, system_id, system_role, sort_order)
                  VALUES (?, ?, ?, ?)`)
        .run(mid, sysMap[sn], i === 0 ? 'primary' : 'secondary', i + 1);
    }
  });
  ifaceCount++;
}
console.log(`  ${ifaceCount} interface mappings`);

// ── Done ────────────────────────────────────────────────
console.log('\n=== Seed complete ===');
console.log(`Departments:  ${Object.keys(deptMap).length}`);
console.log(`Users:        ${Object.keys(userMap).length}`);
console.log(`Systems:      ${Object.keys(sysMap).length}`);
console.log(`Capabilities: ${Object.keys(capL1).length} L1 + ${Object.keys(capL2).length} L2`);
console.log(`Processes:    ${Object.keys(procMap).length}`);
console.log(`Mappings:     ${mapCount + ifaceCount}`);
console.log(`Fields:       ${feCount}`);
console.log(`Gold Sources: ${fiCount}`);
console.log(`Terms:        ${termCount}`);
console.log(`Todos:        ${todoCount}`);
console.log('\nDemo accounts (password: demo12345678):');
for (const u of users) {
  console.log(`  ${u.eno} / ${u.name} (${u.role})`);
}
