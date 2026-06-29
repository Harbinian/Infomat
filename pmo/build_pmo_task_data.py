import hashlib
import json
import pathlib
import re
from datetime import date, datetime, timedelta


ROOT = pathlib.Path(__file__).resolve().parent

# 当前默认真源：只维护 Markdown；历史 XLSX / MPP / CSV 任务导入文件不作为当前输入。
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
    ("里程碑例外原因", "milestoneOverrideReason"),
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


STRONG_VIEW_CATEGORIES = {"Core_Procurement", "Infra_Phased", "G9_Ready", "Risk_Control"}
CONTROL_KEYWORDS = ["盘点", "核查", "验证", "评审", "验收"]
SPLIT_KEYWORDS = ["跨域", "多域", "整体", "总体", "全量", "联合", "统一", "贯通", "协同", "集成"]


def has_bound_standard(task):
    standard_id = norm_text(task.get("executionStandardId"))
    return bool(standard_id and standard_id != "暂缓")


def is_deferred(task):
    return norm_text(task.get("executionStandardId")) == "暂缓" or norm_text(task.get("standardGapFlag")) == "暂缓"


def is_summary_task(task):
    return norm_text(task.get("type")) == "摘要"


def is_control_type(task):
    haystack = f"{norm_text(task.get('type'))} {norm_text(task.get('name'))}"
    return any(keyword in haystack for keyword in CONTROL_KEYWORDS)


def should_split_before_standard(task):
    haystack = f"{norm_text(task.get('name'))} {norm_text(task.get('deliverable'))} {norm_text(task.get('executionNote'))}"
    if any(keyword in haystack for keyword in SPLIT_KEYWORDS):
        return True
    return "/" in haystack and any(word in haystack for word in ["接口", "集成", "联调", "测试", "供应商"])


def suggest_standard_id(task):
    haystack = " ".join(
        norm_text(task.get(key))
        for key in [
            "name",
            "type",
            "deliverable",
            "viewCategory",
            "phaseGateNo",
            "phaseGateName",
            "executionNote",
            "contractPaymentControl",
        ]
    )
    phase_gate = norm_text(task.get("phaseGateNo")) or norm_text(task.get("phaseGateName"))
    if "付款" in haystack or "合同" in haystack:
        return "STD-PAY-001"
    if "G9" in haystack or norm_text(task.get("viewCategory")) == "G9_Ready":
        return "STD-G9-001"
    if phase_gate:
        return "STD-GATE-001"
    if "UAT" in haystack.upper() or "用户验证" in haystack:
        return "STD-UAT-001"
    if "容灾" in haystack or "恢复" in haystack or "演练" in haystack or "回退" in haystack:
        return "STD-DR-001"
    if "验收" in haystack:
        return "STD-ACC-001"
    if "评审" in haystack or "审批" in haystack or "确认" in haystack or "冻结" in haystack:
        return "STD-REV-001"
    if "纪要" in haystack or "会议" in haystack:
        return "STD-MOM-001"
    if "问题" in haystack or "整改" in haystack or "异常" in haystack:
        return "STD-ISSUE-001"
    if "计划" in haystack or "排期" in haystack:
        return "STD-PLAN-001"
    if "访谈" in haystack or "调研" in haystack:
        return "STD-INTV-001"
    if "BOM" in haystack or "EBOM" in haystack or "PBOM" in haystack or "MBOM" in haystack:
        return "STD-BOM-001"
    if "工艺资源" in haystack or "工装" in haystack or "设备" in haystack or "人员资质" in haystack:
        return "STD-RES-001"
    if "接口" in haystack or "集成" in haystack:
        return "STD-IF-001"
    if "网络" in haystack or "安全域" in haystack:
        return "STD-NET-001"
    if "备份" in haystack or "防勒索" in haystack:
        return "STD-BKP-001"
    if "数据库" in haystack:
        return "STD-DB-001"
    if "GPU" in haystack.upper() or "FLUENT" in haystack.upper():
        return "STD-GPU-001"
    if "主数据" in haystack or "编码" in haystack or "属性" in haystack or "物料" in haystack:
        return "STD-DATA-001"
    if "基础设施" in haystack or "机房" in haystack or "虚拟化" in haystack or "资源池" in haystack:
        return "STD-INFRA-001"
    if "系统" in haystack:
        return "STD-SYS-001"
    if "盘点" in haystack or "核查" in haystack or "清单" in haystack or "现状" in haystack:
        return "STD-INV-001"
    if "验证" in haystack or "测试" in haystack:
        return "STD-UAT-001"
    return ""


