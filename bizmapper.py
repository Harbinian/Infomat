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
