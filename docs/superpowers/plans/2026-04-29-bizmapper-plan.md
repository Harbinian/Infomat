# BizMapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 PNG 业务流程图中提取业务能力、业务流程、应用系统的映射关系，生成 Excel 映射表和 Infomat 可用的 JSON 结构。

**Architecture:** 单文件 Python 脚本，调用 MiniMax Vision API 分析图片，提取关系数据后生成美化 Excel。Excel 经人工审核后，再次运行脚本转换为 Infomat JSON 格式。

**Tech Stack:** Python 3.8+, openpyxl, pandas, minimax-coding-plan-mcp (vision tool)

---

## File Structure

```
G:\Infomat\
├── bizmapper.py              # 主程序（CLI）
├── sample-diagram.png        # 测试用示例图片
├── docs/superpowers/specs/
│   └── 2026-04-29-bizmapper-design.md
├── docs/superpowers/plans/
│   └── 2026-04-29-bizmapper-plan.md   # 本计划
└── output/
    ├── 映射表_YYYYMMDD.xlsx  # Excel 输出
    └── infomat_data_YYYYMMDD.json  # JSON 输出
```

---

## Task 1: 项目初始化与依赖检查

**Files:**
- Create: `bizmapper.py`

- [ ] **Step 1: 创建 bizmapper.py 框架**

```python
#!/usr/bin/env python3
"""
BizMapper - 业务关系提取工具
从 PNG 业务流程图中提取业务能力、业务流程、应用系统的映射关系
"""

import sys
import os
from pathlib import Path

def main():
    print("BizMapper v1.0")
    print("用法: python bizmapper.py <图片路径> [输出目录]")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 验证 Python 版本和依赖**

Run: `python --version`
Run: `python -c "import openpyxl, pandas; print('OK')"`
Expected: Python 3.8+ 且无报错

- [ ] **Step 3: 提交**

```bash
git add bizmapper.py
git commit -m "feat: init BizMapper project structure"
```

---

## Task 2: MiniMax API 调用封装

**Files:**
- Modify: `bizmapper.py:1-50`

- [ ] **Step 1: 添加 MiniMax API 调用函数**

```python
import json
import base64
import subprocess

MINIMAX_API_TEMPLATE = {
    "model": "MiniMax-Vision",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析这张业务流程图，提取以下信息..."},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
            ]
        }
    ]
}

def call_minimax_vision(image_path: str, prompt: str) -> dict:
    """调用 MiniMax Vision API 分析图片"""
    with open(image_path, "rb") as f:
        img_data = base64.b64encode(f.read()).decode()

    payload = {
        "model": "MiniMax-Vision",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_data}"}}
                ]
            }
        ]
    }

    # 通过 minimax-coding-plan-mcp 调用
    result = subprocess.run(
        ["claude", "mcp", "call", "minimax", "vision", json.dumps(payload)],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        raise RuntimeError(f"API调用失败: {result.stderr}")

    return json.loads(result.stdout)
```

- [ ] **Step 2: 测试 API 连接**

Run: `python bizmapper.py --test-api`
Expected: 输出 API 连接状态

- [ ] **Step 3: 提交**

```bash
git add bizmapper.py
git commit -m "feat: add MiniMax API call wrapper"
```

---

## Task 3: 图片解析 Prompt 设计

**Files:**
- Modify: `bizmapper.py:50-150`

- [ ] **Step 1: 添加 Prompt 模板**

```python
ANALYSIS_PROMPT = """你是一个业务架构分析专家。请分析这张业务流程图，提取结构化数据。

## 图片结构
- 列1：业务能力（一级分类）
- 列2：业务流程（二级分类）
- 列3：应用系统（IT系统）
- 连线：直线，连接相邻列

## 输出要求
请以 JSON 格式输出，包含以下字段：

1. `capabilities`: 业务能力列表
   - `name`: 一级业务能力名称
   - `l3`: 该能力下的业务流程列表

2. `systems`: 应用系统列表
   - `id`: 系统ID（英文或数字，如 s1, system_1）
   - `name`: 系统名称

3. `connections`: 连线关系列表
   - `capName`: 业务能力名称
   - `procName`: 业务流程名称
   - `sysId`: 应用系统ID

## 注意事项
- 如果某条连线的应用系统不确定，该字段留空
- 同一分组的列（1-2-3-2-1结构中的列1+列4属于业务能力）需合并
- 只提取确定的连线关系，不确定时返回空字符串

请直接输出 JSON，不要有其他内容："""
```

- [ ] **Step 2: 添加 analyze_image 函数**

```python
def analyze_image(image_path: str) -> dict:
    """分析图片并返回结构化数据"""
    print(f"正在分析图片: {image_path}")
    result = call_minimax_vision(image_path, ANALYSIS_PROMPT)
    return parse_analysis_result(result)
```

- [ ] **Step 3: 提交**

```bash
git add bizmapper.py
git commit -m "feat: add analysis prompt and image analysis function"
```

---

## Task 4: 解析结果处理

**Files:**
- Modify: `bizmapper.py:150-250`

- [ ] **Step 1: 添加结果解析函数**

```python
def parse_analysis_result(raw_result: dict) -> dict:
    """解析 API 返回的原始结果"""
    try:
        content = raw_result.get("choices", [{}])[0].get("message", {}).get("content", "")

        # 尝试提取 JSON
        if isinstance(content, str):
            # 去掉 markdown 代码块标记
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]

            return json.loads(content.strip())

        return json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"解析失败: {e}\n原始内容: {content[:500]}")
