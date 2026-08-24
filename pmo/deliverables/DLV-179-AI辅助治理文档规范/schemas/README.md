# 结构规则快照说明

## 一、快照定位

本目录保存DLV-179 V0.1随包交付的结构规则快照。快照复制日期为2026-08-24，仓库内原路径仍是真源。

| 快照文件 | 仓库真源 | 用途 |
| --- | --- | --- |
| `document-structured-output.schema.json` | `docs/contracts/document-structured-output.schema.json` | 库外AI生成文档证据整理候选时的机器结构规则 |
| `document-structured-output-schema.md` | `docs/contracts/document-structured-output-schema.md` | 文档结构化v2的人读说明 |
| `process-governance-v6.schema.json` | `docs/contracts/process-governance-v6.schema.json` | 3001当前单流程v6规则，用于理解后续承接和校验边界 |

## 二、选择规则

### 材料整理和库外AI输出

默认使用`document-structured-output-v2`。AI可以输出流程、行为、角色候选、判断分支、跨部门候选、表单字段、证据和待确认问题。自动抽取只能形成待复核候选；AI不得生成正式`structure_block_projection`。

### 进入3001后的单流程编制

3001当前使用`process-governance-v6`。一份v6文件只有一个流程，跨部门动作仍是业务行为，先后和返回使用普通流程关系，数据传递使用数据对象与行为关系。v6不保存独立交接对象、审核状态、批准标记、评审意见或图坐标。

库外AI不需要直接生成v6。推荐先生成文档结构化v2候选，经人工核对后导入3001，由3001在页面内存中迁移、校验和下载v6。

## 三、禁止混写

- 不得在同一JSON中混写`document-structured-output-v2`和`process-governance-v6`顶层字段。
- 不得把文档结构化v2的`cross_dept_handoffs[]`直接复制到v6。
- 不得把AI复核意见、部门核对记录或PMO行动项写入业务JSON。
- 不得向v6添加v7生命周期字段。
- 不得把v6描述为可直接导入当前3000。

## 四、摘要核对

交接时以`08-来源与版本追溯.md`和本包`SHA256SUMS.txt`记录的摘要为准。摘要不一致表示文件内容已经变化，应停止使用并重新取得完整规格包。
