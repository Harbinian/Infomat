#!/usr/bin/env python3
"""
BizMapper - 业务关系提取工具
从 PNG 业务流程图中提取业务能力、业务流程、应用系统的映射关系
"""

import sys
import os
import json
import base64
import urllib.request
import urllib.error
from pathlib import Path

# MiniMax API 配置
MINIMAX_API_HOST = os.getenv("MINIMAX_API_HOST", "https://api.minimaxi.com")
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY")

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


def call_minimax_vision(image_path: str, prompt: str) -> dict:
    """调用 MiniMax Vision API 分析图片

    Args:
        image_path: 图片文件路径
        prompt: 分析提示词

    Returns:
        API 响应字典，包含 analysis 字段
    """
    if not MINIMAX_API_KEY:
        raise RuntimeError("MINIMAX_API_KEY environment variable not set")

    # 读取图片并转换为 base64
    with open(image_path, "rb") as f:
        img_data = base64.b64encode(f.read()).decode()

    # 检测图片格式
    if image_path.lower().endswith('.png'):
        img_format = 'png'
    elif image_path.lower().endswith(('.jpg', '.jpeg')):
        img_format = 'jpeg'
    elif image_path.lower().endswith('.webp'):
        img_format = 'webp'
    else:
        img_format = 'png'  # 默认使用 PNG

    image_url = f"data:image/{img_format};base64,{img_data}"

    # 调用 MiniMax VLM API
    url = f"{MINIMAX_API_HOST}/v1/coding_plan/vlm"
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": prompt,
        "image_url": image_url
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        raise RuntimeError(f"HTTP Error {e.code}: {error_body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"URL Error: {e.reason}")

    # 检查 API 错误
    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") != 0:
        raise RuntimeError(f"API Error: {base_resp.get('status_msg')}")

    return {"analysis": result.get("content", "")}


def parse_analysis_result(raw_result: dict) -> dict:
    """解析 API 返回的原始结果"""
    try:
        content = raw_result.get("analysis", "")

        # 尝试提取 JSON
        if isinstance(content, str):
            # 去掉 markdown 代码块标记
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]

            return json.loads(content.strip())

        return content
    except json.JSONDecodeError as e:
        raise RuntimeError(f"解析失败: {e}\n原始内容: {content[:500]}")


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


def analyze_image(image_path: str) -> dict:
    """分析图片并返回结构化数据"""
    print(f"正在分析图片: {image_path}")
    raw_result = call_minimax_vision(image_path, ANALYSIS_PROMPT)
    return parse_analysis_result(raw_result)


def test_api_connection():
    """测试 MiniMax API 连接"""
    print("Testing MiniMax API connection...")

    if not MINIMAX_API_KEY:
        print("FAIL: MINIMAX_API_KEY environment variable not set")
        return False

    # 创建一个简单的测试图片（1x1 绿色像素 PNG）
    test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    try:
        url = f"{MINIMAX_API_HOST}/v1/coding_plan/vlm"
        headers = {
            "Authorization": f"Bearer {MINIMAX_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "prompt": "Describe this image in one word.",
            "image_url": f"data:image/png;base64,{test_image_base64}"
        }

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))

        base_resp = result.get("base_resp", {})

        if base_resp.get("status_code") == 0:
            print(f"SUCCESS: API connection working")
            print(f"Response: {result.get('content', '')}")
            return True
        else:
            print(f"FAIL: API returned error: {base_resp.get('status_msg')}")
            return False

    except Exception as e:
        print(f"FAIL: {str(e)}")
        return False


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--test-api":
        success = test_api_connection()
        sys.exit(0 if success else 1)

    if len(sys.argv) < 2:
        print("BizMapper v1.0")
        print("用法: python bizmapper.py <图片路径> [输出目录]")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"错误: 文件不存在: {image_path}")
        sys.exit(1)

    result = analyze_image(image_path)
    print(f"分析结果: {result}")


if __name__ == "__main__":
    main()