def compute_gap_score(task, reference_date):
    if has_bound_standard(task):
        return 0

    score = 0
    if norm_text(task.get("risk")) == "高":
        score += 30
    if norm_text(task.get("isCriticalControl")) == "是":
        score += 30
    if norm_text(task.get("phaseGateNo")) or norm_text(task.get("phaseGateName")):
        score += 25
    if norm_text(task.get("viewCategory")) in STRONG_VIEW_CATEGORIES:
        score += 20
    if norm_text(task.get("isH5Focus")) == "是":
        score += 10
    if is_control_type(task):
        score += 20
    start = norm_date(task.get("start"))
    if start and reference_date:
        try:
            start_date = datetime.strptime(start, "%Y-%m-%d").date()
            if reference_date <= start_date <= reference_date + timedelta(days=90):
                score += 15
        except ValueError:
            pass
    if norm_text(task.get("deliverable")):
        score += 10
    return score


def build_gap_reasons(task, score):
    reasons = []
    if norm_text(task.get("risk")) == "高":
        reasons.append("高风险")
    if norm_text(task.get("isCriticalControl")) == "是":
        reasons.append("关键控制")
    if norm_text(task.get("phaseGateNo")) or norm_text(task.get("phaseGateName")):
        reasons.append("阶段门")
    if norm_text(task.get("viewCategory")) in STRONG_VIEW_CATEGORIES:
        reasons.append("重点视图")
    if norm_text(task.get("isH5Focus")) == "是":
        reasons.append("H5重点")
    if is_control_type(task):
        reasons.append("强控制任务类型")
    if norm_text(task.get("deliverable")):
        reasons.append("有关联交付物")
    if score >= 15 and "未来90天启动" not in reasons:
        start = norm_date(task.get("start"))
        if start:
            reasons.append("排期窗口内")
    return reasons


def classify_standard_gap(task, reference_date):
    standard_id = norm_text(task.get("executionStandardId"))
    deferred_reason = norm_text(task.get("standardDeferredReason"))
    suggested_standard_id = suggest_standard_id(task)

    task["requiresExecutionStandard"] = False
    task["standardsGapBucket"] = ""
    task["standardsGapReasons"] = []
    task["standardsGapPriorityScore"] = 0
    task["suggestedStandardId"] = ""
    task["suggestedAction"] = ""

    if has_bound_standard(task):
        task["requiresExecutionStandard"] = True
        task["suggestedStandardId"] = standard_id
        task["suggestedAction"] = "已绑定执行标准"
        return task

    if is_deferred(task) and deferred_reason:
        task["standardsGapBucket"] = "合理暂缓"
        task["suggestedStandardId"] = "暂缓"
        task["suggestedAction"] = f"暂缓：{deferred_reason}"
        return task

    if is_summary_task(task):
        task["standardsGapBucket"] = "人工复核"
        task["standardsGapReasons"] = ["摘要任务暂缓原因缺失"]
        task["suggestedStandardId"] = "暂缓"
        task["suggestedAction"] = "摘要任务需补充暂缓原因，确认后不进入真实缺口"
        return task

    task["requiresExecutionStandard"] = True
    score = compute_gap_score(task, reference_date)
    task["standardsGapPriorityScore"] = score
    reasons = build_gap_reasons(task, score)

    if should_split_before_standard(task):
        task["standardsGapBucket"] = "需拆分后补"
        task["standardsGapReasons"] = [*reasons, "任务边界较宽"]
        task["suggestedStandardId"] = suggested_standard_id or "待拆分后确认"
        task["suggestedAction"] = "先拆分 WBS，再按拆分后的执行任务绑定标准"
    elif score >= 25:
        task["standardsGapBucket"] = "必须补"
        task["standardsGapReasons"] = reasons or ["强控制任务缺标准"]
        task["suggestedStandardId"] = suggested_standard_id or "待PMO确认"
        if norm_text(task.get("phaseGateNo")) or norm_text(task.get("phaseGateName")):
            task["suggestedAction"] = "阶段门任务缺标准，本周补齐后再进入放行评审"
        elif norm_text(task.get("risk")) == "高":
            task["suggestedAction"] = "高风险任务缺标准，PMO 本周补齐"
        elif norm_text(task.get("isCriticalControl")) == "是":
            task["suggestedAction"] = "关键控制任务缺标准，纳入 PMO 周会"
        else:
            task["suggestedAction"] = "强控制任务缺标准，优先补齐"
    elif suggested_standard_id:
        task["standardsGapBucket"] = "自动可补"
        task["standardsGapReasons"] = reasons or ["规则可识别标准"]
        task["suggestedStandardId"] = suggested_standard_id
        task["suggestedAction"] = f"建议绑定 {suggested_standard_id}"
    else:
        task["standardsGapBucket"] = "人工复核"
        task["standardsGapReasons"] = reasons or ["任务边界或交付物不清"]
        task["suggestedStandardId"] = "待人工确认"
        task["suggestedAction"] = "任务边界或交付物不清，人工复核后确认标准"

    return task


