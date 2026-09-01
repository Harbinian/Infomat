# 用友 U8 存货档案数据库表关系与字段关系探查报告

> 报告日期：2026-09-01  
> 适用账套：`UFDATA_333_2025`  
> 探查方式：CHM 架构资料核读 + SQL Server 实时只读元数据与数据核对  
> 数据快照时间：2026-09-01 08:57:55（Asia/Shanghai）  
> 范围：存货档案、存货分类和与当前 `Ca_Inventory` 查询对象直接相关的对象；不包含采购、销售、库存等业务单据全表族。

## 1. 结论摘要

1. 当前账套的标准存货档案主表是 `dbo.Inventory`。该表有 257 个字段，主键为 `cInvCode`，当前有 6,533 条存货记录。
2. 当前账套的标准存货分类表是 `dbo.InventoryClass`。该表有 7 个字段，主键为 `cInvCCode`，当前有 146 条分类记录。`Inventory.cInvCCode → InventoryClass.cInvCCode` 是数据库中已声明的外键关系。
3. 用户查询的 `dbo.Ca_Inventory` **不是物理表，而是 38 字段视图**。当前有 6,533 条记录，与 `Inventory` 的 `cInvCode` 一一对齐；存货名称和分类编码也全部对齐。
4. `Ca_Inventory` 的定义当前不可通过本账号读取，且未返回依赖关系元数据。因此，报告只能确认它与 `Inventory`、`InventoryClass` 的**数据逻辑关系**，不能将其物理来源写成已确认事实。
5. CHM 中存在 38 字段物理表 `Ca_Inventory_Buffer`，但它与 `Ca_Inventory` 是不同对象。当前 `Ca_Inventory_Buffer` 有 6,140 条记录，比 `Ca_Inventory` 少 393 个 `cInvCode`；在两者均存在的记录中，另有 4 条名称、1 条分类编码不同。不能把 `Ca_Inventory` 当作该缓冲表的同义名称。
6. 当前存货档案使用了 88 个末级分类：9 个二级末级分类承载 1,717 条存货，79 个三级末级分类承载 4,816 条存货。分类树本身为 7 个一级分类、34 个二级分类、105 个三级分类。

## 2. 范围、证据与口径

### 2.1 资料来源

| 来源 | 已使用内容 | 作用 | 边界 |
|---|---|---|---|
| 用户提供的 `U8125 SchemaDoc.chm` | `Inventory Table`、`InventoryClass Table`、`Ca_Inventory_Buffer Table` 页面及索引说明 | 识别 U8 标准对象、字段名称、字段用途和历史结构 | CHM 是结构说明资料，不替代当前账套的实时元数据 |
| `UFDATA_333_2025` SQL Server | `sys.objects`、`sys.columns`、`sys.indexes`、`sys.foreign_keys`、`sys.sql_expression_dependencies` 和受限统计查询 | 核对对象类型、字段类型、约束、索引、记录数量和匹配结果 | 本次只读；未修改数据、结构、权限或视图定义 |

### 2.2 关系判定口径

| 关系类别 | 本报告的判定标准 | 可得结论 |
|---|---|---|
| 已声明关系 | SQL Server 外键、主键或唯一约束 | 可作为数据库强关系使用，但仍需留意约束是否可信 |
| 数据逻辑关系 | 以候选键连接后，记录覆盖和关键字段一致 | 可用于当前查询和核对；不等于已证明物理依赖或维护来源 |
| 字段同名关系 | 字段名称相同或相似 | 仅作为核对线索，不能单独作为映射或主数据结论 |
| 未确认关系 | 视图定义不可读、没有外键或没有字段级证据 | 必须保留“待确认”，不得按名称猜测来源 |

## 3. 对象身份与总体关系

### 3.1 当前对象清单

