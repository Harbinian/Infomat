# MDM 数据收集与评审模块设计

> 编制日期：2026-05-11
> 定位：MDM 底座 V1 数据收集与评审工具，独立部署
> 适用范围：各部门报送人、信息化项目组（汇总审核）
> 最终输出：Excel 导出字段台账 + 黄金源矩阵 + 术语冲突台账，接 Infomat 暂不考虑

---

## 一、系统定位与形态

- **形态**：独立 Web 应用（HTML + Express.js + SQLite）
- **部署**：独立端口 3000，前端直连后端 API
- **用户**：各部门报送人、部門负责人、数据 owner、信息化项目组
- **V1 自建用户体系**，不接 OA、不接 MDM 组织主数据

---

## 二、视觉风格

- 参照 `docs/Demo/信息化系统应用与集成说明会.html` 的 CSS 视觉语言
- 主色：深蓝 `#0f2a5e`，强调蓝 `#1a56db`
- 卡片式布局，表格 hover 高亮
- 顶部 Tab 导航（`.tb` / `.tb.on`）
- 冲突分级色：红色（阻塞）/ 橙色（warn 挂起）/ 绿色（通过）
- **动画**：页面切换淡入、卡片 hover 上浮、提交成功 toast 弹出、冲突项闪烁高亮、待办到期脉冲提醒、甘特图节点脉冲

---

## 三、技术架构

```
mdm-collector/
├── server/
│   ├── index.js           # Express 入口，端口 3000
│   ├── db.js              # SQLite 初始化，建表语句
│   └── routes/
│       ├── org.js         # 组织架构（部门/人员/岗位）CRUD
│       ├── systems.js     # 系统列表 CRUD
│       ├── capabilities.js # 业务能力 CRUD
│       ├── mappings.js     # 映射 CRUD + 审批流
│       ├── fieldEntries.js # 字段台账 CRUD
│       ├── todos.js       # 跨部门待办
│       ├── conflicts.js   # 冲突管理
│       ├── terminology.js  # 术语词典 CRUD + 审核流
│       ├── versions.js    # 版本记录查询
│       └── export.js      # Excel 导出
├── public/
│   ├── index.html         # 主界面（单文件 HTML）
│   └── template.xlsx      # Excel 导入模板
└── data/
    └── collector.db       # SQLite 数据文件
```

**依赖**：`express`, `better-sqlite3`, `exceljs`

---

## 四、数据模型

### 4.1 组织架构

```sql
departments { id, name, code, parent_id, manager_user_id, created_at }
users { id, name, employee_no, department_id, post, role: 'submitter|owner|reviewer|admin', created_at }
```

### 4.2 业务能力与流程

```sql
capabilities { id, name, level, owner_dept_id, created_at }
processes { id, name, capability_id, owner_dept_id, created_at }
systems { id, name, dept_id }
```

### 4.3 映射与审批流

```sql
mappings {
  id, process_id, system_id,
  status: 'draft|submitted|dept_reviewed|cross_confirmed|fields_confirmed|final_reviewed|published',
  submitted_by, submitted_at,
  reviewed_by, reviewed_at,
  current_step, // 当前审批节点
  created_at, updated_at
}
```

**审批节点**：

| step | 节点 | 处理人 | 通过条件 |
|-----|------|-------|---------|
| 1 | 提交 | 报送人 | 必填项完整 |
| 2 | 部门内审 | 部门负责人 | 本部门映射无误 |
| 3 | 跨部门确认 | 关联部门负责人 | 字段口径一致，无 error 冲突 |
| 4 | 字段台账确认 | 数据 owner | 黄金源已明确 |
| 5 | 信息化项目组终审 | 项目组 | 全链路无阻塞冲突 |

### 4.4 字段台账

```sql
field_entries {
  id, mapping_id,
  field_name_cn, field_name_en,
  data_object, field_type,
  gold_source, maintain_dept, consume_systems, sync_mode,
  note,
  status: 'draft|submitted|confirmed|conflicted',
  submitted_by, submitted_at,
  confirmed_by, confirmed_at
}
```

### 4.5 黄金源矩阵

```sql
gold_source_matrix {
  id, field_entry_id,
  confirmed: bool, confirmed_by, confirmed_at, note
}
```

### 4.6 术语词典

```sql
terms {
  id, term, definition, scope, forbidden,
  status: 'pending|approved|rejected',
  created_by, created_at,
  approved_by, approved_at
}
```

### 4.7 冲突管理

```sql
term_conflicts {
  id, term, dept_a, dept_a_meaning,
  dept_b, dept_b_meaning,
  severity: 'warn|error',
  status: 'pending|resolved|rejected',
  resolution, resolved_by, resolved_at, created_at
}

field_conflicts {
  id, field_entry_id,
  submitter_a, value_a, dept_a,
  submitter_b, value_b, dept_b,
  severity: 'warn|error',
  status: 'pending|resolved|rejected',
  resolution, resolved_by, resolved_at, created_at
}
```

### 4.8 跨部门待办

```sql
todos {
  id, from_dept_id, to_dept_id,
  type: 'field_confirm|gold_source|terminology|general',
  related_mapping_id, related_field_id,
  content, due_date,
  status: 'pending|done|overdue',
  created_at, done_at
}
```

### 4.9 版本记录

```sql
version_log {
  id, entity_type, entity_id,
  field_name, old_value, new_value,
  operation: 'create|update|delete',
  operated_by, operated_at
}
```

---

## 五、精细化表单模板

