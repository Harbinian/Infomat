import hashlib
import json
import pathlib
import re
from datetime import date, datetime


ROOT = pathlib.Path(__file__).resolve().parent

# 当前默认真源：只维护 Markdown；XLSX 保留为历史导入/备份口径。
PLAN_SOURCE_MD = "信息化项目_计划管控真源.md"
WBS_SOURCE_MD = "信息化项目_WBS结构真源.md"
WORK_BALANCE_MD = "信息化项目_工作平衡.md"
WORK_PRINCIPLES_MD = "信息化项目_工作开展原则.md"
EXECUTION_STANDARD_MD = "信息化项目_执行标准真源.md"

BASE_FIELD_MAP = [
    ("ID", "id"),
    ("WBS", "wbs"),
    ("任务名称", "name"),
    ("任务类型", "type"),
    ("工期", "duration"),
    ("开始时间", "start"),
    ("完成时间", "finish"),
    ("前置任务", "predecessors"),
    ("资源名称", "resources"),
    ("责任部门", "department"),
    ("供应商", "vendor"),
    ("审核人/审批组", "reviewer"),
    ("风险等级", "risk"),
    ("里程碑", "milestone"),
    ("交付物", "deliverable"),
    ("备注", "notes"),
]

EXECUTION_FIELD_MAP = [
    ("所属视图分类", "viewCategory"),
    ("阶段门编号", "phaseGateNo"),
    ("是否关键路径控制", "isCriticalControl"),
    ("版本控制对象", "versionControlObject"),
    ("变更等级", "changeLevel"),
    ("联调启动条件", "integrationStartCondition"),
    ("是否H5重点展示", "isH5Focus"),
    ("阶段门名称", "phaseGateName"),
    ("放行/阻断规则", "releaseRule"),
    ("合同/付款控制口径", "contractPaymentControl"),
    ("H5诊断规则", "h5DiagnosticRule"),
    ("执行说明", "executionNote"),
]

EXECUTION_STANDARD_FIELD_MAP = [
    ("执行标准ID", "executionStandardId"),
    ("输入资料清单", "inputMaterialList"),
    ("检查清单ID", "checklistId"),
    ("完成判定", "completionCriteria"),
    ("证据要求", "evidenceRequirements"),
    ("标准缺失标记", "standardGapFlag"),
    ("标准暂缓原因", "standardDeferredReason"),
]

TASK_FIELD_MAP = BASE_FIELD_MAP + EXECUTION_FIELD_MAP + EXECUTION_STANDARD_FIELD_MAP


def norm_text(v):
    if v is None:
        return ""
    return str(v).strip()


def norm_int(v):
    s = norm_text(v)
    try:
        return int(float(s))
    except Exception:
        return 0


def norm_date(v):
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()

    s = norm_text(v)
    if not s:
        return ""

    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{4})/(\d{1,2})/(\d{1,2})$", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{4})年(\d{1,2})月(\d{1,2})日$", s)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    return ""


def read_source_block(path: pathlib.Path, source_type: str):
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"<!-- pmo-{source_type}-source:start -->\s*```json\s*(.*?)\s*```\s*<!-- pmo-{source_type}-source:end -->",
        re.S,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"Source JSON block not found in {path.name}")
    return json.loads(match.group(1))


def map_task(row):
    task = {}
    for source_name, key in BASE_FIELD_MAP:
        if key == "id":
            task[key] = norm_int(row.get(source_name))
        elif key in {"start", "finish"}:
            task[key] = norm_date(row.get(source_name))
        elif key == "resources":
            task[key] = norm_text(row.get("主责资源")) or norm_text(row.get("资源名称"))
        else:
            task[key] = norm_text(row.get(source_name))
    for source_name, key in EXECUTION_FIELD_MAP:
        task[key] = norm_text(row.get(source_name))
    for source_name, key in EXECUTION_STANDARD_FIELD_MAP:
        task[key] = norm_text(row.get(source_name))
    return task


def read_tasks_from_md(plan_path: pathlib.Path):
    data = read_source_block(plan_path, "plan")
    rows = data.get("tasks") or []
    tasks = [map_task(row) for row in rows if norm_text(row.get("任务名称"))]
    validate_tasks(tasks)
    return tasks, data


