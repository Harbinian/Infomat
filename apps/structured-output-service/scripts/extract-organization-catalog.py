"""Read an explicitly supplied XLSX; write only department/position pairs and provenance.

An optional source-bound supplement adds explicitly confirmed positions.
No employee names, identifiers, contacts or source-workbook changes are produced.
Uses Python's standard library; does not connect to any service or database.
"""
import argparse
import hashlib
import json
import posixpath
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def extract(source):
    pairs = set()
    sheets = []
    with zipfile.ZipFile(source) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        relationships = {node.attrib["Id"]: node.attrib["Target"] for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")).findall(f"{{{REL_NS}}}Relationship")}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        for sheet in workbook.findall("s:sheets/s:sheet", NS):
            target = relationships[sheet.attrib[f"{{{DOC_REL_NS}}}id"]]
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            rows = ET.fromstring(archive.read(target)).findall("s:sheetData/s:row", NS)
            def cells(row):
                result = {}
                for cell in row:
                    text = cell.findtext("s:v", "", NS)
                    if cell.attrib.get("t") == "s":
                        text = strings[int(text)]
                    elif cell.attrib.get("t") == "inlineStr":
                        text = "".join(cell.find("s:is", NS).itertext())
                    result[re.sub(r"\d+$", "", cell.attrib["r"])] = text.strip()
                return result
            if not rows:
                continue
            header = cells(rows[0])
            department_column = next((key for key, value in header.items() if value == "部门"), None)
            position_column = next((key for key, value in header.items() if value in ("职务", "岗位")), None)
            if not department_column or not position_column:
                raise ValueError(f"Sheet {sheet.attrib['name']} has no department/position header")
            row_count = 0
            for row in rows[1:]:
                values = cells(row)
                department = values.get(department_column, "")
                position = values.get(position_column, "")
                if not department and not position:
                    continue
                if not department or not position:
                    raise ValueError(f"Incomplete department/position at {sheet.attrib['name']} row {row.attrib['r']}")
                pairs.add((department, position))
                row_count += 1
            sheets.append({"name": sheet.attrib["name"], "department_column": department_column, "position_column": position_column, "row_count": row_count})
    if not pairs:
        raise ValueError("No department/position pairs found")
    return {"source": {"file_name": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "sheets": sheets}, "roles_by_department": {department: sorted(position for dept, position in pairs if dept == department) for department in sorted({dept for dept, _ in pairs})}}


def apply_supplement(catalog, source):
    raw = source.read_bytes()
    supplement = json.loads(raw.decode("utf-8-sig"))
    if supplement.get("source_sha256") != catalog["source"]["sha256"]:
        raise ValueError("Supplement must match the explicitly supplied workbook SHA-256")
    confirmed_date = supplement.get("confirmed_date", "")
    basis = supplement.get("basis", "")
    if not isinstance(confirmed_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", confirmed_date) or not isinstance(basis, str) or not basis.strip():
        raise ValueError("Supplement requires a confirmation date and basis")
    additions = supplement.get("roles_by_department")
    if not isinstance(additions, dict) or not additions:
        raise ValueError("Supplement requires department/position pairs")
    for department, positions in additions.items():
        if department not in catalog["roles_by_department"]:
            raise ValueError("Supplement department must already exist in the source workbook")
        if not isinstance(positions, list) or not positions or any(not isinstance(position, str) or not position.strip() or position != position.strip() for position in positions):
            raise ValueError("Supplement positions must be nonempty exact names")
        if len(set(positions)) != len(positions):
            raise ValueError("Supplement positions must not repeat")
    result = json.loads(json.dumps(catalog, ensure_ascii=False))
    for department, positions in additions.items():
        result["roles_by_department"][department] = sorted(set(result["roles_by_department"][department]) | set(positions))
    result["source"]["supplement"] = {
        "file_name": source.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "confirmed_date": confirmed_date,
        "basis": basis.strip(),
        "roles_by_department": additions,
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--supplement", type=Path, help="Explicitly confirmed positions bound to the source workbook SHA-256")
    args = parser.parse_args()
    catalog = extract(args.source)
    if args.supplement:
        catalog = apply_supplement(catalog, args.supplement)
    text = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text)