每张报送表单按列定义责任人 + 填写说明：

| 列 | 字段 | 责任人角色 | 填写说明 |
|---|-----|----------|---------|
| A | 业务能力 | 报送人 | 选择已有能力或新增，二级能力需标注 |
| B | 业务流程名称 | 报送人 | 动词+名词结构，如"编制MBOM"、"审批ECO" |
| C | 流程描述 | 报送人 | 1-2句话说明流程目的和起止 |
| D | 涉及应用系统 | 报送人 | 从系统列表选择，主/辅系统标注 |
| E | 涉及数据对象 | 报送人 | 如物料、BOM、工装、批次 |
| F | 对应字段（字段名） | 数据 owner | 如"物料编码"、"工艺规范版本" |
| G | 字段类型 | 数据 owner | 文本/编码/日期/枚举/附件 |
| H | 黄金源系统 | 数据 owner | 唯一权威源 |
| I | 维护部门 | 数据 owner | 谁负责维护该字段内容 |
| J | 消费系统 | 数据 owner | 哪些系统只读引用 |
| K | 同步方式 | 数据 owner | 实时/批量/人工导入/事件触发 |
| L | 字段说明/备注 | 报送人 | 口径、限制、示例、不确定项标注 |

**列权限联动**：
- 报送人仅可编辑 A-E 列
- 数据 owner 收到待办后编辑 F-K 列
- 信息化项目组可编辑所有列并进行终审

---

## 六、功能模块

### 6.1 统计看板

- 各部门提交流程数
- 待办数（含到期未完成数）
- 冲突数（error/warn 分级）
- 字段台账完成率
- 报送进度甘特图（见 6.9）
- 数据质量评分（各映射完整性 × 一致性 × 冲突率综合得分）

### 6.2 数据报送

**表单录入**：
- 选择/新增业务能力 → 新增业务流程 → 关联应用系统
- 每条映射填写字段台账信息
- 表单列级权限控制（按 第五章）

**Excel 批量导入**：
- 下载标准模板（表头含填写说明）
- 批量上传，校验格式后预览确认
- 冲突字段自动标红提示

### 6.3 审批流

- 提交 → 部门内审 → 跨部门确认 → 字段台账确认 → 终审
- **驳回**：填写意见，报送人修改后重新提交，被驳回次数记入统计
- **error 冲突拦截**：直接阻止进入下一节点，需解决后继续
- **warn 冲突挂起**：挂起但不阻塞，流转到汇总台统一处理
- 每节点审核记录留痕（审核人、时间、意见）

### 6.4 跨部门待办

- 给任意部门创建待办（补充字段、确认术语、确认黄金源等）
- 待办推送到对应部门的看板
- 到期前脉冲提醒，超期标红

### 6.5 冲突管理台

- 术语冲突台账（severity 分级）
- 字段冲突台账（同一字段多方填写不一致）
- 驳回补正或标记挂起
- 所有冲突状态可跟踪

### 6.6 汇总审核台（信息化项目组视角）

- 全量映射列表 + 状态筛选
- 每条映射关联的字段台账 + 黄金源矩阵
- 可直接编辑任意字段
- 一键终审发布

### 6.7 术语词典

- 管理员维护术语表（术语名、定义、适用场景、禁用场景）
- 报送人填写时实时提示：术语是否已在词典中，未收录标红提醒
- 新增术语需信息化项目组审批后生效
- 术语审核流程：新增 → 审批 → 生效/驳回

### 6.8 冲突对比视图

- 同一字段被多方填写不同口径时，自动触发冲突对比
- 界面并排展示：填写人、填写内容、填写时间，差异高亮
- 填写说明和示例同步展示
- 仲裁后可一键采纳某方填写或强制覆盖

### 6.9 报送进度甘特图

- 各部门映射提交流程时间线可视化
- 横轴时间，竖轴部门/流程
- 显示：提交截止、审核节点、终审完成
- 正常绿色，被驳回橙色，超时/阻塞红色脉冲标记
- 点击节点展开详情（对应映射、当前状态、责任人）

### 6.10 版本记录 / 变更溯源

- 每条映射和字段记录全量修改历史
- 修改日志：操作人、时间、修改字段、旧值→新值、操作类型
- 每条记录显示"已修订 N 次"，点击展开历史时间线
- 可回滚到指定历史版本（二次确认）

### 6.11 导出

- 一键导出 Excel：字段台账 + 黄金源矩阵 + 术语冲突台账
- 导出格式供手工台账使用

---

## 七、前置数据初始化

### 7.1 组织架构

- 管理员手工添加或 **Excel 模板批量导入**
- 数据：部门（编码/名称/上级部门/负责人）、人员（工号/姓名/部门/岗位）、角色

### 7.2 系统列表

- 管理员维护应用系统基础数据

### 7.3 术语词典

- 信息化项目组初始化 V0.1（从 MDM 方案中的优先治理术语导入）
- 持续追加审批

---

## 八、Spec 自检

- [ ] 所有功能模块有对应数据模型支撑
- [ ] 审批流各节点角色明确，不存在模糊依赖
- [ ] 精细化表单模板列级权限有技术实现路径
- [ ] 冲突拦截机制（error/warn）逻辑闭环
- [ ] 术语词典与报送表单实时联动
- [ ] 版本记录可支持完整变更溯源
- [ ] 甘特图数据来源与审批流状态联动
- [ ] 导出 Excel 格式与字段台账方案一致
- [ ] 无外部系统强依赖（V1 自建用户体系）
