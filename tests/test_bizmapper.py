import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

import bizmapper


class BizMapperTests(unittest.TestCase):
    def test_excel_to_json_preserves_capability_names_from_merged_cells(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            excel_path = tmp_path / "merged.xlsx"
            json_path = tmp_path / "result.json"

            wb = Workbook()
            ws = wb.active
            ws.title = "映射表"
            ws.append(["一级业务能力", "业务流程", "应用系统"])
            ws.append(["计划管理", "MPS", "ERP"])
            ws.append([None, "MRP", "ERP"])
            ws.merge_cells("A2:A3")
            wb.save(excel_path)

            result = bizmapper.excel_to_json(str(excel_path), str(json_path))

            self.assertEqual(
                result["capabilities"],
                [{"name": "计划管理", "l3": ["MPS", "MRP"]}],
            )
            self.assertEqual(
                result["connections"],
                [
                    {"capName": "计划管理", "procName": "MPS", "sysId": "s1"},
                    {"capName": "计划管理", "procName": "MRP", "sysId": "s1"},
                ],
            )

            saved = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(saved, result)

    def test_to_json_without_excel_path_shows_usage_instead_of_traceback(self):
        completed = subprocess.run(
            [sys.executable, "bizmapper.py", "--to-json"],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("Excel转JSON: python bizmapper.py --to-json <Excel路径> [输出目录]", completed.stdout)
        self.assertNotIn("Traceback", completed.stderr)


if __name__ == "__main__":
    unittest.main()