| 对象 | 实际类型 | 字段数 | 当前记录数 | 在本报告中的角色 |
|---|---:|---:|---:|---|
| `dbo.Inventory` | 物理表 | 257 | 6,533 | 标准存货档案主表 |
| `dbo.InventoryClass` | 物理表 | 7 | 146 | 标准存货分类主表 |
| `dbo.Ca_Inventory` | 视图 | 38 | 6,533 | 当前查询用的存货档案投影对象 |
| `dbo.Ca_Inventory_Buffer` | 物理表 | 38 | 6,140 | CHM 明确记录的成本相关中间对象；不是 `Ca_Inventory` 的同义对象 |
| `dbo.Inventory_extradefine` | 物理表 | 1 | 6,533 | 存货扩展定义侧表；当前按 `cInvCode` 与 `Inventory` 全量对齐 |

`Ca_Inventory` 创建于 2021-05-21。实时元数据将其标识为 `VIEW`，不是 `USER_TABLE`。因此，先前将其简称为“`Ca_Inventory` 表”仅是查询习惯，不代表其真实对象类型。

### 3.2 表、视图与字段关系图

```text
                         PK: InventoryClass.cInvCCode
             ┌───────────────────────────────────────────┐
             │ dbo.InventoryClass                         │
             │ 分类编码、分类名称、级次、末级标记、版本戳 │
             └───────────────────────────────────────────┘
                              ▲
                              │ 已声明外键：FK__Inventory__cInvC__6399A2AA
                              │ dbo.Inventory.cInvCCode → dbo.InventoryClass.cInvCCode
                              │
             ┌───────────────────────────────────────────┐
             │ dbo.Inventory                              │
             │ PK: cInvCode；标准存货档案主表             │
             └───────────────────────────────────────────┘
                ▲                         ▲
                │                         │
  当前数据全量对齐│                         │ 当前数据全量对齐
  cInvCode 6,533/6,533                     │ cInvCode 6,533/6,533
                │                         │
 ┌──────────────┴─────────────┐  ┌────────┴────────────────┐
 │ dbo.Ca_Inventory（视图）    │  │ dbo.Inventory_extradefine │
 │ 38 字段；定义当前不可读取   │  │ cInvCode 侧表             │
 └────────────────────────────┘  └─────────────────────────┘
                ▲
                │ 不能确认物理依赖；仅可比较当前数据
                │
 ┌──────────────┴─────────────┐
 │ dbo.Ca_Inventory_Buffer     │
 │ 38 字段物理表；CHM 有独立页面│
 └────────────────────────────┘
```

图中的“当前数据全量对齐”表示本次快照中的键值覆盖与指定字段一致，不表示 `Ca_Inventory` 一定从 `Inventory` 实时生成，也不表示 `Inventory_extradefine` 具有已声明外键。

## 4. 已声明的主键、外键与索引

### 4.1 关键约束

| 子对象.字段 | 关系 | 父对象.字段 | 元数据状态 | 说明 |
|---|---|---|---|---|
| `Inventory.cInvCode` | 主键 `aaaaaInventory_PK` | — | 唯一、非空 | 存货档案的稳定数据库标识；本次应作为跨表连接键 |
| `InventoryClass.cInvCCode` | 主键 `aaaaaInventoryClass_PK` | — | 唯一、非空 | 存货分类的稳定数据库标识 |
| `Inventory.cInvCCode` | 外键 `FK__Inventory__cInvC__6399A2AA` | `InventoryClass.cInvCCode` | 已启用；`is_not_trusted = 1` | 约束存在并启用，但 SQL Server 未将既有数据验证标记为可信；查询可连接，涉及结构维护时应先完成约束复核 |

### 4.2 与查询相关的索引证据