```

- [ ] **Step 2: 添加数据验证函数**

```python
def validate_data(data: dict) -> list:
    """验证解析结果，返回错误列表"""
    errors = []

    if "capabilities" not in data:
        errors.append("缺少 capabilities 字段")
    if "systems" not in data:
        errors.append("缺少 systems 字段")
    if "connections" not in data:
        errors.append("缺少 connections 字段")

    # 验证 connections 中的引用完整性
    cap_names = {c["name"] for c in data.get("capabilities", [])}
    all_l3 = set()
    for c in data.get("capabilities", []):
        all_l3.update(c.get("l3", []))
    sys_ids = {s["id"] for s in data.get("systems", [])}

    for i, conn in enumerate(data.get("connections", [])):
        if conn.get("capName") and conn["capName"] not in cap_names:
            errors.append(f"连线 {i}: 未找到业务能力 '{conn['capName']}'")
        if conn.get("procName") and conn["procName"] not in all_l3:
            errors.append(f"连线 {i}: 未找到业务流程 '{conn['procName']}'")
        if conn.get("sysId") and conn["sysId"] not in sys_ids:
            errors.append(f"连线 {i}: 未找到系统 '{conn['sysId']}'")

    return errors
```

- [ ] **Step 3: 提交**

```bash
git add bizmapper.py
git commit -m "feat: add result parsing and validation"
```

---

## Task 5: Excel 生成

**Files:**
- Modify: `bizmapper.py:250-400`

- [ ] **Step 1: 添加 Excel 生成函数**

```python
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def generate_excel(data: dict, output_path: str):
    """生成美化 Excel 映射表"""

    # 构建关系列表
    relations = []
    cap_l3_map = {c["name"]: c.get("l3", []) for c in data.get("capabilities", [])}

    for conn in data.get("connections", []):
        cap_name = conn.get("capName", "")
        proc_name = conn.get("procName", "")
        sys_id = conn.get("sysId", "")
        sys_name = ""

        # 查找系统名称
        for s in data.get("systems", []):
            if s["id"] == sys_id:
                sys_name = s["name"]
                break

        # 查找该流程属于哪个二级业务能力
        l2_cap = ""
        for cap, l3_list in cap_l3_map.items():
            if proc_name in l3_list:
                l2_cap = cap
                break

        relations.append({
            "一级业务能力": l2_cap,
            "二级业务能力": proc_name,  # 实际上是业务流程，但按 spec 格式
            "业务流程": proc_name,
            "应用系统": sys_name
        })

    # 创建 DataFrame
    df = pd.DataFrame(relations)

    # 写入 Excel（基础）
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='映射表')

    # 美化
    style_excel(output_path)

    return relations
