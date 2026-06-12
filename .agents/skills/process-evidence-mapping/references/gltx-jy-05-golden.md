# GLTX-JY-05 Golden Example

Use this compact example when auditing or generating A1 rows from unstructured procedure text.

Source: `docs/norms/经营发展部业务资料/管理体系程序文件/GLTX-JY-05-D公司月度绩效考核方案.docx`

## Why This Example Matters

The source does not describe the process as a clean workflow. Evidence is scattered across clause text, responsibility descriptions, formulas, tables, and attachment/signature fields. Normalize by concrete source object, not by heading or literal phrase.

## Evidence Objects

### 经营发展部绩效评分表

- Clause anchor: `GLTX-JY-05-D §5.4.1`
- Source wording: 经营发展部绩效评分表由经营发展部根据当月重点任务及行动项完成情况编制，报分管领导审批后执行。
- Object chain: `经营发展部编制 -> 分管领导审批 -> 执行`
- Mapping consequence: approval exists; do not write `无审批`.

### 工作任务调整申请单

- Clause anchor: `GLTX-JY-05-D §5.4.4`
- Form anchor: `GLTX-JY-05-01-A 部第_月工作任务调整申请单`
- Source wording: 各部门填写申请单；申请单经部门统一汇总后提交；部门主管领导初审；经营发展部和项目管理部评估；最终报分管领导审批。
- Form fields include: `编制`, `部门领导`, `主管部门意见`, `分管领导意见`.
- Object chain: `申请部门填写/汇总提交 -> 部门主管领导初审 -> 经营发展部/项目管理部评估 -> 分管领导审批`
- Mapping consequence: this is not a single-person approval chain; generic `各执行部门` and `分管副总经理` are not valid input/output departments unless the row also shows controlled transfer of the application object.

### 公司月度综合打分表

- Clause anchor: `GLTX-JY-05-D §5.4.3`
- Table anchor: table with columns `部门`, `项目管理维度打分`, `行动项打分`, `重点任务打分`, `总分`.
- Signature fields: `编制`, `财务核对`, `分管领导审核`, `总经理批准`.
- Source wording: 公司月度综合打分表由经营发展部部长编制，财务部部长校对，分管领导审核，总经理批准实施。
- Object chain: `经营发展部部长编制 -> 财务部部长校对 -> 分管领导审核 -> 总经理批准实施`
- Mapping consequence: `汇总核算月度绩效结果` is an abstraction of this table. It must name `公司月度综合打分表` as the source object, use multi-node approval, and must not put `经营发展部部长` in `输出目标部门`.

## Regression Expectations

For row `JY-L3-04-A04`:

- Reject `审批类型=单人审批`.
- Reject `输出目标部门=经营发展部部长`.
- Reject a row that cites `GLTX-JY-05-D §5.4` but does not visibly name `公司月度综合打分表` or its object chain.
- Prefer wording such as `编制/核算公司月度综合打分表` over generic `汇总核算月度绩效结果`, unless the generic wording is explicitly anchored in `备注` or `核验提醒`.

For row `JY-L3-04-A05`:

- Do not infer result notification to `公司各部门` unless source evidence shows notice, issuance, publishing, distribution, receipt, or another controlled transfer of the result object.
- If only a post-approval implementation/result state is visible, write `未见受控传递证据，待补` rather than a confirmed output department.