| 对象 | 索引 | 键字段 | 对关系分析的意义 |
|---|---|---|---|
| `Inventory` | `aaaaaInventory_PK` | `cInvCode` | 支持以存货编码唯一定位存货 |
| `Inventory` | `InventoryClassInventory` | `cInvCCode` | 支持按存货分类查询存货 |
| `Inventory` | `Index_Inventory_cInvcode_iid` | `cInvCode, iId` | `iId` 是 `Inventory` 中的辅助标识字段，但不是本报告推荐的跨对象主连接键 |
| `Inventory` | `idx_inventory_pubufts` | `pubufts` | 可用于技术变更增量识别；`timestamp` 在 SQL Server 中是行版本，不是业务时间 |
| `InventoryClass` | `aaaaaInventoryClass_PK` | `cInvCCode` | 支持按分类编码唯一定位分类 |
| `Ca_Inventory_Buffer` | `Idx_Ca_Inventory_Buffer` | `cInvCCode, cInvCode, iPartID` | 属于缓冲表自身的查询路径，不是 `Ca_Inventory` 视图的键约束 |
| `Ca_Inventory_Buffer` | `Idx_Ca_Inventory_Buffer_InvCode` | `cInvCode` | 支持按存货编码查询缓冲表 |

## 5. 标准存货档案与分类字段关系

### 5.1 `Inventory` 的关键字段

CHM 将 `Inventory` 说明为存货目录档案。当前账套中，下表字段与存货档案关系最直接；字段用途采用 CHM 的标准字段名称和说明，并以实时类型为准。

| 字段 | 当前类型/长度 | CHM 说明要点 | 关系与使用边界 |
|---|---|---|---|
| `cInvCode` | `nvarchar(60)`，非空 | 存货编码 | 主键。所有本报告中的跨对象存货连接均使用该字段。CHM 页面为 `nvarchar(20)`，当前账套已扩展为 60 字符。 |
| `cInvName` | `nvarchar(255)`，可空 | 存货名称 | 业务展示字段，不是唯一标识。 |
| `cInvAddCode` | `nvarchar(255)`，可空 | 存货代码/助记类编码 | 有普通非唯一索引；不能代替 `cInvCode` 建立唯一关系。 |
| `cInvStd` | `nvarchar(255)`，可空 | 规格型号 | 描述字段。 |
| `cInvCCode` | `nvarchar(12)`，可空 | 存货分类编码 | 指向 `InventoryClass.cInvCCode` 的已声明外键。 |
| `iInvRCost` | `float`，可空 | 计划价或参考成本字段 | 数值含义应按实际启用模块和业务规则确认；不能仅凭字段名认定成本口径。 |
| `cComUnitCode` | `nvarchar(35)`，可空 | 主计量单位编码 | 为“单位编码”字段。它与 `Ca_Inventory.cInvM_Unit` 的实际文字值没有直接相等关系。 |
| `cAssComUnitCode` | `nvarchar(35)`，可空 | 辅助计量单位编码 | 为“单位编码”字段。它与 `Ca_Inventory.cAssUnit` 的实际文字值没有直接相等关系。 |
| `iId` | `int`，可空 | CHM 中列为存货权限相关辅助标识 | 本次不作为 `Ca_Inventory.iPartID` 的映射字段。两字段在全部 6,533 条同编码记录中均不相等。 |
| `cModifyPerson` | `nvarchar(20)`，可空 | 修改人 | 技术审计字段；历史人员代码的业务身份需另按用户主数据核验。 |
| `dModifyDate` | `datetime`，可空 | 修改日期 | 技术审计字段；与 `pubufts` 的作用不同。 |
| `pubufts` | `timestamp(8)`，可空 | 时间戳 | SQL Server 行版本，用于识别行变更顺序；不表示业务发生时间。 |
| `bProxyForeign` | `bit`，非空 | 委外相关标识 | 标准表为 `bit`。`Ca_Inventory` 同名字段为 `int`，需要按对象类型读取。 |

### 5.2 `InventoryClass` 的完整字段关系

CHM 将 `InventoryClass` 说明为存货分类档案。当前字段数量、名称、类型和长度与 CHM 页面一致。

