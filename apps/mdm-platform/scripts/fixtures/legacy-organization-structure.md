# Legacy organization fixture

仅用于历史SQLite兼容及隔离测试。以下为旧实现已保存的固定组织标识和岗位编码，不代表当前任命、汇报关系或业务权威。不得用于正式开户或自动同步。

| Historical source label | Code | Mnemonic | Parent |
| --- | --- | --- | --- |
| 沈阳昌兴复材航空科技有限责任公司 | OU-COM-CXF | CXF | |
| 工程技术部（直辖） | OU-DEP-ENG | ENG | OU-COM-CXF |
| 质量管理部（直辖） | OU-DEP-QMS | QMS | OU-COM-CXF |
| 财务部（直辖） | OU-DEP-FIN | FIN | OU-COM-CXF |
| 行政人事部 | OU-DEP-AHR | AHR | OU-COM-CXF |
| 经营发展部 | OU-DEP-BDV | BDV | OU-COM-CXF |
| 物资保障部 | OU-DEP-MAT | MAT | OU-COM-CXF |
| 项目管理部 | OU-DEP-PMO | PMO | OU-COM-CXF |
| 复材车间（一、二车间） | OU-DEP-CMP | CMP | OU-COM-CXF |
| 运维安环部 | OU-DEP-EHS | EHS | OU-COM-CXF |
| 总经理办公室 | OU-OFC-CXF-CEO | CEO | OU-COM-CXF |
| 经营副总办公室 | OU-OFC-CXF-BVP | BVP | OU-COM-CXF |
| 生产副总办公室 | OU-OFC-CXF-MVP | MVP | OU-COM-CXF |

历史说明文字（测试保留原文）：经理办公室当前建制；每个经理办公室当前先保留一个主岗位和一名人员；经理办公室只承载领导岗位及其配套人员，不作为部门上级；分管关系在领导层职责中表达。

历史技术编码示例：公司办公室`OU-OFC-CXF-CEO`，部门办公室`OU-OFC-ENG-GEN`，岗位编码`POS-CXF-CEO`、`POS-CXF-BVP`、`POS-CXF-MVP`；不允许出现孤立的 `OU-OFC-CEO`。
