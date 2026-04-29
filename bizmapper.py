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

    print("BizMapper v1.0")
    print("用法: python bizmapper.py <图片路径> [输出目录]")


if __name__ == "__main__":
    main()