def enrich_standard_gap_diagnostics(tasks, plan_data):
    summary = plan_data.get("summary") or {}
    reference_day = norm_date(summary.get("snapshotDate") or plan_data.get("snapshotDate"))
    reference_date = datetime.strptime(reference_day, "%Y-%m-%d").date() if reference_day else None
    return [classify_standard_gap(task, reference_date) for task in tasks]


def read_tasks_from_md(plan_path: pathlib.Path):
    data = read_source_block(plan_path, "plan")
    rows = data.get("tasks") or []
    tasks = [map_task(row) for row in rows if norm_text(row.get("任务名称"))]
    tasks = enrich_standard_gap_diagnostics(tasks, data)
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
    milestone_violations = [
        task for task in tasks
        if task.get("milestone") == "是"
        and task.get("duration") != "0工作日"
        and not task.get("milestoneOverrideReason")
    ]
    if milestone_violations:
        details = ", ".join(f"{task.get('wbs')} {task.get('name')}" for task in milestone_violations[:8])
        raise RuntimeError(f"Milestone tasks with non-zero duration need milestoneOverrideReason: {details}")


def write_tasks_json(tasks, out_path: pathlib.Path):
    out_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")


def file_digest(path: pathlib.Path):
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def build_source_manifest(tasks, plan_data):
    summary = plan_data.get("summary") or {}
    standard_buckets = ["必须补", "自动可补", "合理暂缓", "需拆分后补", "人工复核"]
    actionable_buckets = {"必须补", "自动可补", "需拆分后补", "人工复核"}
    bucket_counts = {
        bucket: sum(1 for task in tasks if task.get("standardsGapBucket") == bucket)
        for bucket in standard_buckets
    }
    actionable_gap_count = sum(1 for task in tasks if task.get("standardsGapBucket") in actionable_buckets)
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
            "status": "历史 XLSX/MPP/CSV 任务导入文件已废弃；当前不再保留或读取 Project 导入表、旧版备份、MPP 或 CSV 文件",
        },
        "sourceDocuments": source_docs,
        "serviceOutputs": [
            "tasks.json",
            "gantt-react/public/tasks.json",
            "gantt-react/public/pmo-source-manifest.json",
        ],
        "taskSummary": computed_summary,
        "standardGovernance": {
            "schemaVersion": "pmo-standard-gap-operations-v1",
            "referenceDate": summary.get("snapshotDate") or plan_data.get("snapshotDate") or "2026-06-05",
            "standardSource": EXECUTION_STANDARD_MD,
            "generatedBy": "pmo/build_pmo_task_data.py",
            "taskCount": len(tasks),
            "fieldCount": summary.get("fieldCount", 45),
            "bucketCounts": bucket_counts,
            "actionableGapCount": actionable_gap_count,
            "highRiskActionableCount": sum(1 for task in tasks if task.get("risk") == "高" and task.get("standardsGapBucket") in actionable_buckets),
            "criticalControlActionableCount": sum(1 for task in tasks if task.get("isCriticalControl") == "是" and task.get("standardsGapBucket") in actionable_buckets),
            "phaseGateActionableCount": sum(1 for task in tasks if (task.get("phaseGateNo") or task.get("phaseGateName")) and task.get("standardsGapBucket") in actionable_buckets),
        },
        "updateRule": "修改 MD 真源后运行 python build_pmo_task_data.py，将计划数据输入甘特图和 PMO 看板服务。",
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