| 字段 | 当前类型/长度 | 关系与用途 |
|---|---|---|
| `cInvCCode` | `nvarchar(12)`，非空 | 主键；`Inventory.cInvCCode` 的外键目标；分类层级的编码基础。 |
| `cInvCName` | `nvarchar(100)`，可空 | 分类名称。`Ca_Inventory.cInvCName` 在当前数据中与其按 `cInvCCode` 全量一致。 |
| `iInvCGrade` | `tinyint`，非空 | 分类级次。当前有一级、二级、三级三种级次。 |
| `bInvCEnd` | `bit`，可空 | 是否末级分类。存货应连接到末级分类；本次 `Ca_Inventory` 使用的 88 个分类均为末级。 |
| `cEcoCode` | `nvarchar(2)`，可空 | 经济用途分类相关编码。具体业务口径需按启用模块确认。 |
| `cBarCode` | `nvarchar(30)`，可空 | 分类条码。 |
| `pubufts` | `timestamp(8)`，可空 | 分类行版本，不是业务时间。 |

### 5.3 当前分类层级与存货使用情况

| 分类级次 | 是否末级 | 分类数 | `Ca_Inventory` 使用的分类数 | 对应存货记录数 |
|---:|---|---:|---:|---:|
| 1 | 否 | 7 | 0 | 0 |
| 2 | 否 | 23 | 0 | 0 |
| 2 | 是 | 11 | 9 | 1,717 |
| 3 | 是 | 105 | 79 | 4,816 |

## 6. `Ca_Inventory` 视图的字段关系

### 6.1 当前视图字段分组

`Ca_Inventory` 共 38 个字段。该对象没有可读取的定义文本；下表仅描述可由字段元数据和当前数据证明的关系。

| 字段组 | 字段 | 当前类型 | 与标准对象的关系 | 结论等级 |
|---|---|---|---|---|
| 存货主键与基本描述 | `cInvCode`、`cInvName`、`cInvStd`、`cInvAddCode` | 文本 | 与 `Inventory` 同名；本次按 `cInvCode` 全量匹配，`cInvName` 全量一致 | 数据逻辑关系已验证 |
| 分类 | `cInvCCode`、`cInvCName` | `nvarchar(12)`、`nvarchar(100)` | `cInvCCode` 与 `Inventory` 全量一致；按该编码连接 `InventoryClass` 后，`cInvCName` 全量一致 | 数据逻辑关系已验证 |
| 成本 | `iInvRCost` | `float` | 与 `Inventory.iInvRCost` 同名同类型；本报告未以它判断成本业务口径 | 字段同名线索 |
| 单位展示 | `cInvM_Unit`、`cAssUnit` | `nvarchar(20)` | 当前值与 `Inventory.cComUnitCode`、`cAssComUnitCode` 的非空等值匹配数均为 0 | 不应按同义字段映射 |
| 自定义字段 | `cInvDefine1` 至 `cInvDefine16` | 文本、整数、浮点、日期时间 | 与 `Inventory` 存在同名自定义字段组；`Ca_Inventory` 中均为非空约束，标准表对应字段允许空值 | 结构相似；具体含义待业务确认 |
| 自由项值 | `Free1` 至 `Free10` | `nvarchar(20)` | 标准 `Inventory` 的 `bFree1` 至 `bFree10` 是“是否启用自由项”的布尔标识，不是同一类值字段 | 不可按名称后缀一一映射 |
| 辅助标识 | `iPartID` | `int` | 与 `Inventory.iId` 名称不同且全量不相等 | 已排除 `iPartID = iId` 映射 |
| 其他标识 | `caFlag`、`bProxyForeign` | `int` | `bProxyForeign` 与标准表同名但类型不同；`caFlag` 在标准表中未找到同名字段 | 具体来源和语义待确认 |

### 6.2 已验证的数据一致性

