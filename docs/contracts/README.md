# docs/contracts 说明

> 状态：自动化校验合同目录  
> 生效日期：2026-06-10  
> 范围：脚本读取的结构化规则，不作为业务真源正文。

本目录保存仓库级校验脚本使用的合同文件。合同文件用于约束脚本如何检查流程映射、部门桑基图、PMO 驾驶舱和组织口径，不替代 `docs/norms/` 或 `docs/organization/` 中的业务真源。

## 1. 当前合同

| 文件 | 使用方 | 作用 |
|---|---|---|
| `dcm-bbm-contract.json` | `scripts/check-dcm-bbm.mjs` | 定义 DCM/BBM 质检的路径、术语、允许系统、交付物命名、表头、证据类型和 HTML 检查规则 |

## 2. 修改规则

1. 修改合同前先确认对应脚本确实读取该字段。
2. 修改部门清单或域映射时，必须先核对 `docs/organization/组织架构和部门职责.md`。
3. 修改交付物命名、表头、证据类型或 HTML 规则后，运行：

```powershell
node scripts/check-dcm-bbm.mjs --no-fail
```

4. 合同文件可以表达检查规则，但不要在这里新增流程、部门职责或业务行为正文。

## 3. 与其他目录的关系

- `docs/norms/`：被检查的标准映射和部门桑基图。
- `pmo/procedure-management/dashboard.html`：被检查的 PMO 展示页。
- `docs/organization/组织架构和部门职责.md`：部门与域映射真源。
- `docs/reports/`：保存检查结果、缺口审计和整改记录。
