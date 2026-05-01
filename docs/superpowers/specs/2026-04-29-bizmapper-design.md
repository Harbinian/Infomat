# 业务关系提取工具 (BizMapper) 设计方案

## 概述

从 PNG 业务流程图中提取业务能力、L3流程、应用系统的映射关系，生成 Excel 映射表和 Infomat 可用的 JSON 结构。

## 输入

- **格式**：PNG 图片
- **内容**：三列布局的业务流程图
  - 列1：业务能力（一级）
  - 列2：业务流程（二级）
  - 列3：应用系统（三级）
- **连线**：直线、无箭头、只跨相邻列（1-2 或 2-3）
- **特殊**：列可能被拆分（1-2-3-2-1 结构）

## 输出

### 1. Excel 映射表

| 一级业务能力 | 二级业务能力 | 业务流程 | 应用系统 |
|-------------|-------------|--------|---------- |
| 工艺策划    | 工艺与制造方案策划 | 工艺网络计划制定 | 三维仿真工具 |
| ...         | ...         | ...    | ...      |

- 一级/二级业务能力列：相同值合并单元格
- 应用系统列：不确定时留空
- 表头样式：深蓝色背景、白色字体
- 每个一级业务能力用不同背景色区分

### 2. JSON 结构（供 Infomat 直接使用）

```json
{
  "capabilities": [
    { "name": "工艺策划", "l3": ["工艺与制造方案策划", "生产线规划与管控", "制造过程风险分析"] },
    { "name": "工艺验证与改进管理", "l3": ["工艺技术实施与管控", "工艺优化与总结提升"] },
    { "name": "工艺设计", "l3": ["工艺生产过程管控", "工艺文件编制与管控", "制造数据统筹管控", "物料及特制件管控"] }
  ],
  "systems": [
    { "id": "s1", "name": "三维仿真工具" },
    { "id": "s2", "name": "产能管理系统" },
    { "id": "s3", "name": "CPM" },
    { "id": "s4", "name": "CAPP" },
    { "id": "s5", "name": "MES" },
    { "id": "s6", "name": "三维工艺" },
    { "id": "s7", "name": "PDM（BOM管理）" },
    { "id": "s8", "name": "用友U8" }
  ],
  "connections": [
    { "capName": "工艺策划", "procName": "工艺网络计划制定", "sysId": "s1" }
  ]
}
```

## 工作流程

```
Step 1: 用户提供 PNG 图片路径
Step 2: 调用 MiniMax Vision API 分析图片
        - 识别三列节点及其文字
        - 检测相邻列之间的连线关系
        - 处理 1-2-3-2-1 拆分列情况
Step 3: 解析 API 返回，提取四列字段
Step 4: 生成美化 Excel 文件
Step 5: 用户审核并调整 Excel
Step 6: 读取调整后的 Excel，转换为 JSON
Step 7: 输出 JSON 文件
```

## 技术方案

### 环境要求
- Python 3.8+
- 依赖库：openpyxl、pandas
- MiniMax API（通过 minimax-coding-plan-mcp 调用）

### 核心函数

```python
def analyze_diagram(image_path: str) -> dict:
    """调用 MiniMax API 分析图片，返回结构化数据"""

def extract_relations(analysis_result: dict) -> list:
    """从分析结果提取连线关系"""

def generate_excel(relations: list, output_path: str):
    """生成美化 Excel 映射表"""

def excel_to_json(excel_path: str) -> dict:
    """读取 Excel 转换为 Infomat JSON 格式"""

def save_json(data: dict, output_path: str):
    """保存 JSON 文件"""
```

### MiniMax API 调用

使用 minimax-coding-plan-mcp 的 vision 工具分析图片。

### 1-2-3-2-1 处理逻辑

当检测到多列时：
1. 识别实际的列分组（列1+列4 属于业务能力，列2+列5 属于L3流程，列3 属于应用系统）
2. 同一分组的节点合并
3. 连线关系按实际列位置匹配

### 不确定情况处理

- 连线被遮挡或重叠：该关系输出时应用系统列留空
- 节点文字模糊：根据上下文推断，标记为"待确认"
- 汇总说明哪些字段需人工核对

## 文件结构

```
E:\CA001\Infomat\
├── bizmapper.py          # 主程序
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-29-bizmapper-design.md
└── output/
    ├── 映射表_20260429.xlsx
    └── infomat_data_20260429.json
```

## 风险与边界

- **API 限制**：单次调用图片大小有限制（大图分块处理）
- **复杂布局**：超过 3 组拆分列时提示人工处理
- **文字识别**：中文字符识别准确率依赖图片质量