| 核对项 | 结果 | 含义 |
|---|---:|---|
| `Ca_Inventory` 记录数 | 6,533 | 视图当前返回的存货记录数 |
| `Inventory` 记录数 | 6,533 | 标准存货主表当前记录数 |
| 双方 `cInvCode` 缺失记录 | 0 / 0 | 两个对象在当前快照中按存货编码全量覆盖 |
| `cInvName` 不一致记录 | 0 | 当前名称投影一致 |
| `cInvCCode` 不一致记录 | 0 | 当前分类编码投影一致 |
| `Ca_Inventory` 无法匹配分类记录 | 0 | 每条视图记录均能匹配 `InventoryClass` |
| `cInvCName` 与分类表不一致记录 | 0 | 当前分类名称投影一致 |
| `iPartID` 与 `Inventory.iId` 不一致记录 | 6,533 | 两者不能作为同一标识使用 |

## 7. `Ca_Inventory_Buffer` 与 `Ca_Inventory` 的差异

### 7.1 CHM 与当前库的对象区分

CHM 中有独立的 `Ca_Inventory_Buffer Table` 页面，记录了 `cInvCode`、`cInvName`、`iPartID`、`cInvStd`、`iInvRCost`、`cInvCCode`、`cInvAddCode`、`cInvM_Unit`、`cAssUnit`、`cInvCName`、`Free1` 至 `Free10`、`cInvDefine1` 至 `cInvDefine16`、`caFlag`、`bProxyForeign` 等 38 个字段及索引。

当前库也存在同名的物理表 `Ca_Inventory_Buffer`，并有 38 个字段。但当前库的 `Ca_Inventory` 是视图，CHM 不含 `Ca_Inventory Table` 页面。两者字段形态相近，不能据此认定视图必然直接读取缓冲表。

### 7.2 当前数据差异

| 核对项 | 结果 | 解释 |
|---|---:|---|
| `Ca_Inventory_Buffer` 记录数 | 6,140 | 少于 `Ca_Inventory` 的 6,533 条 |
| 视图中存在、缓冲表中不存在的 `cInvCode` | 393 | 视图不等同于缓冲表的简单全量投影 |
| 缓冲表中存在、视图中不存在的 `cInvCode` | 0 | 当前缓冲表编码均可在视图中找到 |
| 同编码但名称不同 | 4 | 两对象的名称不能视为完全同步 |
| 同编码但分类编码不同 | 1 | 两对象的分类不能视为完全同步 |
| `Ca_Inventory_Buffer.iPartID` 类型 | `nvarchar(20)` | 与 `Ca_Inventory.iPartID` 的 `int` 类型不同 |

因此，涉及成本计算或缓冲数据时，应明确选择 `Ca_Inventory_Buffer`；涉及当前查询中的存货档案投影时，应使用 `Ca_Inventory`；二者不能互换。

## 8. `Inventory_extradefine` 的当前关系

`Inventory_extradefine` 是当前库中按 `cInvCode` 承接存货扩展定义的物理侧表。实时统计显示：

- `Inventory_extradefine` 有 6,533 条记录；
- 没有无法匹配 `Inventory.cInvCode` 的扩展定义记录；
- 没有缺少扩展定义记录的 `Inventory` 存货；
- 未返回重复 `cInvCode` 分组。

这说明该侧表在当前快照中与 `Inventory` 以 `cInvCode` 一对一对齐。当前关系查询未发现它与 `Inventory` 之间的已声明外键，因此该结论属于数据逻辑关系，不应写成数据库强制关系。

## 9. CHM 资料与实时结构的差异

| 对象/字段 | CHM 资料 | 当前账套 | 处理口径 |
|---|---|---|---|
| `Inventory.cInvCode` | `nvarchar(20)` | `nvarchar(60)` | 以当前库 60 字符为准；CHM 用于理解标准字段用途。 |
| `InventoryClass` | 7 字段 | 7 字段 | 当前名称、类型和长度与 CHM 页面一致。 |
| `Ca_Inventory_Buffer.cInvCode` | `nvarchar(20)` | `nvarchar(60)` | 当前缓冲表已扩展字段长度。 |
| `Ca_Inventory` | CHM 未找到该对象页面 | 当前为 38 字段视图 | 仅以实时元数据和数据核对描述；不从 `Ca_Inventory_Buffer` 反推定义。 |
| `Inventory.iId` / `Ca_Inventory.iPartID` | 分别为不同字段 | 当前同编码记录全量不相等 | 不建立等值字段映射。 |

