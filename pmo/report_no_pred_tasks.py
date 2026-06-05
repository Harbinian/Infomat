import json
import pathlib
import re


def wbs_key(wbs: str):
    parts = re.split(r"[.]", str(wbs or ""))
    key = []
    for p in parts:
        if p.isdigit():
            key.append((0, int(p)))
        else:
            key.append((1, p))
    return key


def suggest(tasks, by_wbs, parent_lists, task):
    wbs = str(task.get("wbs") or "")
    parent = wbs.rsplit(".", 1)[0] if "." in wbs else ""
    start = str(task.get("start") or "")

    milestone = task.get("milestone")
    is_milestone = task.get("type") == "里程碑" or milestone in (
        True,
        1,
        "1",
        "Y",
        "YES",
        "Yes",
        "是",
        "true",
        "True",
    )
    if is_milestone:
        return "FS（里程碑通常由前序交付完成触发）"

    siblings = parent_lists.get(parent) or []
    idx = -1
    for i, t in enumerate(siblings):
        if t.get("id") == task.get("id"):
            idx = i
            break

    prev = None
    if idx > 0:
        for j in range(idx - 1, -1, -1):
            if (siblings[j].get("type") or "") != "摘要":
                prev = siblings[j]
                break

    if prev is not None:
        if start and start == str(prev.get("start") or ""):
            return "SS（与同分支上一任务并行启动）"
        return "FS（接在同分支上一任务完成之后）"

    parent_task = by_wbs.get(parent)
    if parent_task is not None and (parent_task.get("type") or "") == "摘要":
        ps = str(parent_task.get("start") or "")
        if start and ps and start == ps:
            return "SS（与上级摘要开始对齐）"
        return "FS（挂到上级摘要首里程碑/启动完成之后）"

    task_type = task.get("type")
    if task_type in ("需求", "调研", "启动"):
        return "FS（建议挂到“项目启动”里程碑之后）"
    if task_type in ("招采", "合同", "进场"):
        return "FS（建议挂到“立项/预算批准”之后）"
    if task_type in ("开发", "设计", "开发准备"):
        return "FS（建议挂到“需求基线确认/方案评审通过”之后）"
    if task_type in ("测试", "联调", "开发/联调"):
        return "FS（建议挂到“开发完成/提测”之后）"
    if task_type in ("部署", "上线", "试运行"):
        return "FS（建议挂到“验收/发布评审通过”之后）"
    if task_type in ("培训", "推广"):
        return "SS（可与部署并行）"

    return "FS（默认：完成-开始）"


def esc_md(text):
    return str(text or "").replace("|", "\\|")


def main():
    tasks = json.loads(pathlib.Path("pmo/tasks.json").read_text(encoding="utf-8"))
    tasks = tasks if isinstance(tasks, list) else []

    by_wbs = {t.get("wbs"): t for t in tasks}
    sorted_tasks = sorted(tasks, key=lambda t: wbs_key(t.get("wbs")))

    parent_lists = {}
    for t in sorted_tasks:
        wbs = str(t.get("wbs") or "")
        parent = wbs.rsplit(".", 1)[0] if "." in wbs else ""
        parent_lists.setdefault(parent, []).append(t)

    targets = [
        t
        for t in sorted_tasks
        if (t.get("type") or "") != "摘要" and not (t.get("predecessors") or [])
    ]

    print("|ID|WBS|名称|开始~结束|部门|建议前置类型|")
    print("|-|-|-|-|-|-|")
    for t in targets:
        print(
            "|"
            + "|".join(
                [
                    esc_md(t.get("id")),
                    esc_md(t.get("wbs")),
                    esc_md(t.get("name")),
                    esc_md(f"{t.get('start')} ~ {t.get('finish')}"),
                    esc_md(t.get("department")),
                    esc_md(suggest(tasks, by_wbs, parent_lists, t)),
                ]
            )
            + "|"
        )
    print(f"\n合计 {len(targets)} 条")


if __name__ == "__main__":
    main()