def validate_tasks(tasks):
    ids = set()
    dup = set()
    for task in tasks:
        if not task["id"]:
            continue
        if task["id"] in ids:
            dup.add(task["id"])
        ids.add(task["id"])
    if dup:
        raise RuntimeError(f"Duplicate task id(s): {', '.join(str(x) for x in sorted(dup))}")


def write_tasks_json(tasks, out_path: pathlib.Path):
    out_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")


def file_digest(path: pathlib.Path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def build_source_manifest(tasks, plan_data):
    summary = plan_data.get("summary") or {}
    source_docs = [
        {
            "role": "计划管控真源",
            "path": PLAN_SOURCE_MD,
            "purpose": "维护任务排程、资源责任、风险交付、阶段门和执行管控字段",
        },
        {
            "role": "WBS结构真源",
            "path": WBS_SOURCE_MD,
            "purpose": "维护 WBS 编号、父子层级、排序和摘要/里程碑结构",
        },
        {
            "role": "工作平衡",
            "path": WORK_BALANCE_MD,
            "purpose": "维护人员分配、例会把关机制、高压窗口和调度规则",
        },
        {
            "role": "工作开展原则",
            "path": WORK_PRINCIPLES_MD,
            "purpose": "维护 PMO 推进原则、协同边界、阶段确认和闭环规则",
        },
        {
            "role": "执行标准真源",
            "path": EXECUTION_STANDARD_MD,
            "purpose": "维护执行标准卡正文、检查清单、完成判定和证据要求",
        },
    ]
    for doc in source_docs:
        path = ROOT / doc["path"]
        doc["exists"] = path.exists()
        doc["sha256_16"] = file_digest(path) if path.exists() else ""

    computed_summary = {
        "recordCount": len(tasks),
        "fieldCount": summary.get("fieldCount", 45),
        "projectStart": summary.get("projectStart"),
        "projectFinish": summary.get("projectFinish"),
        "milestoneCount": sum(1 for task in tasks if task.get("milestone") == "是"),
        "criticalControlCount": sum(1 for task in tasks if task.get("isCriticalControl") == "是"),
        "h5FocusCount": sum(1 for task in tasks if task.get("isH5Focus") == "是"),
    }

    return {
        "schemaVersion": "pmo-service-source-manifest-v1",
        "snapshotDate": summary.get("snapshotDate") or plan_data.get("snapshotDate") or "2026-06-05",
        "authoritativeMode": "markdown-only",
        "deprecatedInputs": {
            "status": "历史 XLSX/MPP 已废弃；当前不再保留或读取 Project 导入表、旧版备份和 MPP 文件",
        },
        "sourceDocuments": source_docs,
        "serviceOutputs": [
            "tasks.json",
            "gantt-react/public/tasks.json",
            "gantt-react/public/pmo-source-manifest.json",
        ],
        "taskSummary": computed_summary,
        "updateRule": "修改 MD 真源后运行 python convert_xlsx.py，将计划数据输入甘特图和 PMO 看板服务。",
    }


def write_manifest(manifest, out_path: pathlib.Path):
    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    tasks_path = ROOT / "tasks.json"
    manifest_path = ROOT / "pmo-source-manifest.json"
    react_public = ROOT / "gantt-react" / "public"
    react_tasks_path = react_public / "tasks.json"
    react_manifest_path = react_public / "pmo-source-manifest.json"

    tasks, plan_data = read_tasks_from_md(ROOT / PLAN_SOURCE_MD)
    manifest = build_source_manifest(tasks, plan_data)

    write_tasks_json(tasks, tasks_path)
    write_manifest(manifest, manifest_path)
    react_tasks_path.write_text(tasks_path.read_text(encoding="utf-8"), encoding="utf-8")
    react_manifest_path.write_text(manifest_path.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"Wrote {len(tasks)} tasks from {PLAN_SOURCE_MD}")
    print("Wrote pmo-source-manifest.json")


if __name__ == "__main__":
    main()