## 10. 使用建议与待确认事项

### 10.1 可直接采用的查询关系

```sql
SELECT
    i.cInvCode,
    i.cInvName,
    i.cInvStd,
    i.cInvCCode,
    ic.cInvCName,
    ic.iInvCGrade,
    ic.bInvCEnd
FROM dbo.Inventory AS i
LEFT JOIN dbo.InventoryClass AS ic
    ON ic.cInvCCode = i.cInvCCode;
```

需要使用当前 `Ca_Inventory` 投影时，连接键仍应使用 `cInvCode`；需要补充分组名称时，优先使用 `cInvCCode → InventoryClass.cInvCCode`，不要把 `cInvCName` 当作连接键。

### 10.2 待确认事项

| 事项 | 当前证据 | 需要的确认或补充证据 | 关闭条件 |
|---|---|---|---|
| `Ca_Inventory` 的物理定义与依赖对象 | 对象类型为视图；定义文本和依赖列表未返回；对象未标记为加密 | 由数据库管理员授予最小范围的 `VIEW DEFINITION` 或提供受控视图脚本 | 可读取 `CREATE VIEW` 文本并核验引用对象 |
| `Ca_Inventory.iPartID` 的来源和业务含义 | 与 `Inventory.iId` 全量不相等；缓冲表同名字段类型不同 | 成本模块设计说明、视图定义或字段维护说明 | 明确来源对象、生成规则和更新责任 |
| `cInvM_Unit`、`cAssUnit` 的单位来源 | 与标准单位编码字段无非空等值匹配 | 单位档案、视图定义或业务规则 | 明确文本单位与单位编码的转换或引用关系 |
| `Free1` 至 `Free10` 的取值含义 | 与 `Inventory.bFree1` 至 `bFree10` 不是同一类字段 | 自由项设置和成本模块字段说明 | 明确每个值字段的取值来源和启用条件 |
| `caFlag`、视图中的 `bProxyForeign` 类型变化 | 标准表无 `caFlag`；同名 `bProxyForeign` 的类型由 `bit` 变为 `int` | 视图定义和成本模块字段说明 | 明确值域、语义和转换规则 |

## 11. 复核方式与边界说明

本报告的事实可通过以下只读核对复现：

1. 在 `sys.objects` 中确认 `Ca_Inventory` 的对象类型为 `VIEW`，并确认 `Inventory`、`InventoryClass`、`Ca_Inventory_Buffer` 为 `USER_TABLE`。
2. 在 `sys.key_constraints`、`sys.indexes` 和 `sys.foreign_keys` 中核对 `cInvCode` 主键、`cInvCCode` 主键和外键 `FK__Inventory__cInvC__6399A2AA`。
3. 以 `cInvCode` 连接 `Ca_Inventory` 与 `Inventory`，核对记录覆盖、名称和分类编码。
4. 以 `cInvCCode` 连接 `Inventory` 或 `Ca_Inventory` 与 `InventoryClass`，核对分类编码、名称、级次和末级标记。
5. 以 `cInvCode` 比较 `Ca_Inventory` 与 `Ca_Inventory_Buffer`，核对记录覆盖、名称与分类差异。

本报告只说明当前数据库中的对象结构、字段关系和数据对齐结果。它不确认存货业务的维护部门、权威录入位置、成本口径、自由项业务定义或跨系统主数据责任；这些事项需要由业务部门、U8 管理员和成本模块维护人员依据制度、配置和实际操作记录确认。