```

- [ ] **Step 2: 添加样式美化函数**

```python
def style_excel(output_path: str):
    """美化 Excel 文件"""
    from openpyxl import load_workbook

    wb = load_workbook(output_path)
    ws = wb.active

    # 表头样式
    header_fill = PatternFill("solid", fgColor="2E4057")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_align = Alignment(horizontal="center", vertical="center")

    # 边框
    thin = Side(style="thin", color="BBBBBB")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # 样式应用到表头
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_align
        cell.border = border

    # 一级业务能力配色
    color_map = {}
    colors = ["D6E4F0", "D5F5E3", "FEF9E7", "FADBD8", "E8DAEF", "D4EFDF"]
    cap_index = 0

    # 按一级业务能力分组并应用颜色
    current_cap = None
    cap_start_row = 2

    for row in range(2, ws.max_row + 1):
        cap = ws.cell(row=row, column=1).value
        if cap != current_cap:
            if current_cap is not None and row > cap_start_row:
                # 应用颜色到之前的组
                color = colors[cap_index % len(colors)]
                for r in range(cap_start_row, row):
                    for c in range(1, 5):
                        ws.cell(row=r, column=c).fill = PatternFill("solid", fgColor=color)

                cap_index += 1

            current_cap = cap
            cap_start_row = row

    # 最后一组
    if current_cap is not None:
        color = colors[cap_index % len(colors)]
        for r in range(cap_start_row, ws.max_row + 1):
            for c in range(1, 5):
                ws.cell(row=r, column=c).fill = PatternFill("solid", fgColor=color)

    # 应用边框和对齐到所有数据单元格
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for cell in row:
            cell.border = border
            cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # 列宽
    col_widths = {"A": 22, "B": 28, "C": 28, "D": 22}
    for col_letter, width in col_widths.items():
        ws.column_dimensions[col_letter].width = width

    # 行高
    for row in ws.iter_rows():
        ws.row_dimensions[row[0].row].height = 20

    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "A2"

    wb.save(output_path)
```

- [ ] **Step 3: 合并单元格函数**

```python
def merge_same_cells(ws, col_index, start_row, end_row):
    """合并指定列中连续相同值的单元格"""
    merge_start = start_row
    for row in range(start_row + 1, end_row + 2):
        current = ws.cell(row=row, column=col_index).value
        prev = ws.cell(row=row - 1, column=col_index).value
        if current != prev or row == end_row + 2:
            if row - 1 > merge_start:
                ws.merge_cells(
                    start_row=merge_start, start_column=col_index,
                    end_row=row - 1, end_column=col_index
                )
            merge_start = row
```

- [ ] **Step 4: 提交**

```bash
git add bizmapper.py
git commit -m "feat: add Excel generation with styling"
```

---

## Task 6: Excel 到 JSON 转换

**Files:**
- Modify: `bizmapper.py:400-500`

- [ ] **Step 1: 添加 excel_to_json 函数**

```python
def excel_to_json(excel_path: str, output_path: str = None):
    """读取审核后的 Excel，转换为 Infomat JSON"""

    # 读取 Excel
    df = pd.read_excel(excel_path, sheet_name='映射表')

    # 构建数据结构
    capabilities_map = {}  # name -> {name, l3: []}
    systems_map = {}       # id -> {id, name}
    connections = []

    sys_index = 1
    for _, row in df.iterrows():
        cap_name = row["一级业务能力"]
        proc_name = row["业务流程"]
        sys_name = row["应用系统"]

        # 更新 capabilities
        if cap_name not in capabilities_map:
            capabilities_map[cap_name] = {"name": cap_name, "l3": []}

        # 添加 l3（业务流程）
        if proc_name and proc_name not in capabilities_map[cap_name]["l3"]:
            capabilities_map[cap_name]["l3"].append(proc_name)

        # 处理系统（如果名称为空则跳过）
        if sys_name and pd.notna(sys_name):
            # 生成简单的 sysId
            sys_id = f"s{sys_index}"
            for existing in systems_map.values():
                if existing["name"] == sys_name:
                    sys_id = existing["id"]
                    break
            else:
                systems_map[sys_id] = {"id": sys_id, "name": sys_name}
                sys_index += 1

            # 添加连线
            connections.append({
                "capName": cap_name,
                "procName": proc_name,
                "sysId": sys_id
            })

    # 构建最终结构
    result = {
        "capabilities": list(capabilities_map.values()),
        "systems": list(systems_map.values()),
        "connections": connections
    }

    # 保存
    if output_path is None:
        import datetime
        date_str = datetime.datetime.now().strftime("%Y%m%d")
        output_path = f"output/infomat_data_{date_str}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"JSON 已保存至: {output_path}")
    return result
```

- [ ] **Step 2: 提交**

```bash
git add bizmapper.py
git commit -m "feat: add Excel to JSON conversion"
```

---

## Task 7: CLI 入口完善

**Files:**
- Modify: `bizmapper.py` 末尾

- [ ] **Step 1: 完善 main 函数**

```python
def main():
    if len(sys.argv) < 2:
        print("BizMapper v1.0 - 业务关系提取工具")
        print("")
        print("用法:")
        print("  生成 Excel: python bizmapper.py <图片路径> [输出目录]")
        print("  Excel转JSON: python bizmapper.py --to-json <Excel路径> [输出目录]")
        print("")
        print("示例:")
        print("  python bizmapper.py sample-diagram.png")
        print("  python bizmapper.py --to-json output/映射表_20260429.xlsx")
        return

    output_dir = "output"
    if len(sys.argv) >= 3:
        output_dir = sys.argv[2]

    os.makedirs(output_dir, exist_ok=True)

    if sys.argv[1] == "--to-json":
        # Excel 转 JSON 模式
        excel_path = sys.argv[2]
        excel_to_json(excel_path, output_dir)
    else:
        # 分析图片生成 Excel 模式
        image_path = sys.argv[1]

        # 分析
        data = analyze_image(image_path)

        # 验证
        errors = validate_data(data)
        if errors:
            print("警告 - 数据验证发现以下问题:")
            for err in errors:
                print(f"  - {err}")
            print("")

        # 生成 Excel
        import datetime
        date_str = datetime.datetime.now().strftime("%Y%m%d")
        excel_path = os.path.join(output_dir, f"映射表_{date_str}.xlsx")

        print(f"正在生成 Excel: {excel_path}")
        generate_excel(data, excel_path)
        print(f"Excel 已保存至: {excel_path}")
        print("")
        print("请审核 Excel 中的映射关系，调整后运行以下命令转换为 JSON:")
        print(f"  python bizmapper.py --to-json {excel_path}")
```

- [ ] **Step 2: 提交**

```bash
git add bizmapper.py
git commit -m "feat: complete CLI interface"
```

---

## Task 8: 测试与调试

**Files:**
- Test: `bizmapper.py`（使用 sample-diagram.png）

- [ ] **Step 1: 运行测试**

Run: `python bizmapper.py sample-diagram.png output/`
Expected: 生成 Excel 文件，控制台输出分析结果

- [ ] **Step 2: 如果 API 调用失败，调试并修复**

可能问题：
- MCP 调用方式不对
- 图片编码问题
- API 返回格式变化

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: complete BizMapper with Excel and JSON output"
```

---

## 验证清单

- [ ] `python bizmapper.py sample-diagram.png output/` 生成 Excel
- [ ] Excel 包含四列：一级业务能力、二级业务能力、业务流程、应用系统
- [ ] 相同一级业务能力行已合并单元格并着色
- [ ] 表头样式正确（深蓝背景、白色字体）
- [ ] `python bizmapper.py --to-json output/映射表_*.xlsx` 生成 JSON
- [ ] JSON 包含 capabilities、systems、connections 三个字段
- [ ] connections 中的 sysId 与 systems 中的 id 一致